// Local release publishing: stage code, stop the owned app, copy data, verify, then clean up.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { installationId } from '../src/installation.mjs';
import { migrateState } from '../src/migrations.mjs';
import { acquireUpdate, reconcileUpdate, retryRename } from './update-transaction.mjs';
import { writePayloadManifest, verifyPayloadManifest } from './payload-manifest.mjs';

const codeFiles = [
  'src',
  'public',
  'Start-Bookshelf.cmd',
  'package.json',
  'README.md',
  'THIRD-PARTY-NOTICES.md',
];
const runtimeScripts = [
  'runtime-functions.ps1',
  'runtime-policy.ps1',
  'lively-functions.ps1',
  'lively-repair.ps1',
];
const transientData = (name) =>
  name === '.bookshelf-data-lock' ||
  name.startsWith('.bookshelf-data-lock-stage-') ||
  /^\.runtime-(?:start|stop|recovery|write)-[0-9a-f-]+\.(?:json|tmp)$/.test(name) ||
  [
    'tray-state.json',
    'runtime-events.log',
    'runtime-events.previous.log',
    'recovery-launch.log',
    'recovery-launch-error.log',
  ].includes(name);
const exists = async (file) => {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
};
async function safeTree(file) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink()) throw new Error('Folder aktualizacji zawiera dowiązanie: ' + file);
  if (stat.isDirectory())
    for (const name of await fs.readdir(file)) await safeTree(path.join(file, name));
}
async function inside(root, file) {
  const resolved = path.resolve(file),
    relative = path.relative(root, resolved);
  if (
    !relative ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    relative === '..'
  )
    throw new Error('Nieprawidłowa ścieżka aktualizacji: ' + file);
  let cursor = resolved;
  while (cursor !== root) {
    if (await exists(cursor)) {
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error('Dowiązanie poza folderem aplikacji: ' + cursor);
    }
    cursor = path.dirname(cursor);
  }
  return resolved;
}
async function safeTreeAncestors(file) {
  for (let cursor = path.resolve(file); ; cursor = path.dirname(cursor)) {
    if ((await exists(cursor)) && (await fs.lstat(cursor)).isSymbolicLink())
      throw new Error('Dowiązanie w ścieżce instalacji: ' + cursor);
    if (cursor === path.dirname(cursor)) break;
  }
}
async function manifest(root) {
  const result = {};
  if (!(await exists(root))) return result;
  await safeTree(root);
  async function visit(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (dir === root && transientData(item.name)) continue;
      const file = path.join(dir, item.name);
      // OneDrive placeholders can report neither file nor directory in Dirent.
      const type = item.isDirectory() || item.isFile() ? item : await fs.lstat(file);
      if (type.isDirectory()) await visit(file);
      else if (type.isFile())
        result[path.relative(root, file)] = createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex');
    }
  }
  await visit(root);
  return result;
}
async function savedState(appRoot) {
  const data = path.join(appRoot, 'data');
  for (const file of ['library.json', 'library.backup.json']) {
    try {
      return migrateState(JSON.parse(await fs.readFile(path.join(data, file), 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT' && file === 'library.backup.json')
        throw new Error('Nie można odczytać kolekcji. Zachowano pliki danych.');
    }
  }
  if (
    (await exists(path.join(appRoot, 'data-initialized.json'))) ||
    Object.keys(await manifest(data)).length
  )
    throw new Error('Brakuje poprawnej kolekcji. Zachowano pliki danych.');
  return null;
}
async function health(origin) {
  try {
    const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error('Port jest zajęty przez inny program.');
    return await response.json();
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') return null;
    throw e;
  }
}
async function requireInactiveGuardian(appRoot) {
  let tray;
  try {
    tray = JSON.parse(await fs.readFile(path.join(appRoot, 'data/tray-state.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (
    tray?.installationId === installationId(appRoot) &&
    Number.isSafeInteger(tray.pid) &&
    tray.pid > 0 &&
    alive(tray.pid)
  )
    throw new Error(
      'Biblioteczka odzyskuje połączenie. Poczekaj na jej uruchomienie lub zamknij ją z ikony zasobnika przed aktualizacją.',
    );
}
async function hasStopProof(appRoot, runtime) {
  if (!runtime?.sessionId || runtime.installationId !== installationId(appRoot)) return false;
  try {
    const file = path.join(appRoot, 'data/runtime-stop.json'),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return false;
    const marker = JSON.parse(await fs.readFile(file, 'utf8'));
    return (
      marker.version === 1 &&
      marker.appId === 'bookshelf-wallpaper' &&
      marker.installationId === runtime.installationId &&
      marker.pid === runtime.pid &&
      marker.sessionId === runtime.sessionId
    );
  } catch {
    return false;
  }
}
async function shutdown(origin, pid, appRoot, onServerStopped = () => {}) {
  if (!Number.isSafeInteger(pid) || pid === process.pid)
    throw new Error('Nie można bezpiecznie ustalić procesu do zatrzymania.');
  let tray;
  if (appRoot)
    try {
      tray = JSON.parse(await fs.readFile(path.join(appRoot, 'data/tray-state.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('Nie można potwierdzić procesu ikony zasobnika.');
    }
  if (
    tray &&
    (tray.installationId !== installationId(appRoot) ||
      !Number.isSafeInteger(tray.pid) ||
      tray.pid <= 0 ||
      tray.pid === process.pid)
  )
    throw new Error('Ikona zasobnika nie potwierdziła swojej instalacji.');
  const runtime = await health(origin);
  if (
    runtime?.appId !== 'bookshelf-wallpaper' ||
    (runtime.pid !== undefined && runtime.pid !== pid) ||
    (runtime.installationId && runtime.installationId !== installationId(appRoot))
  )
    throw new Error('Nie można potwierdzić poprzedniego serwera do zamknięcia.');
  const { token } = await (
    await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) })
  ).json();
  let response, transportError;
  try {
    response = await fetch(origin + '/api/shutdown', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
      body: JSON.stringify({ expectedPid: pid }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (e) {
    transportError = e;
  }
  if (response && !response.ok) throw new Error('Nie udało się zatrzymać poprzedniej wersji.');
  if (transportError) {
    for (let n = 0; n < 10 && !(await hasStopProof(appRoot, runtime)); n++) await delay(100);
    if (!(await hasStopProof(appRoot, runtime))) throw transportError;
  }
  for (let n = 0; n < 150; n++) {
    if (!alive(pid)) break;
    await delay(100);
  }
  if (alive(pid)) throw new Error('Poprzednia wersja nadal pracuje. Zachowano jej pliki.');
  onServerStopped();
  if (tray) {
    for (let n = 0; n < 150 && alive(tray.pid); n++) await delay(100);
    if (alive(tray.pid))
      throw new Error('Poprzednia ikona zasobnika nadal pracuje. Zachowano jej pliki.');
  }
}
const renameAfterExit = retryRename;
function verifiedLauncher(appRoot, port) {
  const powershell = path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(appRoot, 'scripts/start.ps1'),
        '-AppRoot',
        appRoot,
        '-Port',
        String(port),
        '-NoBrowser',
        '-ResultJson',
      ],
      { cwd: appRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (bytes) => {
      if (output.length < 32768) output += bytes;
    });
    child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(
        Object.assign(new Error('Uruchomienie nie potwierdziło gotowości w terminie.'), {
          code: 'LAUNCH_UNCERTAIN',
        }),
      );
    }, 140000);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        const line = output.split(/\r?\n/).find((s) => s.startsWith('BOOKSHELF_STARTED:'));
        if (code !== 0 || !line)
          throw Object.assign(
            new Error(
              'Nowa wersja nie uruchomiła się lub nie potwierdziła ikony zasobnika. Sprawdź data/server-error.log i data/tray-error.log.',
            ),
            {
              code: output.includes('BOOKSHELF_LAUNCH_UNCERTAIN:') ? 'LAUNCH_UNCERTAIN' : undefined,
            },
          );
        resolve(JSON.parse(line.slice('BOOKSHELF_STARTED:'.length)));
      } catch (e) {
        reject(e);
      }
    });
  });
}
async function launch(appRoot, port, { allowLegacy = false } = {}) {
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  const origin = 'http://127.0.0.1:' + port;
  if (
    process.platform === 'win32' &&
    (await exists(path.join(appRoot, 'scripts/runtime-functions.ps1')))
  ) {
    const identity = installationId(appRoot),
      { version } = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
    const owned = (h) =>
      h?.appId === 'bookshelf-wallpaper' && h.installationId === identity && h.version === version;
    try {
      const proof = await verifiedLauncher(appRoot, port),
        current = await health(origin);
      if (
        !owned(proof) ||
        !owned(current) ||
        !current.sessionId ||
        current.sessionId !== proof.sessionId ||
        current.pid !== proof.pid ||
        current.recovery === 'unrecoverable'
      )
        throw new Error('Nowa wersja nie potwierdziła swojej kolekcji.');
      return current;
    } catch (e) {
      const current = await health(origin).catch(() => null);
      if (owned(current)) {
        try {
          await shutdown(origin, current.pid, appRoot);
          if (e.code === 'LAUNCH_UNCERTAIN') e.code = undefined;
        } catch (error) {
          throw Object.assign(new Error(e.message + ' ' + error.message), {
            code: 'LAUNCH_UNCERTAIN',
          });
        }
      }
      throw e;
    }
  }
  const stdout = await fs.open(path.join(appRoot, 'data/server.log'), 'a'),
    stderr = await fs.open(path.join(appRoot, 'data/server-error.log'), 'a');
  let child;
  try {
    child = spawn(
      path.join(appRoot, 'runtime/node.exe'),
      [path.join(appRoot, 'src/main.mjs'), '--port', String(port)],
      { cwd: appRoot, windowsHide: true, detached: true, stdio: ['ignore', stdout.fd, stderr.fd] },
    );
  } finally {
    await stdout.close();
    await stderr.close();
  }
  let spawnError;
  child.on('error', (e) => {
    spawnError = e;
  });
  child.unref();
  try {
    for (let n = 0; n < 100; n++) {
      if (spawnError || child.exitCode !== null)
        throw new Error('Nowa wersja nie uruchomiła się. Sprawdź data/server-error.log.');
      const current = await health(origin);
      if (current) {
        const owned =
          current.installationId === installationId(appRoot) && current.pid === child.pid;
        if (
          current.appId !== 'bookshelf-wallpaper' ||
          (!owned && !(allowLegacy && !current.installationId)) ||
          current.recovery === 'unrecoverable'
        )
          throw new Error('Nowa wersja nie potwierdziła swojej kolekcji.');
        return { ...current, pid: child.pid };
      }
      await delay(100);
    }
    throw new Error('Nowa wersja nie odpowiedziała.');
  } catch (e) {
    if (child.pid && alive(child.pid)) {
      child.kill();
      for (let n = 0; n < 100 && alive(child.pid); n++) await delay(100);
    }
    throw e;
  }
}
async function verify(origin, target, version, state) {
  const current = await health(origin);
  if (
    current?.version !== version ||
    current.installationId !== installationId(target) ||
    current.recovery === 'unrecoverable'
  )
    throw new Error('Nie zgadza się wersja lub instalacja po aktualizacji.');
  const restored = await (await fetch(origin + '/api/state')).json();
  if (state && !isDeepStrictEqual(restored, state))
    throw new Error('Kolekcja po aktualizacji różni się od zapisanej.');
  for (const page of ['/manager', '/wallpaper'])
    if (!(await fetch(origin + page)).ok) throw new Error('Nie można otworzyć ' + page);
}
async function cleanup(root, previousRoot, version) {
  const removed = [],
    protectedFiles = [],
    dist = path.join(root, 'dist');
  if (!(await exists(dist))) return { removed, protected: protectedFiles };
  const lessOrEqual = (v) => {
    const a = v.split('.').map(Number),
      b = version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return true;
  };
  for (const name of await fs.readdir(dist)) {
    const match = /^Biblioteczka-(\d+\.\d+\.\d+)-win-x64-\d{8}-\d{6}(\.zip)?$/.exec(name);
    if (!match || !lessOrEqual(match[1])) continue;
    const file = await inside(root, path.join(dist, name));
    await safeTree(file);
    if (
      !match[2] &&
      file !== previousRoot &&
      Object.keys(await manifest(path.join(file, 'data'))).length
    ) {
      protectedFiles.push(file);
      continue;
    }
    await fs.rm(file, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
    removed.push(file);
  }
  return { removed, protected: protectedFiles };
}
export async function retryUpdateCleanup({ targetRoot } = {}) {
  const target = path.resolve(targetRoot ?? '');
  if (path.basename(target) !== 'Biblioteczka')
    throw new Error('Folder docelowy musi mieć nazwę Biblioteczka.');
  const root = path.dirname(target);
  await safeTreeAncestors(root);
  const transaction = await acquireUpdate(root);
  try {
    const tx = await transaction.pending();
    if (!tx) return { target, cleaned: true, removed: [] };
    if (tx.phase !== 'committed')
      throw new Error('Aktualizacja wymaga odzyskania, nie porządkowania. Zachowano dane.');
    await reconcileUpdate(tx, {
      root,
      target,
      health,
      shutdown,
      safeTree,
      inside,
      requireInactiveGuardian,
    });
    await verifyPayloadManifest(target);
    await savedState(target);
    const current = await health('http://127.0.0.1:' + tx.port);
    if (
      !current ||
      current.appId !== 'bookshelf-wallpaper' ||
      current.installationId !== installationId(target) ||
      current.recovery === 'unrecoverable'
    )
      throw new Error(
        'Przed porządkowaniem uruchom sprawną Biblioteczkę. Zachowano poprzedni folder.',
      );
    const removed = [];
    if (await exists(tx.backup)) {
      await safeTree(tx.backup);
      await fs.rm(tx.backup, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
      removed.push(tx.backup);
    }
    await transaction.clear();
    return { target, cleaned: true, removed };
  } finally {
    await transaction.release();
  }
}
export async function publish({
  sourceRoot,
  targetRoot,
  runtimePath,
  previousRoot,
  port = 47831,
  legacyPid,
} = {}) {
  sourceRoot = await fs.realpath(sourceRoot);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Nieprawidłowy port.');
  let deploymentRoot = sourceRoot;
  if (targetRoot) {
    targetRoot = path.resolve(targetRoot);
    if (path.basename(targetRoot) !== 'Biblioteczka')
      throw new Error('Folder docelowy musi mieć nazwę Biblioteczka.');
    const parent = path.dirname(targetRoot);
    await safeTreeAncestors(parent);
    await fs.mkdir(parent, { recursive: true });
    deploymentRoot = await fs.realpath(parent);
  }
  const target = await inside(deploymentRoot, path.join(deploymentRoot, 'Biblioteczka'));
  if (await exists(target)) {
    await safeTree(target);
    if ((await fs.readdir(target)).length) {
      let marker;
      try {
        marker = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
      } catch {}
      if (marker?.name !== 'bookshelf-wallpaper')
        throw new Error(
          'Folder docelowy zawiera obcy program lub pliki. Wybierz pusty folder Biblioteczka.',
        );
    }
  }
  previousRoot = previousRoot ? await inside(deploymentRoot, previousRoot) : target;
  const transaction = await acquireUpdate(deploymentRoot);
  const id = transaction.id,
    stage = await inside(deploymentRoot, path.join(deploymentRoot, '.bookshelf-stage-' + id)),
    backup = await inside(deploymentRoot, path.join(deploymentRoot, '.bookshelf-previous-' + id));
  const origin = 'http://127.0.0.1:' + port;
  let stopped = false,
    activated = false,
    moved = false,
    newPid,
    committed = false;
  const tx = {
    id,
    target,
    previousRoot,
    stage,
    backup,
    port,
    phase: 'preparing',
    hadTarget: await exists(target),
    installationId: installationId(target),
  };
  let preserve = false,
    transactionStarted = false;
  try {
    const pending = await transaction.pending();
    if (pending && pending.port !== port)
      throw new Error(
        'Przerwana aktualizacja używa portu ' +
          pending.port +
          '. Ponów instalator z tym portem. Zachowano foldery.',
      );
    const recovered = await reconcileUpdate(pending, {
      root: deploymentRoot,
      target,
      health,
      shutdown,
      safeTree,
      inside,
      requireInactiveGuardian,
    });
    if (recovered?.previousRoot && previousRoot === target) {
      previousRoot = recovered.previousRoot;
      tx.previousRoot = previousRoot;
    }
    await transaction.clear();
    tx.hadTarget = await exists(target);
    await transaction.record(tx);
    transactionStarted = true;
    if ((await exists(target)) && previousRoot !== target)
      throw new Error('Stały folder już istnieje. Migracja nie zastąpi jego kolekcji.');
    if (await exists(previousRoot)) await safeTree(previousRoot);
    const current = await health(origin);
    if (!current) await requireInactiveGuardian(previousRoot);
    if (current) {
      const disk = await savedState(previousRoot);
      if (
        current.appId !== 'bookshelf-wallpaper' ||
        (current.installationId
          ? current.installationId !== installationId(previousRoot)
          : !legacyPid) ||
        current.recovery === 'unrecoverable'
      )
        throw new Error('Port zajmuje inna instalacja lub kolekcja wymaga odzyskania.');
      const live = await (await fetch(origin + '/api/state')).json();
      if (!disk || live.collectionId !== disk.collectionId)
        throw new Error('Działająca kolekcja nie pochodzi ze wskazanego folderu.');
    }
    await verifyPayloadManifest(sourceRoot, { required: false });
    runtimePath = runtimePath ?? path.join(target, 'runtime');
    await safeTree(runtimePath);
    for (const name of ['node.exe', 'LICENSE']) await fs.access(path.join(runtimePath, name));
    const nodeVersion = execFileSync(path.join(runtimePath, 'node.exe'), ['-v'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    if (!/^v\d+\.\d+\.\d+$/.test(nodeVersion) || Number(nodeVersion.slice(1).split('.')[0]) < 24)
      throw new Error('Runtime wymaga Node.js 24 lub nowszego.');
    const { version } = JSON.parse(
      await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'),
    );
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Nieprawidłowa wersja paczki.');
    await fs.mkdir(stage);
    for (const item of codeFiles) {
      const from = path.join(sourceRoot, item);
      await safeTree(from);
      await fs.cp(from, path.join(stage, item), { recursive: true });
    }
    await fs.mkdir(path.join(stage, 'scripts'));
    for (const name of [
      'start.ps1',
      'desktop-functions.ps1',
      'windows.ps1',
      'tray.ps1',
      'publish.mjs',
      'update-transaction.mjs',
      'payload-manifest.mjs',
      'install.mjs',
      'install.ps1',
      ...runtimeScripts,
    ]) {
      const from = path.join(sourceRoot, 'scripts', name);
      if (!(await exists(from)) && name !== 'start.ps1') continue;
      await safeTree(from);
      await fs.copyFile(from, path.join(stage, 'scripts', name));
    }
    await fs.mkdir(path.join(stage, 'runtime'));
    for (const name of ['node.exe', 'LICENSE'])
      await fs.copyFile(path.join(runtimePath, name), path.join(stage, 'runtime', name));
    await fs.writeFile(path.join(stage, 'runtime/VERSION.txt'), nodeVersion + '\n');
    execFileSync(
      path.join(stage, 'runtime/node.exe'),
      ['--check', path.join(stage, 'src/main.mjs')],
      { windowsHide: true, stdio: 'pipe' },
    );
    await writePayloadManifest(stage);
    await verifyPayloadManifest(stage);
    if (current)
      await shutdown(origin, current.pid ?? legacyPid, previousRoot, () => {
        stopped = true;
      });
    const state = await savedState(previousRoot),
      data = path.join(previousRoot, 'data');
    const before = await manifest(data);
    const initializedMarker = path.join(previousRoot, 'data-initialized.json');
    if (await exists(initializedMarker))
      await fs.copyFile(initializedMarker, path.join(stage, 'data-initialized.json'));
    const ledgerBefore = await fs.readFile(path.join(data, 'ai-usage.json'), 'utf8').catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (await exists(data))
      await fs.cp(data, path.join(stage, 'data'), {
        recursive: true,
        filter: (file) => path.dirname(file) !== data || !transientData(path.basename(file)),
      });
    if (!isDeepStrictEqual(before, await manifest(path.join(stage, 'data'))))
      throw new Error('Kopia danych nie przeszła sprawdzenia.');
    tx.phase = 'moving';
    await transaction.record(tx);
    if (await exists(target)) {
      await renameAfterExit(target, backup);
      moved = true;
    }
    tx.phase = 'activating';
    await transaction.record(tx);
    await retryRename(stage, target);
    activated = true;
    tx.phase = 'activated';
    await transaction.record(tx);
    const started = await launch(target, port);
    newPid = started.pid;
    await verify(origin, target, version, state);
    // Data was copied byte for byte before startup. Logs may append during verification.
    const after = await manifest(path.join(target, 'data'));
    for (const [name, hash] of Object.entries(before))
      if (
        ![
          'server.log',
          'server-error.log',
          'tray.log',
          'tray-error.log',
          'runtime-recovery.json',
        ].includes(name) &&
        after[name] !== hash
      ) {
        // Startup clears interrupted jobs and formats the ledger, but must retain all charges.
        let retainedLedger = false;
        if (name === 'ai-usage.json')
          try {
            const original = JSON.parse(ledgerBefore),
              restored = JSON.parse(await fs.readFile(path.join(target, 'data', name), 'utf8'));
            retainedLedger =
              original.version === 1 &&
              Array.isArray(original.pending) &&
              isDeepStrictEqual(restored, { ...original, pending: [] });
          } catch {}
        if (!retainedLedger) throw new Error('Zmieniony plik danych po aktualizacji: ' + name);
      }
    tx.phase = 'committed';
    await transaction.record(tx);
    committed = true;
    let cleaned = { removed: [], protected: [] };
    try {
      cleaned = await cleanup(sourceRoot, previousRoot, version);
      if (moved) {
        await safeTree(backup);
        await fs.rm(backup, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
      }
      await transaction.clear();
    } catch (e) {
      return {
        target,
        version,
        installed: true,
        ...cleaned,
        cleanupWarning: e.message,
        preserved: [backup, stage].filter((file) => file === backup && moved),
      };
    }
    return { target, version, installed: true, ...cleaned };
  } catch (e) {
    if (!transactionStarted) {
      preserve = true;
      throw e;
    }
    if (committed)
      return {
        target,
        version: JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version,
        installed: true,
        removed: [],
        protected: [],
        cleanupWarning: e.message,
        preserved: [backup],
      };
    if (e.code === 'LAUNCH_UNCERTAIN') {
      preserve = true;
      throw new Error(e.message + ' Zachowano dziennik aktualizacji i foldery do odzyskania.');
    }
    try {
      if (newPid && alive(newPid)) await shutdown(origin, newPid, target);
      if (activated) {
        await requireInactiveGuardian(target);
        await safeTree(target);
        await retryRename(target, stage);
        preserve = true;
      }
      if (moved) await retryRename(backup, target);
      await transaction.clear();
    } catch (rollback) {
      preserve = true;
      throw new Error(
        e.message +
          ' Odzyskanie nie zakończyło się. Dane zachowano: ' +
          backup +
          '; ' +
          stage +
          '. ' +
          rollback.message,
      );
    }
    if (stopped) {
      try {
        await launch(previousRoot, port, { allowLegacy: Boolean(legacyPid) });
      } catch (rollback) {
        throw new Error(
          e.message + ' Dane zachowano; uruchom poprzedni folder. ' + rollback.message,
        );
      }
      throw new Error(
        e.message +
          ' Poprzednią wersję przywrócono.' +
          (preserve ? ' Zachowano nowy etap: ' + stage : ''),
      );
    }
    throw e;
  } finally {
    try {
      if (!preserve && (await exists(stage))) {
        await safeTree(stage);
        await fs.rm(stage, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
      }
    } finally {
      await transaction.release();
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    value = (name) => {
      const i = args.indexOf(name);
      return i < 0 ? undefined : args[i + 1];
    };
  try {
    const result = await (args.includes('--retry-cleanup')
      ? retryUpdateCleanup({ targetRoot: value('--target') })
      : publish({
          sourceRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
          runtimePath: value('--runtime'),
          previousRoot: value('--previous'),
          legacyPid: value('--legacy-pid') == null ? undefined : Number(value('--legacy-pid')),
          port: value('--port') == null ? 47831 : Number(value('--port')),
        }));
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
