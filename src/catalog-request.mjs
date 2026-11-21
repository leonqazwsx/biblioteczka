import { problem } from './domain.mjs';
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
// Each provider has its own paced queue, shared in-flight lookups and bounded cache.
export function createCatalogRequest(
  origin,
  {
    fetchImpl = fetch,
    clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  } = {},
) {
  const cache = new Map(),
    pending = new Map();
  let last = 0,
    queue = Promise.resolve();
  const cachedData = (key) => {
    const entry = cache.get(key);
    return entry && entry.until > clock.now() ? entry : null;
  };
  return async function request(key, signal) {
    signal?.throwIfAborted();
    const cached = cachedData(key);
    if (cached) return structuredClone(cached.data);
    let job = pending.get(key);
    if (!job) {
      job = { controller: new AbortController(), consumers: 0, settled: false };
      const sharedSignal = job.controller.signal;
      job.promise = queue.then(async () => {
        sharedSignal.throwIfAborted();
        const cached = cachedData(key);
        if (cached) return cached.data;
        await untilAborted(clock.sleep(Math.max(0, 1000 - (clock.now() - last))), sharedSignal);
        sharedSignal.throwIfAborted();
        last = clock.now();
        try {
          const response = await fetchImpl(origin + key, {
            signal: AbortSignal.any([sharedSignal, AbortSignal.timeout(8000)]),
            headers: { 'User-Agent': 'BookshelfWallpaper/0.15 (personal desktop library)' },
          });
          sharedSignal.throwIfAborted();
          if (response.status === 404) return null;
          if (!response.ok) throw Error(String(response.status));
          const data = await response.json();
          sharedSignal.throwIfAborted();
          cache.set(key, { until: clock.now() + 300000, data });
          if (cache.size > 100) cache.delete(cache.keys().next().value);
          return data;
        } catch {
          sharedSignal.throwIfAborted();
          throw problem(
            'CATALOG_UNAVAILABLE',
            'Katalog jest teraz niedostępny. Spróbuj ponownie lub dodaj książkę ręcznie.',
          );
        }
      });
      pending.set(key, job);
      queue = job.promise.catch(() => {});
      const complete = () => {
        job.settled = true;
        if (pending.get(key) === job) pending.delete(key);
      };
      job.promise.then(complete, complete);
    }
    job.consumers++;
    try {
      return structuredClone(await untilAborted(job.promise, signal));
    } finally {
      if (--job.consumers === 0 && !job.settled) {
        job.controller.abort();
        if (pending.get(key) === job) pending.delete(key);
      }
    }
  };
}
