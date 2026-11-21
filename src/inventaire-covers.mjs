import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { createCatalogRequest } from './catalog-request.mjs';
import { downloadRemoteImage } from './remote-image.mjs';
import { problem } from './domain.mjs';

const isbnValue = (value) =>
  canonicalIsbn(typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : null);
export function createInventaireCoverLookup({
  fetchImpl = fetch,
  imageDownloader = downloadRemoteImage,
  ...options
} = {}) {
  const request = createCatalogRequest('https://inventaire.io', {
    ...options,
    fetchImpl: (url, init) => fetchImpl(url, { ...init, redirect: 'error' }),
  });
  return async function lookup(value, { signal } = {}) {
    signal?.throwIfAborted();
    const isbn = isbnValue(value);
    if (!isbn) throw problem('INVALID_ISBN', 'Podaj poprawny ISBN książki.');
    const key = 'isbn:' + isbn,
      data = await request('/api/entities/by-uris?uris=' + encodeURIComponent(key), signal),
      uri = data?.redirects?.[key];
    if (typeof uri !== 'string' || !/^inv:[a-f0-9]{32}$/.test(uri)) return null;
    const edition = data?.entities?.[uri];
    if (edition?.type !== 'edition') return null;
    const identifiers = ['wdt:P212', 'wdt:P957'].flatMap((key) =>
      Array.isArray(edition.claims?.[key]) ? edition.claims[key] : [],
    );
    if (!identifiers.some((identifier) => isbnValue(identifier) === isbn)) return null;
    const image = edition.image?.url;
    if (typeof image !== 'string' || !/^\/img\/entities\/[a-f0-9]{40}$/.test(image)) return null;
    signal?.throwIfAborted();
    return imageDownloader('https://inventaire.io' + image, { signal });
  };
}
