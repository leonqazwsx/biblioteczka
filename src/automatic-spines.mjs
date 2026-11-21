import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openAutomaticSpineJournal, automaticSpineKey } from './automatic-spine-journal.mjs';
import { bookIdentityFingerprint, resolveBookCover } from './cover-resolver.mjs';
import { validateSpineJob } from './spine-service-client.mjs';
import { problem } from './domain.mjs';

export async function openAutomaticSpines({
  dataDir,
  store,
  covers,
  spines,
  catalog,
  client,
  clock = () => new Date(),
  onState = () => {},
  pollMs = 10000,
}) {
  let journal;
  try {
    journal = await openAutomaticSpineJournal({ dataDir });
  } catch {
    // The collection stays usable. Never reset a corrupt journal and accidentally resubmit paid work.
    return {
      schedule: async () => {},
      status: () => ({ available: false, enabled: false, connection: 'offline', jobs: [] }),
      references() {
        throw problem('INVALID_JOURNAL', 'Dziennik ilustracji wymaga sprawdzenia.');
      },
      close: async () => {},
    };
  }
  let connection = client ? 'online' : 'unconfigured',
    closing = false,
    running = null,
    requested = false,
    timer = null,
    halted = false,
    lastRequest = 0,
    cooldown = 0;
  const interactive = new Set(),
    controller = new AbortController();
  const notify = () => {
    try {
      onState();
    } catch {
      /* Observers do not own writes. */
    }
  };
  const current = (entry) => {
    const state = store.read(),
      book = state.books.find((book) => book.id === entry.bookId);
    if (
      state.collectionId !== entry.collectionId ||
      !book ||
      book.spine ||
      book.coverId !== entry.coverId
    )
      return null;
    if (entry.coverId === null)
      return bookIdentityFingerprint(book) === entry.identity &&
        book.spineGeneration === entry.expectedGeneration
        ? book
        : null;
    return book.spineGeneration === (entry.ticket?.generation ?? entry.expectedGeneration) ||
      (!entry.ticket &&
        entry.phase === 'prepared' &&
        book.spineGeneration === entry.expectedGeneration + 1)
      ? book
      : null;
  };
  async function bounded(operation) {
    controller.signal.throwIfAborted();
    let abort;
    const aborted = new Promise((_, reject) => {
      abort = () => reject(problem('SERVICE_ABORTED', 'Zamykanie aplikacji.'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([aborted, operation()]);
    } finally {
      controller.signal.removeEventListener('abort', abort);
    }
  }
  async function remote(operation) {
    const wait = (client.requestSpacingMs ?? 0) - (performance.now() - lastRequest);
    if (wait > 0) await delay(wait, undefined, { signal: controller.signal });
    controller.signal.throwIfAborted();
    lastRequest = performance.now();
    const response = await bounded(operation);
    connection = 'online';
    cooldown = 0;
    return response;
  }
  async function put(entry) {
    await journal.put(entry);
    notify();
  }
  async function processBook(book) {
    const state = store.read(),
      key = state.collectionId + ':' + book.id;
    let entry = journal.read().find((entry) => automaticSpineKey(entry) === key);
    if (entry && (!current(entry) || entry.origin !== client.origin)) {
      if (entry.origin !== client.origin && current(entry)) {
        await put({ ...entry, phase: 'terminal', state: 'uncertain', retryAt: null });
        return;
      }
      await journal.remove(key);
      entry = null;
    }
    if (
      entry?.phase === 'terminal' ||
      (entry?.retryAt && Date.parse(entry.retryAt) > clock().getTime())
    )
      return;
    if (!entry) {
      entry = {
        collectionId: state.collectionId,
        bookId: book.id,
        coverId: book.coverId,
        expectedGeneration: book.spineGeneration,
        requestId: randomUUID(),
        ticket: null,
        remoteJobId: null,
        origin: client.origin,
        phase: 'prepared',
        retryAt: null,
        identity: bookIdentityFingerprint(book),
        failures: 0,
        state: 'queued',
      };
      await put(entry); // UUID and pre-claim generation must survive a crash before any reservation or POST.
    }
    try {
      if (!entry.coverId) {
        const resolved = await bounded(() =>
          resolveBookCover({ book, catalog, signal: controller.signal }),
        );
        if (!current(entry) || closing) return;
        if (!resolved) {
          await put({ ...entry, phase: 'terminal', state: 'failed', retryAt: null });
          return;
        }
        const { coverId } = await bounded(() =>
          covers.fetchCatalogCover(resolved.catalogCoverId, { signal: controller.signal }),
        );
        if (!current(entry) || closing) return;
        const attached = await store.attachCoverIfCurrent(entry, coverId);
        if (!attached) return;
        book = attached.books.find((book) => book.id === entry.bookId);
        entry = { ...entry, coverId, expectedGeneration: book.spineGeneration };
        await put(entry);
      }
      if (!current(entry) || closing) return;
      if (!entry.ticket) {
        const live = current(entry);
        if (live.spineGeneration === entry.expectedGeneration) {
          const claimed = await store.claimAutomaticSpine(entry);
          if (!claimed) return;
          entry.ticket = claimed.ticket;
        } else
          entry.ticket = {
            collectionId: entry.collectionId,
            bookId: entry.bookId,
            coverId: entry.coverId,
            generation: entry.expectedGeneration + 1,
          };
        await put(entry);
      }
      if (!current(entry) || closing) return;
      let job;
      if (entry.phase === 'downloaded' && entry.result && entry.localAssetId) {
        try {
          await spines.read(entry.localAssetId);
          job = {
            id: entry.remoteJobId,
            state: 'ready',
            retryAt: null,
            errorCode: null,
            result: entry.result,
          };
        } catch (error) {
          if (!['ENOENT', 'INVALID'].includes(error.code) || !entry.remoteJobId) throw error;
          entry = { ...entry, phase: 'submitted', state: 'queued' };
          delete entry.localAssetId;
          delete entry.result;
          await put(entry);
        }
      }
      if (!job) {
        if (!entry.remoteJobId) {
          const cover = await covers.read(entry.coverId);
          if (!current(entry) || closing) return;
          job = await remote(() =>
            client.submit({
              requestId: entry.requestId,
              bytes: cover.bytes,
              mime: cover.mime,
              priority: interactive.has(entry.bookId) ? 'interactive' : 'backfill',
              signal: controller.signal,
            }),
          );
          validateSpineJob(job);
          entry.remoteJobId = job.id;
          entry.phase = 'submitted';
        } else
          job = await remote(() =>
            client.get({ id: entry.remoteJobId, signal: controller.signal }),
          );
        validateSpineJob(job);
        if (job.id !== entry.remoteJobId)
          throw problem('INVALID_JOB', 'Nieprawidłowe powiązanie zadania.');
        if (!current(entry) || closing) return;
        entry = {
          ...entry,
          state: job.state,
          retryAt: job.retryAt,
          errorCode: job.errorCode,
          failures: 0,
        };
        if (['failed', 'uncertain'].includes(job.state)) entry.phase = 'terminal';
        await put(entry);
        if (job.state !== 'ready') return;
        const image = await remote(() =>
          client.download({ id: job.id, expectedResult: job.result, signal: controller.signal }),
        );
        if (!current(entry) || closing) return;
        const saved = await spines.put(image.bytes, image.mime);
        if (saved.assetId !== job.result.assetId)
          throw problem('INVALID_IMAGE', 'Nieprawidłowy wynik ilustracji.');
        entry = { ...entry, phase: 'downloaded', localAssetId: saved.assetId, result: job.result };
        await put(entry);
      }
      if (!current(entry) || closing) return;
      await store.attachSpineIfCurrent(entry.ticket, {
        assetId: job.result.assetId,
        kind: 'ai',
        sourceCoverId: entry.coverId,
        model: job.result.model,
        promptVersion: job.result.promptVersion,
      });
      await put({ ...entry, phase: 'terminal', state: 'ready', retryAt: null });
      interactive.delete(entry.bookId);
    } catch (error) {
      if (closing || controller.signal.aborted) return;
      if (error.code === 'SERVICE_UNAUTHORIZED') connection = 'unauthorized';
      else if (['SERVICE_OFFLINE', 'SERVICE_RETRY'].includes(error.code)) connection = 'offline';
      if (
        [
          'INVALID_JOB',
          'INVALID_IMAGE',
          'INVALID',
          'TOO_LARGE',
          'ENOENT',
          'SERVICE_REJECTED',
          'SERVICE_REDIRECT',
        ].includes(error.code)
      )
        await put({ ...entry, phase: 'terminal', state: 'failed', retryAt: null });
      else {
        const failures = Math.min(100000, (entry.failures ?? 0) + 1),
          retryAt = new Date(
            Math.max(
              clock().getTime() + Math.min(300000, 1000 * 2 ** Math.min(failures - 1, 9)),
              Date.parse(error.retryAt ?? '') || 0,
            ),
          ).toISOString();
        if (error.code === 'SERVICE_RETRY') cooldown = Date.parse(retryAt);
        await put({ ...entry, failures, retryAt });
      }
    }
  }
  async function drain() {
    do {
      requested = false;
      const seen = new Set();
      for (const entry of journal.read())
        if (
          entry.collectionId !== store.read().collectionId ||
          !store.read().books.some((book) => book.id === entry.bookId) ||
          store.read().books.find((book) => book.id === entry.bookId)?.spine
        )
          await journal.remove(automaticSpineKey(entry));
      while (
        !closing &&
        !halted &&
        connection !== 'unauthorized' &&
        clock().getTime() >= cooldown
      ) {
        const books = store.read().books.filter((book) => !book.spine && !seen.has(book.id));
        const book = books.find((book) => interactive.has(book.id)) ?? books[0];
        if (!book) break;
        seen.add(book.id);
        await processBook(book);
      }
    } while (requested && !closing && !halted && connection !== 'unauthorized');
    if (!closing && !halted && connection !== 'unauthorized') {
      const active = journal.read().filter((entry) => entry.phase !== 'terminal');
      if (active.length || requested) {
        const at = Math.max(
          cooldown,
          Math.min(
            ...active.map((entry) =>
              entry.retryAt ? Date.parse(entry.retryAt) : clock().getTime() + pollMs,
            ),
          ),
        );
        timer = setTimeout(
          () => schedule(),
          Math.min(2147483647, Math.max(100, at - clock().getTime())),
        );
        timer.unref();
      }
    }
  }
  function schedule({ newBookIds = [] } = {}) {
    for (const id of newBookIds) interactive.add(id);
    if (
      closing ||
      halted ||
      !client ||
      store.recovery === 'unrecoverable' ||
      connection === 'unauthorized'
    )
      return Promise.resolve();
    clearTimeout(timer);
    timer = null;
    requested = true;
    if (!running)
      running = drain()
        .catch(() => {
          halted = true;
          connection = 'offline';
          notify();
        })
        .finally(() => {
          running = null;
          if (requested && !closing && !halted) schedule();
        });
    return running;
  }
  return {
    schedule,
    status() {
      const state = store.read(),
        entries = journal.read();
      return {
        available: Boolean(client) && !halted,
        enabled: Boolean(client) && !halted,
        connection,
        jobs: entries
          .filter((entry) => entry.collectionId === state.collectionId && current(entry))
          .map((entry) => ({
            bookId: entry.bookId,
            generation: entry.ticket?.generation ?? entry.expectedGeneration,
            state: entry.state ?? 'queued',
            message:
              connection === 'offline'
                ? 'Ilustracja pojawi się po odzyskaniu połączenia'
                : connection === 'unauthorized' || entry.errorCode === 'PROVIDER_AUTH'
                  ? 'Automatyczne ilustracje są obecnie niedostępne.'
                  : entry.state === 'queued' && entry.errorCode === 'PROVIDER_QUOTA'
                    ? 'Ilustracja czeka na odnowienie limitu'
                    : ['queued', 'generating'].includes(entry.state ?? 'queued')
                      ? 'Ilustracja w przygotowaniu'
                      : 'Pozostaje lokalny grzbiet.',
          })),
      };
    },
    references() {
      const entries = journal.read().filter((entry) => entry.phase !== 'terminal');
      return {
        covers: [...new Set(entries.map((entry) => entry.coverId).filter(Boolean))],
        spines: [...new Set(entries.map((entry) => entry.localAssetId).filter(Boolean))],
      };
    },
    async close() {
      if (closing) {
        if (running) await running;
        return;
      }
      closing = true;
      clearTimeout(timer);
      controller.abort();
      if (running) await running;
      await journal.close();
    },
  };
}
