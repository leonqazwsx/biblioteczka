import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { problem } from './domain.mjs';
import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { validateImageBytes } from './image-validation.mjs';
import { createCoverImageLoader } from './cover-images.mjs';
import { t } from '../public/shared/i18n.mjs';
export function imageMime(bytes) {
  if (
    bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw problem('INVALID', t('Wybierz poprawny obraz JPEG, PNG lub WebP.'));
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
function untilAborted(promise, signal) {
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
export async function openCoverStore(
  dataDir,
  {
    fsAdapter = fs,
    fetchImpl = (...args) => fetch(...args),
    isbnFallback = null,
    imageLoader = createCoverImageLoader({ fetchImpl }),
  } = {},
) {
  const f = fsAdapter,
    root = path.join(dataDir, 'covers'),
    localImages = new Map();
  await f.mkdir(root, { recursive: true });
  function file(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      throw problem('INVALID', t('Nieprawidłowy identyfikator okładki.'));
    return path.join(root, id);
  }
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  async function put(bytes, mime) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 5 * 1024 * 1024)
      throw problem('TOO_LARGE', t('Okładka jest za duża.'));
    if (imageMime(bytes) !== mime)
      throw problem('INVALID', t('Format obrazu nie odpowiada zawartości.'));
    const coverId = hash(bytes),
      destination = file(coverId);
    try {
      const existing = await f.readFile(destination);
      if (hash(existing) === coverId) return { coverId, mime };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const temp = destination + '.' + crypto.randomUUID() + '.tmp';
    try {
      await f.writeFile(temp, bytes);
      for (let attempt = 0; ; attempt++) {
        try {
          await f.rename(temp, destination);
          break;
        } catch (e) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 5) throw e;
          await delay(40 * 2 ** attempt);
        }
      }
    } finally {
      await f.unlink(temp).catch(() => {});
    }
    return { coverId, mime };
  }
  async function localImage(key) {
    const entry = localImages.get(key);
    if (!entry) return null;
    if (entry.until <= Date.now()) {
      localImages.delete(key);
      return null;
    }
    try {
      const bytes = await f.readFile(file(entry.coverId));
      if (hash(bytes) !== entry.coverId) throw problem('INVALID', t('Uszkodzona okładka.'));
      validateImageBytes(bytes, entry.mime);
      localImages.delete(key);
      localImages.set(key, entry);
      return { bytes, mime: entry.mime };
    } catch (error) {
      if (!['ENOENT', 'INVALID'].includes(error.code)) throw error;
      localImages.delete(key);
      return null;
    }
  }
  async function saveImage(key, image, { signal, save = put } = {}) {
    signal?.throwIfAborted();
    validateImageBytes(image.bytes, image.mime);
    // Always retain the save callback: the guarded store refreshes protection and
    // checks cancellation after entering its gate, even on a positive cache hit.
    const result = await save(image.bytes, image.mime);
    if (/^[a-f0-9]{64}$/.test(result?.coverId)) {
      localImages.delete(key);
      localImages.set(key, {
        coverId: result.coverId,
        mime: image.mime,
        until: Date.now() + 15 * 60 * 1000,
      });
      if (localImages.size > 100) localImages.delete(localImages.keys().next().value);
    }
    return result;
  }
  async function fetchCover(kind, value, options = {}) {
    options.signal?.throwIfAborted();
    const key = `openlibrary:${kind}:${value}:L`,
      local = await localImage(key);
    const image =
      local ?? (await imageLoader.load({ kind, value, size: 'L' }, { signal: options.signal }));
    options.signal?.throwIfAborted();
    if (!image) {
      if (options.allowMissing) return null;
      throw problem('COVER_UNAVAILABLE', t('Nie znaleziono okładki. Możesz dodać plik lub link.'), {
        reason: 'missing',
      });
    }
    return saveImage(key, image, options);
  }
  return {
    put,
    async read(id) {
      const bytes = await f.readFile(file(id));
      if (hash(bytes) !== id)
        throw problem('INVALID', t('Uszkodzona okładka. Przywróć ją z kopii lub dodaj ponownie.'));
      return { bytes, mime: imageMime(bytes) };
    },
    async fetchCatalogCover(id, options = {}) {
      if (!Number.isSafeInteger(id) || id <= 0)
        throw problem('INVALID', t('Nieprawidłowa okładka katalogowa.'));
      return fetchCover('id', id, options);
    },
    async fetchIsbnCover(value, options = {}) {
      const isbn = canonicalIsbn(
        typeof value === 'string' && value.length <= 24
          ? value.replace(/[\s-]/g, '').toUpperCase()
          : null,
      );
      if (!isbn) throw problem('INVALID_ISBN', t('Podaj poprawny ISBN książki.'));
      options.signal?.throwIfAborted();
      const overall = boundedSignal(options.signal, 20000);
      let primaryError;
      try {
        const primary = boundedSignal(overall.signal, 8000);
        try {
          const saved = await untilAborted(
            fetchCover('isbn', isbn, { ...options, signal: primary.signal, allowMissing: true }),
            primary.signal,
          );
          if (saved) return { ...saved, source: 'openlibrary' };
        } catch (error) {
          options.signal?.throwIfAborted();
          if (error.code !== 'COVER_UNAVAILABLE' && !primary.signal.aborted) throw error;
          primaryError =
            error.code === 'COVER_UNAVAILABLE'
              ? error
              : problem('COVER_UNAVAILABLE', t('Źródło okładki przekroczyło czas oczekiwania.'), {
                  reason: 'timeout',
                });
        } finally {
          primary.close();
        }
        if (isbnFallback) {
          const fallback = boundedSignal(overall.signal, 8000),
            key = 'inventaire:' + isbn;
          try {
            fallback.signal.throwIfAborted();
            let image = await localImage(key);
            image ??= imageLoader.cached?.(key);
            image ??= await untilAborted(
              isbnFallback(isbn, { signal: fallback.signal }),
              fallback.signal,
            );
            fallback.signal.throwIfAborted();
            if (image) {
              validateImageBytes(image.bytes, image.mime);
              imageLoader.remember?.(key, image);
              const saved = await saveImage(key, image, { ...options, signal: fallback.signal });
              return { ...saved, source: 'inventaire' };
            }
          } catch (error) {
            options.signal?.throwIfAborted();
            throw problem(
              'COVER_UNAVAILABLE',
              t('Nie udało się pobrać okładki z dostępnych źródeł. Możesz dodać plik lub link.'),
              error.details ?? { reason: fallback.signal.aborted ? 'timeout' : 'network' },
            );
          } finally {
            fallback.close();
          }
        }
        if (primaryError) throw primaryError;
        return null;
      } finally {
        overall.close();
      }
    },
  };
}
