import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SPINE_CONFIG } from './spine-provider.mjs';
import { problem } from './domain.mjs';
const localDate = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
export async function openSpineJobs({
  dataDir,
  store,
  covers,
  spines,
  provider,
  clock = () => new Date(),
  onState = () => {},
  fsAdapter = fs,
}) {
  const fs = fsAdapter;
  await fs.mkdir(dataDir, { recursive: true });
  const ledgerFile = path.join(dataDir, 'ai-usage.json'),
    cacheFile = path.join(dataDir, 'ai-spine-cache.json');
  let ledger = { version: 1, days: {}, pending: [] },
    cache = { version: 1, entries: {} },
    blocked = '',
    closed = false,
    worker = null,
    currentController = null,
    cancelEpoch = 0;
  const waiting = [],
    jobs = new Map();
  function emit() {
    try {
      onState();
    } catch {}
  }
  async function atomic(file, value) {
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(tmp, JSON.stringify(value, null, 2));
      for (let n = 0; ; n++) {
        try {
          await fs.rename(tmp, file);
          break;
        } catch (e) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || n >= 5) throw e;
          await delay(40 * 2 ** n);
        }
      }
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }
  try {
    const parsed = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
    if (
      parsed.version !== 1 ||
      !parsed.days ||
      Array.isArray(parsed.days) ||
      !Array.isArray(parsed.pending)
    )
      throw new Error();
    for (const [date, d] of Object.entries(parsed.days))
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isSafeInteger(d.attempts) ||
        d.attempts < 0 ||
        !Number.isSafeInteger(d.unknownCharges) ||
        d.unknownCharges < 0 ||
        !Number.isFinite(d.estimatedUsd) ||
        d.estimatedUsd < 0
      )
        throw new Error();
    ledger = parsed;
    for (const p of ledger.pending)
      jobs.set(p.collectionId + ':' + p.bookId, {
        ...p,
        state: 'failed',
        message: 'Generowanie przerwano. Ponów ręcznie; poprzednia próba może być rozliczona.',
      });
    ledger.pending = [];
    await atomic(ledgerFile, ledger);
  } catch (e) {
    if (e.code !== 'ENOENT')
      blocked =
        'Nie można odczytać licznika prób AI. Przywróć ai-usage.json z kopii; generowanie jest zablokowane.';
  }
  try {
    const c = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (c.version === 1 && c.entries && typeof c.entries === 'object' && !Array.isArray(c.entries))
      cache = c;
  } catch {}
  const cacheKey = (coverId) =>
    createHash('sha256')
      .update(JSON.stringify({ coverId, ...SPINE_CONFIG }))
      .digest('hex');
  for (const [key, image] of Object.entries(cache.entries)) {
    try {
      if (
        !image ||
        image.kind !== 'ai' ||
        typeof image.sourceCoverId !== 'string' ||
        key !== cacheKey(image.sourceCoverId) ||
        image.model !== SPINE_CONFIG.model ||
        image.promptVersion !== SPINE_CONFIG.promptVersion
      )
        throw new Error();
      await spines.read(image.assetId);
    } catch {
      delete cache.entries[key];
    }
  }
  function valid(ticket) {
    const s = store.read(),
      b = s.books.find((b) => b.id === ticket.bookId);
    return (
      s.collectionId === ticket.collectionId &&
      b?.coverId === ticket.coverId &&
      b?.spineGeneration === ticket.generation
    );
  }
  function today() {
    const date = localDate(clock());
    return { date, d: ledger.days[date] ?? { attempts: 0, estimatedUsd: 0, unknownCharges: 0 } };
  }
  async function persistLedger() {
    try {
      await atomic(ledgerFile, ledger);
    } catch {
      blocked = 'Nie można zapisać licznika prób AI. Sprawdź dostęp do folderu danych.';
      throw problem('AI_UNAVAILABLE', blocked);
    }
  }
  function status() {
    const s = store.read(),
      { date, d } = today(),
      available = provider.available && !blocked && !closed;
    return {
      available,
      paidAvailable:
        !!available && s.settings.aiEnabled && d.attempts < 10 && d.unknownCharges === 0,
      reusableCoverIds: closed
        ? []
        : [...new Set(Object.values(cache.entries).map((image) => image.sourceCoverId))],
      enabled: s.settings.aiEnabled,
      date,
      attempts: d.attempts,
      limit: 10,
      estimatedUsd: d.estimatedUsd,
      unknownCharges: d.unknownCharges,
      message: blocked,
      jobs: [...jobs.values()]
        .filter(
          (j) =>
            j.collectionId === s.collectionId &&
            s.books.some((b) => b.id === j.bookId && b.spineGeneration === j.generation),
        )
        .map(({ done, resolve, ...j }) => structuredClone(j)),
    };
  }
  async function perform(task) {
    const epoch = cancelEpoch;
    function ensureCurrent() {
      if (closed || epoch !== cancelEpoch || !store.read().settings.aiEnabled)
        throw problem('AI_UNAVAILABLE', 'Generowanie przerwano przed wysłaniem żądania.');
      if (!valid(task.ticket))
        throw problem('CONFLICT', 'Książka zmieniła się; wygeneruj jej aktualny grzbiet.');
    }
    ensureCurrent();
    const key = cacheKey(task.ticket.coverId);
    let image = cache.entries[key];
    if (image && !task.force) {
      try {
        await spines.read(image.assetId);
      } catch {
        delete cache.entries[key];
        image = null;
      }
    } else image = null;
    if (!image) {
      if (task.reuseOnly)
        throw problem(
          'AI_UNAVAILABLE',
          'Zapisana ilustracja nie jest już dostępna. Odśwież panel; ponowne użycie nie uruchamia płatnego generowania.',
        );
      if (blocked || !provider.available)
        throw problem(
          'AI_UNAVAILABLE',
          blocked || 'Skonfiguruj klucz API i uruchom program ponownie.',
        );
      const cover = await covers.read(task.ticket.coverId);
      ensureCurrent();
      const { date, d } = today();
      if (d.attempts >= 10)
        throw problem('AI_LIMIT', 'Dzisiejszy limit 10 prób został wykorzystany.');
      if (d.unknownCharges)
        throw problem(
          'AI_UNAVAILABLE',
          'Dzisiejsza próba ma nieznany koszt. Kolejne płatne generowanie jest zablokowane do jutra; możesz użyć zapisanej ilustracji.',
        );
      task.job.state = 'generating';
      emit();
      ledger.days[date] = { ...d, attempts: d.attempts + 1, unknownCharges: d.unknownCharges + 1 };
      ledger.pending = [{ ...task.ticket, date }];
      try {
        await persistLedger();
        ensureCurrent();
      } catch (e) {
        ledger.days[date].attempts--;
        ledger.days[date].unknownCharges--;
        ledger.pending = [];
        await persistLedger().catch(() => {});
        throw e;
      }
      currentController = new AbortController();
      let result;
      try {
        result = await provider.generate({
          coverBytes: cover.bytes,
          coverMime: cover.mime,
          signal: currentController.signal,
        });
      } finally {
        currentController = null;
      }
      const u = result.usage;
      if (
        u &&
        [u.textInput, u.imageInput, u.imageOutput].every((v) => Number.isSafeInteger(v) && v >= 0)
      ) {
        ledger.days[date].estimatedUsd +=
          (u.textInput * 5 + u.imageInput * 8 + u.imageOutput * 30) / 1e6;
        ledger.days[date].unknownCharges--;
      }
      ledger.pending = [];
      await persistLedger();
      const saved = await spines.put(result.bytes, result.mime);
      image = {
        assetId: saved.assetId,
        kind: 'ai',
        sourceCoverId: task.ticket.coverId,
        model: SPINE_CONFIG.model,
        promptVersion: SPINE_CONFIG.promptVersion,
      };
      cache.entries[key] = image;
      await atomic(cacheFile, cache);
    }
    if (closed) throw problem('AI_TIMEOUT', 'Generowanie przerwano podczas zamykania aplikacji.');
    const attached = await store.attachSpineIfCurrent(task.ticket, image);
    if (!attached)
      throw problem('CONFLICT', 'Książka zmieniła się. Wynik nie został do niej przypisany.');
    task.job.state = 'ready';
    task.job.message = task.reuseOnly
      ? 'Użyto zapisanej ilustracji bez opłat.'
      : 'Ilustracja zapisana lokalnie.';
  }
  async function pump() {
    while (waiting.length && !closed) {
      const task = waiting.shift();
      try {
        await perform(task);
      } catch (e) {
        task.job.state = 'failed';
        task.job.message = e.code
          ? e.message
          : 'Nie udało się zapisać ilustracji. Sprawdź dostęp do danych.';
        if (ledger.pending.length) {
          ledger.pending = [];
          await persistLedger().catch(() => {});
        }
      } finally {
        task.resolve();
        emit();
      }
    }
  }
  function start() {
    if (!worker && !closed && waiting.length)
      worker = Promise.resolve()
        .then(pump)
        .finally(() => {
          worker = null;
          start();
        });
  }
  function enqueue(ticket, { force = false, reuseOnly = false } = {}) {
    if (typeof force !== 'boolean' || typeof reuseOnly !== 'boolean' || (force && reuseOnly))
      throw problem('INVALID', 'Nieprawidłowe żądanie ilustracji.');
    if (closed || (!reuseOnly && (blocked || !provider.available)))
      throw problem(
        'AI_UNAVAILABLE',
        blocked || 'Skonfiguruj klucz API i uruchom program ponownie.',
      );
    if (!store.read().settings.aiEnabled)
      throw problem('AI_UNAVAILABLE', 'Włącz generowanie AI w ustawieniach.');
    if (!valid(ticket)) throw problem('CONFLICT', 'Nieaktualne żądanie ilustracji.');
    const job = {
      ...ticket,
      state: 'queued',
      mode: reuseOnly ? 'reuse' : 'generate',
      message: reuseOnly
        ? 'Oczekuje na użycie zapisanej ilustracji.'
        : 'Oczekuje na wygenerowanie.',
    };
    let resolve;
    const done = new Promise((r) => (resolve = r));
    jobs.set(ticket.collectionId + ':' + ticket.bookId, job);
    waiting.push({ ticket, force, reuseOnly, job, resolve });
    emit();
    start();
    return { job, done };
  }
  function disable() {
    cancelEpoch++;
    for (const task of waiting.splice(0)) {
      task.job.state = 'failed';
      task.job.message = 'Generowanie AI wyłączono.';
      task.resolve();
    }
    emit();
  }
  async function close() {
    closed = true;
    disable();
    currentController?.abort();
    if (worker) await worker;
  }
  return { enqueue, status, disable, close };
}
