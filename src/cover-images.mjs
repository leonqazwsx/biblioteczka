import { setTimeout as delay } from 'node:timers/promises';
import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { problem } from './domain.mjs';
import { imageMime } from './covers.mjs';
import { validateImageBytes } from './image-validation.mjs';
import { createCoverRedirectValidator } from './cover-redirects.mjs';
import { t } from '../public/shared/i18n.mjs';

const imageLimit = 5 * 1024 * 1024,
  cacheLifetime = 15 * 60 * 1000,
  maximumEntries = 100;
const copy = (image) => (image ? { bytes: Buffer.from(image.bytes), mime: image.mime } : null);
const unavailable = (reason, details = {}) =>
  problem('COVER_UNAVAILABLE', t('Nie udało się pobrać okładki. Możesz dodać plik lub link.'), {
    reason,
    ...details,
  });
function untilAborted(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort),
      abort = () => {
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
function boundedSignal(parent, milliseconds) {
  const controller = new AbortController(),
    timer = setTimeout(
      () => controller.abort(new DOMException('Cover request timed out.', 'TimeoutError')),
      milliseconds,
    );
  return {
    signal: AbortSignal.any([controller.signal, ...(parent ? [parent] : [])]),
    close: () => clearTimeout(timer),
  };
}
function identifier(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw problem('INVALID', t('Nieprawidłowa okładka.'));
  let { kind, value, size = 'L' } = input;
  if (!['S', 'M', 'L'].includes(size))
    throw problem('INVALID', t('Nieprawidłowy rozmiar okładki.'));
  if (kind === 'id') {
    if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) value = Number(value);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw problem('INVALID', t('Nieprawidłowa okładka katalogowa.'));
  } else if (kind === 'olid') {
    if (typeof value !== 'string' || !/^OL[1-9]\d{0,15}M$/.test(value))
      throw problem('INVALID', t('Nieprawidłowe wydanie katalogowe.'));
  } else if (kind === 'isbn') {
    value = canonicalIsbn(
      typeof value === 'string' && value.length <= 24
        ? value.replace(/[\s-]/g, '').toUpperCase()
        : null,
    );
    if (!value) throw problem('INVALID', t('Nieprawidłowy ISBN okładki.'));
  } else throw problem('INVALID', t('Nieprawidłowe źródło okładki.'));
  return { kind, value, size, key: `openlibrary:${kind}:${value}:${size}` };
}
function retryAfter(value, now) {
  const seconds =
    typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const requested = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(value);
  return Number.isFinite(requested)
    ? Math.max(now + 1000, Math.min(Number.MAX_SAFE_INTEGER, requested))
    : now + 60000;
}

// Preview images stay in memory; only the cover store's explicit save writes files.
export function createCoverImageLoader({
  fetchImpl = (...args) => fetch(...args),
  clock = {},
  maximumBytes = 32 * 1024 * 1024,
} = {}) {
  const now = () => Number(typeof clock === 'function' ? clock() : (clock.now?.() ?? Date.now())),
    sleep = clock.sleep ?? ((ms) => delay(ms));
  const budget = Number.isFinite(maximumBytes) ? Math.max(0, maximumBytes) : 32 * 1024 * 1024;
  const images = new Map(),
    pending = new Map(),
    cooldowns = new Map();
  let used = 0;
  function remove(key) {
    const entry = images.get(key);
    if (entry) {
      used -= entry.image.bytes.length;
      images.delete(key);
    }
  }
  function prune() {
    for (const [key, entry] of images) if (entry.until <= now()) remove(key);
  }
  function cached(key) {
    const entry = images.get(key);
    if (!entry) return null;
    if (entry.until <= now()) {
      remove(key);
      return null;
    }
    images.delete(key);
    images.set(key, entry);
    return copy(entry.image);
  }
  function remember(key, image) {
    if (typeof key !== 'string' || !key || key.length > 300)
      throw problem('INVALID', t('Nieprawidłowy klucz obrazu.'));
    if (Buffer.isBuffer(image?.bytes) && image.bytes.length > imageLimit)
      throw problem('TOO_LARGE', t('Okładka jest za duża.'));
    validateImageBytes(image?.bytes, image?.mime);
    prune();
    remove(key);
    if (image.bytes.length <= budget) {
      while (images.size && (used + image.bytes.length > budget || images.size >= maximumEntries))
        remove(images.keys().next().value);
      const stored = copy(image);
      images.set(key, { image: stored, until: now() + cacheLifetime });
      used += stored.bytes.length;
    }
    return copy(image);
  }
  async function attempt(request, signal) {
    let url = `https://covers.openlibrary.org/b/${request.kind}/${request.value}-${request.size}.jpg?default=false`;
    const validateRedirect = createCoverRedirectValidator(request);
    for (let redirects = 0; redirects < 4; redirects++) {
      signal.throwIfAborted();
      const response = await untilAborted(fetchImpl(url, { signal, redirect: 'manual' }), signal);
      signal.throwIfAborted();
      if (response.status >= 300 && response.status < 400) {
        await untilAborted(response.body?.cancel(), signal);
        url = validateRedirect(url, response.headers.get('location'));
        continue;
      }
      if (!response.ok) {
        await untilAborted(response.body?.cancel(), signal);
        if (response.status === 404) return null;
        if (response.status === 429 || (response.status === 403 && request.kind === 'isbn')) {
          const retryAt = retryAfter(response.headers.get('retry-after'), now());
          cooldowns.set(request.kind, retryAt);
          throw unavailable('rate_limit', { retryAt, status: response.status });
        }
        const transient =
            response.status === 408 || (response.status >= 500 && response.status <= 599),
          details = { status: response.status, transient };
        if (transient && response.headers.get('retry-after') !== null) {
          details.retryAt = retryAfter(response.headers.get('retry-after'), now());
          cooldowns.set(request.kind, details.retryAt);
        }
        throw unavailable('http', details);
      }
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) > imageLimit) {
        await untilAborted(response.body?.cancel(), signal);
        throw problem('TOO_LARGE', t('Okładka jest za duża.'));
      }
      const read = async () => {
        const chunks = [];
        let size = 0,
          complete = false;
        const reader = response.body?.getReader?.();
        const append = (chunk) => {
          signal.throwIfAborted();
          size += chunk.length;
          if (size > imageLimit) throw problem('TOO_LARGE', t('Okładka jest za duża.'));
          chunks.push(Buffer.from(chunk));
        };
        const abort = () => {
          if (reader) reader.cancel(signal.reason).catch(() => {});
          else response.body?.destroy?.(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (reader) {
            for (;;) {
              const { done, value } = await untilAborted(reader.read(), signal);
              if (done) break;
              append(value);
            }
          } else for await (const chunk of response.body ?? []) append(chunk);
          signal.throwIfAborted();
          complete = true;
          return Buffer.concat(chunks);
        } finally {
          signal.removeEventListener('abort', abort);
          if (!complete) abort();
          try {
            reader?.releaseLock();
          } catch {}
        }
      };
      const bytes = await untilAborted(read(), signal);
      signal.throwIfAborted();
      const mime = imageMime(bytes);
      validateImageBytes(bytes, mime);
      return { bytes, mime };
    }
    throw problem('INVALID', t('Zbyt wiele przekierowań okładki.'));
  }
  async function download(request, sharedSignal) {
    const total = boundedSignal(sharedSignal, 8000),
      until = now() + 8000;
    try {
      for (let tries = 0; tries < 2; tries++) {
        total.signal.throwIfAborted();
        const current = boundedSignal(total.signal, 3750);
        let failure;
        try {
          return await attempt(request, current.signal);
        } catch (error) {
          sharedSignal.throwIfAborted();
          if (
            ['INVALID', 'TOO_LARGE'].includes(error.code) ||
            error.details?.reason === 'rate_limit'
          )
            throw error;
          if (error.code === 'COVER_UNAVAILABLE' && !error.details?.transient) throw error;
          failure =
            error.code === 'COVER_UNAVAILABLE'
              ? error
              : unavailable(
                  current.signal.aborted || error.name === 'TimeoutError' ? 'timeout' : 'network',
                );
          if (tries === 1) throw failure;
        } finally {
          current.close();
        }
        const wait = Math.max(150, (failure.details?.retryAt ?? 0) - now());
        // A long provider backoff is returned to the caller, never held open inside
        // the eight-second image budget or replaced with an immediate retry.
        if (wait >= until - now() - 3750) throw failure;
        await untilAborted(sleep(wait), total.signal);
      }
    } catch (error) {
      sharedSignal.throwIfAborted();
      if (['INVALID', 'TOO_LARGE', 'COVER_UNAVAILABLE'].includes(error.code)) throw error;
      throw unavailable(total.signal.aborted ? 'timeout' : 'network');
    } finally {
      total.close();
    }
  }
  async function load(input, { signal } = {}) {
    signal?.throwIfAborted();
    const request = identifier(input),
      existing = cached(request.key);
    if (existing) return existing;
    const retryAt = cooldowns.get(request.kind);
    if (retryAt > now()) throw unavailable('rate_limit', { retryAt });
    let job = pending.get(request.key);
    if (!job) {
      if (pending.size >= maximumEntries) throw unavailable('network');
      job = { controller: new AbortController(), consumers: 0, settled: false };
      job.promise = Promise.resolve()
        .then(() => download(request, job.controller.signal))
        .then((image) => {
          job.controller.signal.throwIfAborted();
          return image ? remember(request.key, image) : null;
        });
      pending.set(request.key, job);
      const complete = () => {
        job.settled = true;
        if (pending.get(request.key) === job) pending.delete(request.key);
      };
      job.promise.then(complete, complete);
    }
    job.consumers++;
    try {
      return copy(await untilAborted(job.promise, signal));
    } finally {
      if (--job.consumers === 0 && !job.settled) {
        job.controller.abort();
        if (pending.get(request.key) === job) pending.delete(request.key);
      }
    }
  }
  return { load, remember, cached };
}
