import {createHash} from 'node:crypto';
import {canonicalIsbn} from '../public/shared/book-identity.mjs';

const normalized = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl') : '';
export function bookIdentityFingerprint(book) {
  return createHash('sha256').update(JSON.stringify(['resolver-v1', canonicalIsbn(book.isbn), book.providerId ?? null,
    normalized(book.title), normalized(book.authors?.[0])])).digest('hex');
}
export async function resolveBookCover({book, catalog, signal}) {
  signal?.throwIfAborted();
  const isbn = canonicalIsbn(book.isbn), title = normalized(book.title), author = normalized(book.authors?.[0]);
  if (!isbn && (!title || !author)) return null;
  const matches = item => isbn ? canonicalIsbn(item?.isbn) === isbn : normalized(item?.title) === title && normalized(item?.authors?.[0]) === author;
  const cover = item => Number.isSafeInteger(item?.coverId) && item.coverId > 0 ? {catalogCoverId: item.coverId} : null;
  if (!isbn && /^\/books\/OL\d+M$/.test(book.providerId ?? '')) {
    const edition = await catalog.resolveEdition(book.providerId, {signal});
    if (matches(edition) && cover(edition)) return cover(edition);
  }
  const results = await catalog.search(isbn ?? (book.title.trim() + ' ' + book.authors[0].trim()).slice(0, 500), {signal});
  signal?.throwIfAborted();
  const candidates = results.filter(matches), unique = new Map();
  for (const item of candidates) unique.set(item.editionId ?? item.id ?? Symbol(), item);
  if (unique.size !== 1) return null;
  const candidate = [...unique.values()][0];
  if (cover(candidate)) return cover(candidate);
  if (!/^\/books\/OL\d+M$/.test(candidate.editionId ?? '')) return null;
  const edition = await catalog.resolveEdition(candidate.editionId, {signal});
  signal?.throwIfAborted(); return matches(edition) ? cover(edition) : null;
}
