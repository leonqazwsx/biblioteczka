import { createHash } from 'node:crypto';
import { problem } from './domain.mjs';
import { createOpenLibraryCatalog, normalizeIsbn } from './open-library-catalog.mjs';
import { createBnCatalog } from './bn-catalog.mjs';
import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { cleanSubjects } from '../public/shared/categories.mjs';
import { t } from '../public/shared/i18n.mjs';
export { normalizeIsbn };

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function score(book, query) {
  const needle = normalize(query),
    title = normalize(book.title),
    author = normalize(book.authors?.join(' '));
  if (canonicalIsbn(query) && canonicalIsbn(query) === canonicalIsbn(book.isbn)) return 100;
  if (title === needle) return 90;
  if (title.startsWith(needle + ' ')) return 80;
  if (author === needle) return 70;
  return needle.split(' ').filter((word) => (title + ' ' + author).includes(word)).length;
}
function merge(items) {
  const result = [];
  for (const item of items) {
    const code = canonicalIsbn(item.isbn),
      existing = result.find(
        (book) => book.id === item.id || (code && canonicalIsbn(book.isbn) === code),
      );
    if (!existing) {
      result.push({ ...item });
      continue;
    }
    const [primary, extra] =
      item.coverId && !existing.coverId ? [item, existing] : [existing, item];
    const combined = {
      ...primary,
      subjects: cleanSubjects([
        ...cleanSubjects(primary.subjects),
        ...cleanSubjects(extra.subjects),
      ]),
    };
    for (const key of ['authors', 'publisher', 'publicationYear', 'language', 'pageCount'])
      if (combined[key] == null || (Array.isArray(combined[key]) && !combined[key].length))
        combined[key] = extra[key];
    Object.assign(existing, combined);
  }
  return result;
}
export function createCatalog(options = {}) {
  const ol = createOpenLibraryCatalog(options),
    bn = createBnCatalog(options);
  async function searchPage(query, { signal, cursor = null } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500)
      throw problem('INVALID', t('Wpisz tytuł, autora lub ISBN.'));
    signal?.throwIfAborted();
    query = query.trim();
    const isbn = normalizeIsbn(query),
      fingerprint = createHash('sha256').update(query).digest('hex').slice(0, 16);
    let positions = { ol: 1, title: '0', author: isbn ? null : '0' };
    if (cursor != null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(cursor))
          throw Error();
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (
          decoded.q !== fingerprint ||
          !decoded.positions ||
          Object.keys(decoded.positions).sort().join(',') !== 'author,ol,title'
        )
          throw Error();
        positions = decoded.positions;
        if (
          positions.ol !== null &&
          (!Number.isInteger(positions.ol) || positions.ol < 1 || positions.ol > 1000)
        )
          throw Error();
        for (const key of ['title', 'author'])
          if (
            positions[key] !== null &&
            (typeof positions[key] !== 'string' ||
              !/^\d{1,16}$/.test(positions[key]) ||
              !Number.isSafeInteger(Number(positions[key])))
          )
            throw Error();
      } catch {
        throw problem('INVALID', t('Nieprawidłowa strona wyników. Wyszukaj książkę ponownie.'));
      }
    }
    const sources = [
      {
        key: 'ol',
        name: 'Open Library',
        load: () => ol.searchPage(query, { signal, page: positions.ol }),
      },
      {
        key: 'title',
        name: 'Biblioteka Narodowa',
        load: () =>
          bn.searchPage(isbn ?? query, {
            signal,
            field: isbn ? 'isbnIssn' : 'title',
            since: positions.title,
            requestedIsbn: isbn,
          }),
      },
      {
        key: 'author',
        name: 'Biblioteka Narodowa',
        load: () => bn.searchPage(query, { signal, field: 'author', since: positions.author }),
      },
    ].filter((source) => positions[source.key] !== null);
    const outcomes = await Promise.allSettled(sources.map((source) => source.load()));
    signal?.throwIfAborted();
    if (outcomes.length && outcomes.every((result) => result.status === 'rejected'))
      throw problem(
        'CATALOG_UNAVAILABLE',
        t('Katalogi są teraz niedostępne. Spróbuj ponownie lub dodaj książkę ręcznie.'),
      );
    const items = [],
      warnings = [],
      next = { ol: null, title: null, author: null };
    outcomes.forEach((result, index) => {
      const source = sources[index];
      if (result.status === 'rejected') {
        warnings.push(source.name + t(' — chwilowo brak połączenia. Wyniki mogą być niepełne.'));
        return;
      }
      next[source.key] = result.value.next;
      warnings.push(...(result.value.warnings ?? []));
      items.push(
        ...result.value.items.filter((book) => {
          if (book.provider !== 'bn' || isbn) return true;
          const text = normalize(book.title + ' ' + book.authors.join(' '));
          return normalize(query)
            .split(' ')
            .every((word) => text.includes(word));
        }),
      );
    });
    const sorted = merge(items).sort((a, b) => score(b, isbn ?? query) - score(a, isbn ?? query));
    return {
      items: sorted,
      warnings: [...new Set(warnings)],
      nextCursor: Object.values(next).some((value) => value !== null)
        ? Buffer.from(JSON.stringify({ q: fingerprint, positions: next })).toString('base64url')
        : null,
    };
  }
  return {
    searchPage,
    async search(query, options) {
      return (await searchPage(query, options)).items;
    },
    async resolveEdition(id, options) {
      return typeof id === 'string' && id.startsWith('bn:')
        ? bn.resolveEdition(id, options)
        : ol.resolveEdition(id, options);
    },
  };
}
