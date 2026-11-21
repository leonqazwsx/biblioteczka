import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { problem } from './domain.mjs';
import { imageMime } from './covers.mjs';
import { validateImageBytes } from './image-validation.mjs';
const maximum = 5 * 1024 * 1024;
const invalid = () =>
  problem('INVALID', 'Wklej bezpośredni adres HTTPS publicznego obrazu JPEG, PNG lub WebP.');
const unavailable = () =>
  problem(
    'IMAGE_UNAVAILABLE',
    'Nie udało się pobrać obrazu. Sprawdź link lub wybierz plik z komputera.',
  );
function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const parts = address.toLowerCase().split('::'),
    left = parts[0].split(':').filter(Boolean),
    right = (parts[1] ?? '').split(':').filter(Boolean);
  const words = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right,
  ].map((value) => parseInt(value, 16));
  return (
    words.length === 8 &&
    words[0] >= 0x2000 &&
    words[0] <= 0x3fff &&
    words[0] !== 0x2002 &&
    !(words[0] === 0x2001 && [0, 2, 0x10, 0x20, 0xdb8].includes(words[1]))
  );
}
function addressUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw invalid();
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw invalid();
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (isIP(host) && !publicAddress(host))
  )
    throw invalid();
  url.hash = '';
  return { url, host };
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
export async function downloadRemoteImage(
  value,
  { signal, lookup = dnsLookup, requestImpl = https.request } = {},
) {
  const active = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
  try {
    let current = value;
    for (let redirects = 0; redirects < 4; redirects++) {
      active.throwIfAborted();
      const { url, host } = addressUrl(current);
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await abortable(lookup(host, { all: true, verbatim: true }), active);
      active.throwIfAborted();
      if (
        !Array.isArray(addresses) ||
        !addresses.length ||
        addresses.some(
          (entry) => !publicAddress(entry.address) || isIP(entry.address) !== entry.family,
        )
      )
        throw invalid();
      const pinned = addresses.find((entry) => entry.family === 4) ?? addresses[0];
      const response = await new Promise((resolve, reject) => {
        const request = requestImpl(
          url,
          {
            method: 'GET',
            agent: false,
            signal: active,
            headers: {
              Accept: 'image/jpeg,image/png,image/webp',
              'Accept-Encoding': 'identity',
              'User-Agent': 'Biblioteczka/0.15 image import',
            },
            lookup: (_hostname, options, done) => {
              if (typeof options === 'function') {
                done = options;
                options = {};
              }
              if (active.aborted) {
                done(active.reason);
                return;
              }
              done(null, options?.all ? [pinned] : pinned.address, pinned.family);
            },
          },
          resolve,
        );
        request.once('error', reject);
        request.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (typeof location !== 'string') throw unavailable();
        try {
          current = new URL(location, url).href;
        } catch {
          throw invalid();
        }
        continue;
      }
      if (response.statusCode !== 200) {
        response.destroy();
        throw unavailable();
      }
      const encoding = response.headers['content-encoding'];
      const type = String(response.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (
        (encoding && encoding !== 'identity') ||
        (type &&
          ![
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp',
            'application/octet-stream',
          ].includes(type))
      ) {
        response.destroy();
        throw invalid();
      }
      if (Number(response.headers['content-length']) > maximum) {
        response.destroy();
        throw problem('TOO_LARGE', 'Obraz z linku może mieć maksymalnie 5 MiB.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        active.throwIfAborted();
        size += chunk.length;
        if (size > maximum) {
          response.destroy();
          throw problem('TOO_LARGE', 'Obraz z linku może mieć maksymalnie 5 MiB.');
        }
        chunks.push(chunk);
      }
      active.throwIfAborted();
      const bytes = Buffer.concat(chunks),
        mime = imageMime(bytes);
      validateImageBytes(bytes, mime);
      return { bytes, mime };
    }
    throw unavailable();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (['INVALID', 'TOO_LARGE', 'IMAGE_UNAVAILABLE'].includes(error.code)) throw error;
    throw unavailable();
  }
}
