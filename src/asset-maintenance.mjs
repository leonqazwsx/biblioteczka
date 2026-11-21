import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { migrateState } from './migrations.mjs';
import { problem } from './domain.mjs';

const hashId = /^[a-f0-9]{64}$/,
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const kinds = ['covers', 'spines'],
  day = 86400000,
  graceDays = 7,
  retentionDays = 30;
const unavailable = (message) => problem('STORAGE_UNAVAILABLE', message);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};

// HTTP mutations, store writes and asset uploads share this reentrant gate.
// Reentrancy lets an HTTP transaction use the guarded stores without deadlock.
export function createStorageGate() {
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  return (operation) => {
    const scope = context.getStore();
    if (scope?.active) {
      const nested = Promise.resolve().then(operation);
      scope.pending.add(nested);
      nested.then(
        () => scope.pending.delete(nested),
        () => scope.pending.delete(nested),
      );
      return nested;
    }
    const owned = { active: true, pending: new Set() };
    const pending = queue.then(() =>
      context.run(owned, async () => {
        try {
          return await operation();
        } finally {
          while (owned.pending.size) await Promise.allSettled([...owned.pending]);
          owned.active = false;
        }
      }),
    );
    queue = pending.catch(() => {});
    return pending;
  };
}

async function safeDirectory(f, root, directory, { create = false } = {}) {
  if (!inside(root, path.resolve(directory)))
    throw unavailable('Folder obrazów wychodzi poza folder danych.');
  if (create) await f.mkdir(directory, { recursive: true });
  const stat = await f.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !inside(root, await f.realpath(directory)))
    throw unavailable('Folder obrazów jest dowiązaniem lub ma niebezpieczną ścieżkę.');
  return directory;
}
async function safeFile(f, root, file) {
  const stat = await f.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, await f.realpath(file)))
    throw unavailable('Plik obrazów lub indeksu ma niebezpieczną ścieżkę.');
  return stat;
}

export function guardStorage({
  dataDir,
  store,
  covers,
  spines,
  gate = createStorageGate(),
  clock = () => new Date(),
}) {
  const writes = new Set([
    'commit',
    'replace',
    'appendImported',
    'beginSpine',
    'attachSpineIfCurrent',
    'attachCoverIfCurrent',
    'claimAutomaticSpine',
  ]);
  const guardedStore = new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value !== 'function'
        ? value
        : writes.has(key)
          ? (...args) => gate(() => value.apply(target, args))
          : value.bind(target);
    },
  });
  function assets(target, kind) {
    let proxy;
    proxy = new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key);
        if (typeof value !== 'function') return value;
        if (['fetchCatalogCover', 'fetchIsbnCover'].includes(key))
          return (id, options = {}) =>
            value.call(object, id, {
              ...options,
              save: (...args) =>
                gate(() => {
                  options.signal?.throwIfAborted();
                  return proxy.put(...args);
                }),
            });
        return (...args) =>
          gate(async () => {
            const root = await fs.realpath(dataDir),
              directory = path.join(root, kind);
            await safeDirectory(fs, root, directory);
            const result = await value.apply(object, args);
            if (key === 'put' || key === 'fetchCatalogCover') {
              const id = result.coverId ?? result.assetId;
              if (!hashId.test(id))
                throw unavailable('Nieprawidłowy identyfikator zapisanego obrazu.');
              const file = path.join(directory, id);
              await safeFile(fs, root, file);
              const now = clock();
              await fs.utimes(file, now, now);
            }
            return result;
          });
      },
    });
    return proxy;
  }
  return {
    store: guardedStore,
    covers: assets(covers, 'covers'),
    spines: assets(spines, 'spines'),
  };
}

export async function openAssetMaintenance({
  dataDir,
  store,
  gate = createStorageGate(),
  clock = () => new Date(),
  fsAdapter = fs,
}) {
  const f = fsAdapter,
    root = await f.realpath(dataDir),
    quarantineRoot = path.join(root, 'asset-quarantine');
  await safeDirectory(f, root, quarantineRoot, { create: true });
  const withMutation = (operation) => gate(operation);
  const key = (asset) => asset.kind + ':' + asset.id;
  function checkRevision(expected) {
    if (expected !== store.read().revision)
      throw problem('CONFLICT', 'Kolekcja zmieniła się. Odśwież raport miejsca.');
  }
  function validateAsset(asset) {
    if (
      !asset ||
      !kinds.includes(asset.kind) ||
      typeof asset.id !== 'string' ||
      !hashId.test(asset.id)
    )
      throw problem('INVALID', 'Nieprawidłowy identyfikator obrazu.');
    return { kind: asset.kind, id: asset.id };
  }
  async function readJson(file, { optional = false } = {}) {
    try {
      await safeFile(f, root, file);
      return JSON.parse(await f.readFile(file, 'utf8'));
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function references() {
    const refs = { covers: new Set(), spines: new Set() },
      blockers = [];
    const protect = (kind, id) => {
      if (typeof id !== 'string' || !hashId.test(id))
        throw new Error('Nieprawidłowa referencja obrazu.');
      refs[kind].add(id);
    };
    const library = (state) => {
      const next = migrateState(state);
      for (const book of next.books) {
        if (book.coverId) protect('covers', book.coverId);
        if (book.spine) {
          protect('spines', book.spine.assetId);
          if (book.spine.sourceCoverId) protect('covers', book.spine.sourceCoverId);
        }
      }
    };
    if (store.recovery === 'unrecoverable')
      blockers.push('Kolekcja wymaga odzyskania; porządkowanie jest zablokowane.');
    try {
      library(store.read());
    } catch {
      blockers.push('Nie można sprawdzić bieżącej kolekcji.');
    }
    for (const filename of ['library.json', 'library.backup.json', 'library.schema1.backup.json']) {
      try {
        const value = await readJson(path.join(root, filename), {
          optional: filename !== 'library.json',
        });
        if (value) library(value);
      } catch {
        blockers.push('Nie można sprawdzić referencji w ' + filename + '.');
      }
    }
    try {
      const cache = await readJson(path.join(root, 'ai-spine-cache.json'), { optional: true });
      if (cache) {
        if (
          cache.version !== 1 ||
          !cache.entries ||
          typeof cache.entries !== 'object' ||
          Array.isArray(cache.entries)
        )
          throw new Error();
        for (const image of Object.values(cache.entries)) {
          if (!image || image.kind !== 'ai') throw new Error();
          protect('spines', image.assetId);
          protect('covers', image.sourceCoverId);
        }
      }
    } catch {
      blockers.push('Nie można sprawdzić indeksu zapisanych ilustracji AI.');
    }
    try {
      const ledger = await readJson(path.join(root, 'ai-usage.json'), { optional: true });
      if (ledger) {
        if (
          ledger.version !== 1 ||
          !ledger.days ||
          typeof ledger.days !== 'object' ||
          Array.isArray(ledger.days) ||
          !Array.isArray(ledger.pending)
        )
          throw new Error();
        for (const pending of ledger.pending) {
          protect('covers', pending.coverId);
          if (pending.assetId) protect('spines', pending.assetId);
        }
      }
    } catch {
      blockers.push('Nie można sprawdzić zapisanych zadań AI.');
    }
    return { refs, blockers };
  }
  async function atomic(file, value) {
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      await f.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
      await rename(temp, file);
    } finally {
      await f.unlink(temp).catch(() => {});
    }
  }
  async function rename(from, to) {
    for (let attempt = 0; ; attempt++) {
      try {
        await f.rename(from, to);
        return;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await delay(40 * 2 ** attempt);
      }
    }
  }
  async function batchFile(id) {
    if (typeof id !== 'string' || !uuid.test(id))
      throw problem('INVALID', 'Nieprawidłowa kopia obrazów.');
    await safeDirectory(f, root, quarantineRoot);
    const directory = path.join(quarantineRoot, id);
    await safeDirectory(f, root, directory);
    return { directory, file: path.join(directory, 'manifest.json') };
  }
  async function readBatch(id) {
    const location = await batchFile(id),
      manifest = await readJson(location.file);
    if (
      manifest.version !== 1 ||
      manifest.id !== id ||
      !Number.isFinite(Date.parse(manifest.createdAt)) ||
      !Array.isArray(manifest.assets) ||
      !Number.isSafeInteger(manifest.retentionDays) ||
      manifest.retentionDays < retentionDays ||
      !['moving', 'ready', 'partial', 'restoring', 'restored', 'purging', 'purged'].includes(
        manifest.state,
      )
    )
      throw unavailable('Dziennik kopii obrazów jest uszkodzony.');
    const seen = new Set();
    for (const asset of manifest.assets) {
      validateAsset(asset);
      if (seen.has(key(asset))) throw unavailable('Dziennik kopii zawiera duplikaty.');
      seen.add(key(asset));
      if (
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 ||
        !['planned', 'quarantined', 'restored', 'purge-planned', 'purged'].includes(asset.state)
      )
        throw unavailable('Dziennik kopii obrazów jest uszkodzony.');
    }
    return { ...location, manifest };
  }
  async function position(batch, asset) {
    const source = path.join(root, asset.kind, asset.id),
      destination = path.join(batch.directory, asset.kind, asset.id);
    await safeDirectory(f, root, path.join(root, asset.kind));
    await safeDirectory(f, root, path.join(batch.directory, asset.kind));
    const exists = async (file) => {
      try {
        return await safeFile(f, root, file);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    };
    return {
      source,
      destination,
      original: await exists(source),
      saved: await exists(destination),
    };
  }
  async function batches({ recover = false, refs } = {}) {
    const list = [],
      blockers = [];
    await safeDirectory(f, root, quarantineRoot);
    for (const entry of await f.readdir(quarantineRoot, { withFileTypes: true })) {
      try {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !uuid.test(entry.name))
          throw new Error();
        const batch = await readBatch(entry.name);
        let bytes = 0,
          count = 0;
        for (const asset of batch.manifest.assets) {
          const p = await position(batch, asset);
          if (p.saved) {
            bytes += p.saved.size;
            count++;
          }
          if (
            !p.saved &&
            !p.original &&
            asset.state !== 'purged' &&
            !(batch.manifest.state === 'purging' && asset.state === 'purge-planned')
          )
            throw new Error('missing');
          if (recover && asset.state !== 'purged')
            asset.state =
              !p.saved && batch.manifest.state === 'purging' && asset.state === 'purge-planned'
                ? 'purged'
                : p.saved
                  ? 'quarantined'
                  : 'restored';
        }
        if (recover && ['moving', 'restoring', 'purging'].includes(batch.manifest.state)) {
          batch.manifest.state = count
            ? 'partial'
            : batch.manifest.assets.every((asset) => asset.state === 'purged')
              ? 'purged'
              : 'restored';
          await atomic(batch.file, batch.manifest);
        }
        const purgeEligible =
          !!refs &&
          +clock() - Date.parse(batch.manifest.createdAt) >= batch.manifest.retentionDays * day &&
          batch.manifest.assets.every((asset) => !refs[asset.kind].has(asset.id));
        if (count)
          list.push({
            id: entry.name,
            createdAt: batch.manifest.createdAt,
            bytes,
            count,
            state: batch.manifest.state,
            purgeEligible,
            eligibleBytes: purgeEligible ? bytes : 0,
          });
      } catch (error) {
        // A crash before the initial journal cannot have moved any images: every
        // move requires that journal. Ignore only a proven-empty preparation; keep
        // the folders for inspection, and refuse all ambiguous contents.
        let empty = false;
        if (error.code === 'ENOENT' && uuid.test(entry.name))
          try {
            const directory = await safeDirectory(f, root, path.join(quarantineRoot, entry.name));
            const names = await f.readdir(directory);
            empty = true;
            for (const name of names) {
              if (kinds.includes(name)) {
                const nested = await safeDirectory(f, root, path.join(directory, name));
                if ((await f.readdir(nested)).length) empty = false;
              } else empty = false;
            }
          } catch {}
        if (!empty) blockers.push('Nie można sprawdzić kopii obrazów ' + entry.name + '.');
      }
    }
    return { list, blockers };
  }
  async function inspect() {
    const { refs, blockers } = await references(),
      candidates = [],
      totals = {
        covers: { bytes: 0, count: 0 },
        spines: { bytes: 0, count: 0 },
        quarantine: { bytes: 0, count: 0 },
      };
    for (const kind of kinds) {
      try {
        const directory = await safeDirectory(f, root, path.join(root, kind));
        for (const entry of await f.readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile() || entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name),
            stat = await safeFile(f, root, file);
          totals[kind].bytes += stat.size;
          totals[kind].count++;
          if (
            !hashId.test(entry.name) ||
            refs[kind].has(entry.name) ||
            stat.mtimeMs > +clock() - graceDays * day
          )
            continue;
          if (digest(await f.readFile(file)) !== entry.name) continue;
          candidates.push({
            kind,
            id: entry.name,
            bytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      } catch {
        blockers.push('Nie można bezpiecznie sprawdzić folderu ' + kind + '.');
      }
    }
    try {
      const q = await batches({ refs });
      blockers.push(...q.blockers);
      for (const batch of q.list) {
        totals.quarantine.bytes += batch.bytes;
        totals.quarantine.count += batch.count;
        if (blockers.length) {
          batch.purgeEligible = false;
          batch.eligibleBytes = 0;
        }
      }
      const state = store.read();
      return {
        collectionId: state.collectionId,
        revision: state.revision,
        graceDays,
        retentionDays,
        cleanupAllowed: blockers.length === 0,
        blockers,
        totals,
        candidates: blockers.length ? [] : candidates,
        quarantine: q.list,
      };
    } catch {
      const state = store.read();
      blockers.push('Nie można sprawdzić kopii usuniętych obrazów.');
      return {
        collectionId: state.collectionId,
        revision: state.revision,
        graceDays,
        retentionDays,
        cleanupAllowed: false,
        blockers,
        totals,
        candidates: [],
        quarantine: [],
      };
    }
  }
  async function quarantine({ expectedRevision, assets } = {}) {
    return gate(async () => {
      checkRevision(expectedRevision);
      if (!Array.isArray(assets) || !assets.length || assets.length > 10000)
        throw problem('INVALID', 'Wybierz obrazy do przeniesienia.');
      const selected = assets.map(validateAsset);
      if (new Set(selected.map(key)).size !== selected.length)
        throw problem('INVALID', 'Obraz wybrano więcej niż raz.');
      const report = await inspect();
      if (!report.cleanupAllowed)
        throw unavailable(
          'Nie można potwierdzić wszystkich referencji. Porządkowanie jest zablokowane.',
        );
      const available = new Map(report.candidates.map((asset) => [key(asset), asset]));
      if (selected.some((asset) => !available.has(key(asset))))
        throw problem('CONFLICT', 'Lista nieużywanych obrazów zmieniła się. Odśwież raport.');
      const id = crypto.randomUUID(),
        directory = path.join(quarantineRoot, id);
      await safeDirectory(f, root, directory, { create: true });
      for (const kind of kinds)
        await safeDirectory(f, root, path.join(directory, kind), { create: true });
      const batch = {
          directory,
          file: path.join(directory, 'manifest.json'),
          manifest: {
            version: 1,
            id,
            state: 'moving',
            createdAt: clock().toISOString(),
            retentionDays,
            assets: selected.map((asset) => ({ ...available.get(key(asset)), state: 'planned' })),
          },
        },
        moved = [];
      await atomic(batch.file, batch.manifest);
      try {
        for (const asset of batch.manifest.assets) {
          checkRevision(expectedRevision);
          const current = await references();
          if (current.blockers.length)
            throw unavailable('Referencje obrazów zmieniły się; porządkowanie przerwano.');
          if (current.refs[asset.kind].has(asset.id))
            throw problem('CONFLICT', 'Obraz jest już potrzebny kolekcji.');
          const p = await position(batch, asset);
          if (
            !p.original ||
            p.saved ||
            p.original.mtimeMs > +clock() - graceDays * day ||
            p.original.size !== asset.bytes ||
            digest(await f.readFile(p.source)) !== asset.id
          )
            throw problem('CONFLICT', 'Obraz zmienił się. Odśwież raport.');
          await rename(p.source, p.destination);
          asset.state = 'quarantined';
          moved.push({ kind: asset.kind, id: asset.id, bytes: asset.bytes });
          await atomic(batch.file, batch.manifest);
        }
        batch.manifest.state = 'ready';
        await atomic(batch.file, batch.manifest);
      } catch (error) {
        batch.manifest.state = 'partial';
        await atomic(batch.file, batch.manifest).catch(() => {});
        throw Object.assign(
          error.code === 'CONFLICT'
            ? error
            : unavailable(
                'Przenoszenie przerwano. Kopia obrazów pozostaje dostępna do przywrócenia.',
              ),
          { details: { quarantineId: id } },
        );
      }
      return { quarantineId: id, moved, report: await inspect() };
    });
  }
  async function restore({ expectedRevision, quarantineId } = {}) {
    return gate(async () => {
      checkRevision(expectedRevision);
      const batch = await readBatch(quarantineId),
        restored = [];
      batch.manifest.state = 'restoring';
      await atomic(batch.file, batch.manifest);
      try {
        for (const asset of batch.manifest.assets) {
          if (asset.state === 'purged') continue;
          checkRevision(expectedRevision);
          const p = await position(batch, asset);
          if (p.saved) {
            if (digest(await f.readFile(p.destination)) !== asset.id)
              throw unavailable('Kopia obrazu jest uszkodzona.');
            if (p.original) {
              if (digest(await f.readFile(p.source)) !== asset.id)
                throw unavailable('Istniejący obraz jest uszkodzony; nie zostanie zastąpiony.');
            } else {
              await rename(p.destination, p.source);
              const now = clock();
              await f.utimes(p.source, now, now);
            }
            restored.push({ kind: asset.kind, id: asset.id });
          } else if (!p.original) throw unavailable('Nie znaleziono obrazu ani jego kopii.');
          asset.state = 'restored';
          await atomic(batch.file, batch.manifest);
        }
        batch.manifest.state = 'restored';
        await atomic(batch.file, batch.manifest);
      } catch (error) {
        throw Object.assign(
          unavailable('Przywracanie przerwano. Kopia pozostaje dostępna; spróbuj ponownie.'),
          { details: { quarantineId } },
        );
      }
      return { restored, report: await inspect() };
    });
  }
  async function purge({ expectedRevision, quarantineId } = {}) {
    return gate(async () => {
      checkRevision(expectedRevision);
      const batch = await readBatch(quarantineId),
        report = await inspect();
      if (!report.cleanupAllowed)
        throw unavailable(
          'Nie można potwierdzić wszystkich referencji. Trwałe usuwanie jest zablokowane.',
        );
      if (+clock() - Date.parse(batch.manifest.createdAt) < batch.manifest.retentionDays * day)
        throw problem('CONFLICT', 'Kopia musi pozostać przez co najmniej 30 dni.');
      const known = await references();
      if (known.blockers.length) throw unavailable('Nie można sprawdzić referencji obrazów.');
      if (batch.manifest.assets.some((asset) => known.refs[asset.kind].has(asset.id)))
        throw problem(
          'CONFLICT',
          'Obraz z tej kopii jest ponownie potrzebny kolekcji, cache lub zadaniu.',
        );
      batch.manifest.state = 'purging';
      await atomic(batch.file, batch.manifest);
      let deletedBytes = 0;
      const deleted = [];
      try {
        for (const asset of batch.manifest.assets) {
          if (asset.state === 'purged') continue;
          checkRevision(expectedRevision);
          const current = await references();
          if (current.blockers.length)
            throw unavailable('Referencje są niedostępne; trwałe usuwanie przerwano.');
          if (current.refs[asset.kind].has(asset.id))
            throw problem('CONFLICT', 'Obraz jest ponownie potrzebny; trwałe usuwanie przerwano.');
          const p = await position(batch, asset);
          if (p.saved) {
            if (
              p.saved.size !== asset.bytes ||
              digest(await f.readFile(p.destination)) !== asset.id
            )
              throw unavailable('Kopia obrazu zmieniła się; nie zostanie usunięta.');
            asset.state = 'purge-planned';
            await atomic(batch.file, batch.manifest);
            await safeFile(f, root, p.destination);
            await f.unlink(p.destination);
            deletedBytes += asset.bytes;
            deleted.push({ kind: asset.kind, id: asset.id, bytes: asset.bytes });
          }
          asset.state = 'purged';
          await atomic(batch.file, batch.manifest);
        }
        batch.manifest.state = 'purged';
        await atomic(batch.file, batch.manifest);
      } catch (error) {
        await atomic(batch.file, batch.manifest).catch(() => {});
        throw Object.assign(
          error.code === 'CONFLICT'
            ? error
            : unavailable('Trwałe usuwanie przerwano. Pozostałe pliki są zachowane w kopii.'),
          { details: { quarantineId, deletedBytes, deleted } },
        );
      }
      return { deletedBytes, deleted, report: await inspect() };
    });
  }
  // Only reconcile journals here; never move or delete user assets at startup.
  await gate(() => batches({ recover: true }));
  return { report: () => gate(inspect), quarantine, restore, purge, withMutation };
}
