import { problem } from './domain.mjs';
import { cleanSubjects } from '../public/shared/categories.mjs';
import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { createCatalogRequest } from './catalog-request.mjs';

const endpoint = '/api/institutions/bibs.json';
const clean = (value) =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s/:;,=]+$/u, '')
        .trim()
    : '';
const fields = (record, tag) =>
  (record.marc?.fields ?? []).flatMap((field) =>
    field[tag] && typeof field[tag] === 'object' ? [field[tag]] : [],
  );
const values = (field, code) =>
  (field?.subfields ?? []).flatMap((part) => (typeof part[code] === 'string' ? [part[code]] : []));
const all = (record, tag, code) => fields(record, tag).flatMap((field) => values(field, code));
const isbn = (value) => {
  const match =
    typeof value === 'string' ? value.match(/(?:97[89][\d -]{10,20}|\d[\d -]{7,16}[\dX])/i) : null;
  const code = match?.[0].replace(/[\s-]/g, '').toUpperCase();
  return canonicalIsbn(code) ? code : null;
};
const authorName = (field) => {
  const name = clean(values(field, 'a')[0]);
  const parts = name.split(',').map((s) => s.trim());
  return (field.ind1 === '1' && parts.length === 2 ? parts[1] + ' ' + parts[0] : name).slice(
    0,
    200,
  );
};
const isAuthor = (field, primary = false) => {
  const roles = [...values(field, 'e'), ...values(field, '4')].map((v) =>
    clean(v).toLocaleLowerCase('pl'),
  );
  return roles.some((v) => v === 'autor' || v === 'aut') || (primary && !roles.length);
};
export function bnBook(record, requestedIsbn = null) {
  if (
    !record ||
    record.deleted ||
    !/^\d{1,16}$/.test(String(record.id)) ||
    !Number.isSafeInteger(Number(record.id)) ||
    record.kind !== 'książka'
  )
    return null;
  const main = fields(record, '245')[0];
  if (!main) return null;
  const primaryTitle = clean(values(main, 'a')[0]),
    subtitle = values(main, 'b').map(clean).filter(Boolean).join(' : ');
  const parts = [
    primaryTitle,
    ...values(main, 'n').map(clean),
    ...values(main, 'p').map(clean),
  ].filter(Boolean);
  const title = (parts.join('. ') + (subtitle ? ' : ' + subtitle : '')).slice(0, 500);
  if (!title) return null;
  const authors = [
    ...new Set(
      [
        ...fields(record, '100').filter((f) => isAuthor(f, true)),
        ...fields(record, '700').filter((f) => isAuthor(f)),
      ]
        .map(authorName)
        .filter(Boolean),
    ),
  ].slice(0, 20);
  const isbns = [...new Set(all(record, '020', 'a').map(isbn).filter(Boolean))];
  if (requestedIsbn && !isbns.some((code) => canonicalIsbn(code) === canonicalIsbn(requestedIsbn)))
    return null;
  const publisher =
    clean([...all(record, '264', 'b'), ...all(record, '260', 'b')][0]).slice(0, 500) || null;
  const language =
    all(record, '041', 'a').find((v) => /^[a-z]{3}$/.test(v)) ??
    record.marc?.fields
      ?.find((f) => typeof f['008'] === 'string')
      ?.['008'].slice(35, 38)
      .trim();
  const pages = all(record, '300', 'a')[0]?.match(
    /^(\d{1,5})\s+(?:s\.|stron|strona|strony|pages)/iu,
  );
  return {
    provider: 'bn',
    id: 'bn:' + record.id,
    editionId: 'bn:' + record.id,
    title,
    authors,
    isbn: requestedIsbn ?? isbns[0] ?? null,
    publisher,
    publicationYear: /^\d{4}$/.test(String(record.publicationYear))
      ? String(record.publicationYear)
      : null,
    language: /^[a-z]{3}$/.test(language) ? language : null,
    pageCount: pages && Number(pages[1]) > 0 ? Number(pages[1]) : null,
    subjects: cleanSubjects(
      ['655', '650', '658', '380'].flatMap((tag) => all(record, tag, 'a').map(clean)),
    ),
    coverId: null,
  };
}
export function createBnCatalog(options = {}) {
  const request = createCatalogRequest('https://data.bn.org.pl', options);
  async function searchPage(
    query,
    { field = 'title', since = null, signal, requestedIsbn = null } = {},
  ) {
    const params = new URLSearchParams({ [field]: query, kind: 'książka', limit: '20' });
    if (Number(since) > 0) params.set('sinceId', since);
    const data = await request(endpoint + '?' + params, signal);
    if (!Array.isArray(data?.bibs))
      throw problem('CATALOG_UNAVAILABLE', 'Biblioteka Narodowa zwróciła nieprawidłowe dane.');
    const warnings = [];
    let next = null;
    if (data.bibs.length && data.nextPage) {
      try {
        const url = new URL(data.nextPage);
        const value = url.searchParams.get('sinceId');
        if (
          url.origin !== 'https://data.bn.org.pl' ||
          url.pathname !== endpoint ||
          !/^\d{1,16}$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) <= Number(since ?? 0)
        )
          throw Error('Invalid cursor');
        next = value;
      } catch {
        warnings.push('Biblioteka Narodowa: dalsza strona wyników jest niedostępna.');
      }
    }
    return {
      items: data.bibs.map((record) => bnBook(record, requestedIsbn)).filter(Boolean),
      next,
      warnings,
    };
  }
  return {
    searchPage,
    async resolveEdition(id, { signal } = {}) {
      if (typeof id !== 'string' || !/^bn:\d{1,16}$/.test(id))
        throw problem('INVALID', 'Nieprawidłowe wydanie.');
      const data = await request(
        endpoint + '?' + new URLSearchParams({ id: id.slice(3), kind: 'książka', limit: '1' }),
        signal,
      );
      if (!Array.isArray(data?.bibs))
        throw problem('CATALOG_UNAVAILABLE', 'Biblioteka Narodowa zwróciła nieprawidłowe dane.');
      return bnBook(data.bibs.find((record) => 'bn:' + record.id === id));
    },
  };
}
