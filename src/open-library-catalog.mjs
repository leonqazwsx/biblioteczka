import { problem } from './domain.mjs';
import { cleanSubjects } from '../public/shared/categories.mjs';
import { createCatalogRequest } from './catalog-request.mjs';
import { t } from '../public/shared/i18n.mjs';
export function normalizeIsbn(text) {
  const v = text.replace(/[\s-]/g, '').toUpperCase();
  if (!/^(\d{13}|\d{9}[\dX])$/.test(v)) return null;
  const sum =
    v.length === 13
      ? [...v].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0)
      : [...v].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
  if (sum % (v.length === 13 ? 10 : 11))
    throw problem('INVALID_ISBN', t('ISBN ma nieprawidłową sumę kontrolną.'));
  return v;
}
export function createOpenLibraryCatalog(options = {}) {
  const request = createCatalogRequest('https://openlibrary.org', options);
  const item = (d) => {
    const e = d.editions?.docs?.[0],
      cover = e?.cover_i ?? d.cover_i;
    return {
      provider: 'openlibrary',
      id: d.key,
      title: e?.title || d.title || '',
      authors: Array.isArray(d.author_name) ? d.author_name : [],
      editionId: /^\/books\/OL\d+M$/.test(e?.key)
        ? e.key
        : d.cover_edition_key
          ? '/books/' + d.cover_edition_key
          : null,
      coverId: Number.isInteger(cover) && cover > 0 ? cover : null,
      isbn: null,
      publisher: null,
      publicationYear: d.first_publish_year ? String(d.first_publish_year) : null,
      language: e?.language?.[0] ?? null,
      pageCount: null,
      subjects: cleanSubjects(d.subject),
    };
  };
  async function edition(record, requestedIsbn = null, signal) {
    signal?.throwIfAborted();
    if (!record) return null;
    const authors = [];
    for (const ref of (record.authors ?? []).slice(0, 5))
      if (/^\/authors\/OL\d+A$/.test(ref.key)) {
        const author = await request(ref.key + '.json', signal);
        if (author?.name) authors.push(author.name);
      }
    let subjects = cleanSubjects(record.subjects);
    const work = Array.isArray(record.works)
      ? record.works.find((ref) => /^\/works\/OL\d+W$/.test(ref?.key))
      : null;
    if (work)
      try {
        const metadata = await request(work.key + '.json', signal);
        subjects = cleanSubjects([...subjects, ...cleanSubjects(metadata?.subjects)]);
      } catch {
        signal?.throwIfAborted();
      }
    return {
      provider: 'openlibrary',
      id: record.key,
      title: record.title ?? '',
      authors,
      editionId: record.key,
      coverId: record.covers?.find((x) => Number.isInteger(x) && x > 0) ?? null,
      isbn: requestedIsbn ?? record.isbn_13?.[0] ?? record.isbn_10?.[0] ?? null,
      publisher: record.publishers?.[0] ?? null,
      publicationYear: record.publish_date ?? null,
      language: record.languages?.[0]?.key?.split('/').pop() ?? null,
      pageCount:
        Number.isInteger(record.number_of_pages) && record.number_of_pages > 0
          ? record.number_of_pages
          : null,
      subjects,
    };
  }
  async function searchPage(query, { signal, page = 1 } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500)
      throw problem('INVALID', t('Wpisz tytuł, autora lub ISBN.'));
    const isbn = normalizeIsbn(query);
    if (isbn) {
      const result = await edition(await request('/isbn/' + isbn + '.json', signal), isbn, signal);
      return { items: result ? [result] : [], next: null };
    }
    const data = await request(
      '/search.json?q=' +
        encodeURIComponent(query.trim()) +
        '&lang=pl&limit=20&page=' +
        page +
        '&fields=key,title,author_name,cover_edition_key,cover_i,first_publish_year,subject,editions,editions.key,editions.title,editions.cover_i,editions.language',
      signal,
    );
    if (!Array.isArray(data?.docs))
      throw problem('CATALOG_UNAVAILABLE', t('Katalog zwrócił nieprawidłowe dane.'));
    const total = data.numFound ?? data.num_found;
    return {
      items: data.docs
        .slice(0, 20)
        .filter((d) => d.key && d.title)
        .map(item),
      next: (Number.isFinite(total) ? page * 20 < total : data.docs.length === 20)
        ? page + 1
        : null,
    };
  }
  return {
    searchPage,
    async search(query, options) {
      return (await searchPage(query, options)).items;
    },
    async resolveEdition(id, { signal } = {}) {
      if (typeof id !== 'string' || !/^\/books\/OL\d+M$/.test(id))
        throw problem('INVALID', t('Nieprawidłowe wydanie.'));
      return edition(await request(id + '.json', signal), null, signal);
    },
  };
}
