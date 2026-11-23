import { randomUUID, createHash } from 'node:crypto';
import { createCatalogRequest } from './catalog-request.mjs';
import { canonicalIsbn } from '../public/shared/book-identity.mjs';
import { validateImageBytes } from './image-validation.mjs';
import { problem } from './domain.mjs';
import { t } from '../public/shared/i18n.mjs';

const origin = 'https://openlibrary.org',
  ttl = 15 * 60 * 1000;
const editionKey = (v) => typeof v === 'string' && /^\/books\/OL\d+M$/.test(v);
const workKey = (v) => typeof v === 'string' && /^\/works\/OL\d+W$/.test(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const normalized = (v) =>
  text(v)
    .normalize('NFKC')
    .toLocaleLowerCase('pl')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const isbnOf = (v) =>
  canonicalIsbn(typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : null);
const isbnMatches = (record, isbn) =>
  !!isbn &&
  [...(record?.isbn_13 ?? []), ...(record?.isbn_10 ?? [])].some((v) => isbnOf(v) === isbn);
const coverIds = (v) =>
  Array.isArray(v) ? [...new Set(v.filter((n) => Number.isSafeInteger(n) && n > 0))] : [];
const warning = (source, error) => ({
  source,
  code:
    error?.details?.reason === 'rate_limit'
      ? 'rate_limit'
      : error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'timeout'
        : 'unavailable',
  message:
    source +
    ': ' +
    (error?.details?.reason === 'rate_limit'
      ? t('chwilowy limit zapytań.')
      : t('część okładek jest chwilowo niedostępna.')),
});
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
      (v) => {
        signal.removeEventListener('abort', abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', abort);
        reject(e);
      },
    );
  });
}
function validateInput(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !['title', 'authors', 'isbn', 'providerId', 'catalogCoverId'].includes(k),
    )
  )
    throw problem('INVALID', t('Podaj dane książki do wyszukania okładki.'));
  const title = text(input.title),
    authors = input.authors ?? [],
    isbn = isbnOf(input.isbn),
    providerId = input.providerId ?? null,
    catalogCoverId = input.catalogCoverId ?? null;
  if (
    (input.title != null && typeof input.title !== 'string') ||
    title.length > 500 ||
    !Array.isArray(authors) ||
    authors.length > 20 ||
    authors.some((a) => typeof a !== 'string' || a.length > 200) ||
    (!isbn && (!title || !text(authors[0])))
  )
    throw problem('INVALID', t('Podaj ISBN albo tytuł i autora.'));
  if (input.isbn != null && input.isbn !== '' && !isbn)
    throw problem('INVALID_ISBN', t('Podaj poprawny ISBN książki.'));
  if (
    providerId !== null &&
    !editionKey(providerId) &&
    !(typeof providerId === 'string' && /^bn:\d{1,16}$/.test(providerId))
  )
    throw problem('INVALID', t('Nieprawidłowe wydanie książki.'));
  if (catalogCoverId !== null && (!Number.isSafeInteger(catalogCoverId) || catalogCoverId <= 0))
    throw problem('INVALID', t('Nieprawidłowa okładka katalogowa.'));
  return { title, authors: authors.map(text).filter(Boolean), isbn, providerId, catalogCoverId };
}
// Existing byte validation checks the entire structure. This extra check is only
// for remote gallery images, so tiny historic local test/user assets still load.
function checkImage(image) {
  if (!image) throw problem('COVER_UNAVAILABLE', t('Ta okładka jest teraz niedostępna.'));
  const b = image.bytes;
  validateImageBytes(b, image.mime);
  let width = 5,
    height = 5;
  if (image.mime === 'image/png') {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (image.mime === 'image/jpeg') {
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p++] !== 255) break;
      while (b[p] === 255) p++;
      const marker = b[p++];
      if ([192, 193, 194].includes(marker)) {
        height = b.readUInt16BE(p + 3);
        width = b.readUInt16BE(p + 5);
        break;
      }
      const length = b.readUInt16BE(p);
      if (length < 2) break;
      p += length;
    }
  } else if (image.mime === 'image/webp') {
    for (let p = 12; p + 8 < b.length; ) {
      const kind = b.toString('ascii', p, p + 4),
        length = b.readUInt32LE(p + 4),
        start = p + 8;
      if (kind === 'VP8 ') {
        width = b.readUInt16LE(start + 6) & 16383;
        height = b.readUInt16LE(start + 8) & 16383;
        break;
      }
      if (kind === 'VP8L') {
        const bits = b.readUInt32LE(start + 1);
        width = (bits & 16383) + 1;
        height = ((bits >>> 14) & 16383) + 1;
        break;
      }
      if (kind === 'VP8X') {
        width = b.readUIntLE(start + 4, 3) + 1;
        height = b.readUIntLE(start + 7, 3) + 1;
        break;
      }
      p = start + length + (length & 1);
    }
  }
  if (width <= 4 && height <= 4)
    throw problem('COVER_UNAVAILABLE', t('Źródło zwróciło pustą miniaturę.'));
  return image;
}

export function createCoverDiscovery({
  imageLoader,
  inventaireLookup = null,
  fetchImpl = fetch,
  clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  timeoutMs = 20000,
} = {}) {
  const now = typeof clock === 'function' ? clock : clock.now.bind(clock),
    sessions = new Map();
  async function safeFetch(url, init) {
    for (let step = 0; step < 4; step++) {
      const response = await fetchImpl(url, { ...init, redirect: 'manual' });
      if (response.status < 300 || response.status >= 400) return response;
      await response.body?.cancel();
      const next = new URL(response.headers.get('location'), url);
      if (next.origin !== origin || next.username || next.password)
        throw problem('INVALID', t('Niedozwolone przekierowanie katalogu.'));
      url = next.href;
    }
    throw problem('CATALOG_UNAVAILABLE', t('Katalog zwrócił zbyt wiele przekierowań.'));
  }
  const request = createCatalogRequest(origin, {
    fetchImpl: safeFetch,
    clock: typeof clock === 'function' ? { now, sleep: async () => {} } : clock,
  });
  const alive = (searchId, candidateId) => {
    const session = sessions.get(searchId),
      candidate = session?.items.find((c) => c.id === candidateId);
    if (!session || session.until <= now() || !candidate) {
      if (session?.until <= now()) sessions.delete(searchId);
      throw problem('COVER_SEARCH_EXPIRED', t('Propozycje okładek wygasły. Wyszukaj je ponownie.'));
    }
    sessions.delete(searchId);
    sessions.set(searchId, session);
    return { session, candidate };
  };
  const publicCandidate = (c, searchId) => ({
    id: c.id,
    title: c.title,
    isbn: c.isbn,
    language: c.language,
    publisher: c.publisher,
    publicationYear: c.publicationYear,
    source: c.source,
    match: c.match,
    previewUrl: '/api/cover-search/' + searchId + '/' + c.id,
    sourceUrl: c.sourceUrl,
  });
  async function names(record, signal) {
    const refs = (record?.authors ?? [])
      .slice(0, 3)
      .map((v) => v?.key)
      .filter((v) => typeof v === 'string' && /^\/authors\/OL\d+A$/.test(v));
    const results = await Promise.all(refs.map((ref) => request(ref + '.json', signal)));
    return results.map((v) => v?.name).filter(Boolean);
  }
  async function sameBook(record, input, signal) {
    if (!record) return false;
    if (isbnMatches(record, input.isbn)) return true;
    if (normalized(record.title) !== normalized(input.title) || !input.authors[0]) return false;
    return (await names(record, signal)).some(
      (a) => normalized(a) === normalized(input.authors[0]),
    );
  }
  function olCandidate(id, record, input, match, work) {
    return {
      id: randomUUID(),
      image: { kind: 'id', value: id },
      title: text(record?.title) || text(work?.title) || input.title,
      isbn:
        record?.isbn_13?.map(isbnOf).find(Boolean) ??
        record?.isbn_10?.map(isbnOf).find(Boolean) ??
        null,
      language: record?.languages?.[0]?.key?.match(/^\/languages\/([a-z]{3})$/)?.[1] ?? null,
      publisher:
        typeof record?.publishers?.[0] === 'string' ? record.publishers[0].slice(0, 500) : null,
      publicationYear: text(record?.publish_date).slice(0, 100) || null,
      source: 'openlibrary',
      match,
      sourceUrl:
        origin + (editionKey(record?.key) ? record.key : workKey(work?.key) ? work.key : ''),
    };
  }
  async function collectOl(input, items, warnings, signal, evidence) {
    let anchor = null,
      workId = null;
    if (editionKey(input.providerId)) {
      const record = await request(input.providerId + '.json', signal);
      if (editionKey(record?.key)) {
        if (await sameBook(record, input, signal)) anchor = record;
        else evidence.conflict = true;
      }
    }
    if (!anchor && input.isbn) {
      const record = await request('/isbn/' + input.isbn + '.json', signal);
      if (editionKey(record?.key) && isbnMatches(record, input.isbn)) anchor = record;
    }
    if (anchor) {
      const exact = input.isbn
        ? isbnMatches(anchor, input.isbn)
        : editionKey(input.providerId) && anchor.key === input.providerId;
      for (const id of coverIds(anchor.covers))
        items.push(olCandidate(id, anchor, input, exact ? 'edition' : 'work'));
      workId = anchor.works?.map((r) => r?.key).find(workKey);
    }
    if (!workId && input.title && input.authors[0]) {
      const params = new URLSearchParams({
        title: input.title,
        author: input.authors[0],
        limit: '8',
        fields: 'key,title,author_name',
      });
      const data = await request('/search.json?' + params, signal);
      const matches = new Map(
        (data?.docs ?? [])
          .filter(
            (d) =>
              workKey(d.key) &&
              normalized(d.title) === normalized(input.title) &&
              d.author_name?.some((a) => normalized(a) === normalized(input.authors[0])),
          )
          .map((d) => [d.key, d]),
      );
      if (matches.size === 1) workId = [...matches.keys()][0];
    }
    if (!workId) return;
    let work;
    try {
      work = await request(workId + '.json', signal);
    } catch (e) {
      warnings.push(warning('Open Library', e));
      return;
    }
    if (!work || work.key !== workId) return;
    try {
      const data = await request(workId + '/editions.json?limit=50', signal);
      for (const record of (data?.entries ?? []).slice(0, 50))
        if (editionKey(record?.key) && record.works?.some((r) => r?.key === workId))
          for (const id of coverIds(record.covers))
            items.push(
              olCandidate(
                id,
                record,
                input,
                anchor?.key === record.key && (input.isbn ? isbnMatches(record, input.isbn) : true)
                  ? 'edition'
                  : 'work',
                work,
              ),
            );
    } catch (e) {
      warnings.push(warning('Open Library', e));
    }
    for (const id of coverIds(work.covers)) items.push(olCandidate(id, null, input, 'work', work));
  }
  async function collectInventaire(input, items, signal) {
    if (!input.isbn || !inventaireLookup) return;
    const key = 'inventaire:' + input.isbn;
    let image = imageLoader.cached(key);
    if (!image) {
      image = await abortable(inventaireLookup(input.isbn, { signal }), signal);
      if (!image) return;
      checkImage(image);
      imageLoader.remember(key, image);
    }
    items.push({
      id: randomUUID(),
      cacheKey: key,
      title: input.title,
      isbn: input.isbn,
      language: null,
      publisher: null,
      publicationYear: null,
      source: 'inventaire',
      match: 'edition',
      sourceUrl: 'https://inventaire.io/entity/isbn:' + input.isbn,
    });
  }
  async function search(input, { signal } = {}) {
    signal?.throwIfAborted();
    input = validateInput(input);
    const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      items = [],
      warnings = [];
    const olJob = async () => {
      const evidence = { conflict: false };
      try {
        await collectOl(input, items, warnings, deadline, evidence);
      } catch (error) {
        signal?.throwIfAborted();
        warnings.push(warning('Open Library', error));
      }
      // A user-selected catalogue image remains meaningful if the separate JSON
      // service fails. Do not borrow it when fetched metadata proves a conflict.
      if (
        input.catalogCoverId &&
        !evidence.conflict &&
        !items.some((c) => c.image?.kind === 'id' && c.image.value === input.catalogCoverId)
      )
        items.push({
          ...olCandidate(input.catalogCoverId, null, input, 'edition'),
          isbn: input.isbn,
          sourceUrl: editionKey(input.providerId) ? origin + input.providerId : origin,
        });
      // Covers can exist by ISBN even when the separate metadata catalogue is
      // missing that edition. Verify the actual image rather than hiding it.
      if (input.isbn)
        try {
          const image = await imageLoader.load(
            { kind: 'isbn', value: input.isbn, size: 'L' },
            { signal: deadline },
          );
          if (image) {
            checkImage(image);
            items.push({
              id: randomUUID(),
              image: { kind: 'isbn', value: input.isbn },
              title: input.title,
              isbn: input.isbn,
              language: null,
              publisher: null,
              publicationYear: null,
              source: 'openlibrary',
              match: 'edition',
              sourceUrl: origin + '/isbn/' + input.isbn,
            });
          }
        } catch (error) {
          signal?.throwIfAborted();
          warnings.push(warning('Open Library', error));
        }
    };
    const jobs = [
      ['Open Library', olJob],
      ['Inventaire', () => collectInventaire(input, items, deadline)],
    ];
    await Promise.all(
      jobs.map(async ([source, load]) => {
        try {
          await abortable(load(), deadline);
        } catch (error) {
          signal?.throwIfAborted();
          warnings.push(warning(source, error));
        }
      }),
    );
    signal?.throwIfAborted();
    const rank = (c) =>
      c.match !== 'edition' ? 3 : c.image?.kind === 'id' ? 0 : c.source === 'inventaire' ? 1 : 2;
    const sorted = items.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.language === 'pol' ? 0 : a.language ? 1 : 2) -
          (b.language === 'pol' ? 0 : b.language ? 1 : 2),
    );
    const unique = new Map();
    for (const item of sorted) {
      const key = item.image ? 'ol:' + item.image.kind + ':' + item.image.value : item.cacheKey;
      if (!unique.has(key)) unique.set(key, item);
    }
    const selected = [...unique.values()].slice(0, 12),
      searchId = randomUUID();
    const session = { until: now() + ttl, items: selected, seen: new Map() };
    sessions.set(searchId, session);
    for (const [id, entry] of sessions) if (entry.until <= now()) sessions.delete(id);
    while (sessions.size > 100) sessions.delete(sessions.keys().next().value);
    return {
      searchId,
      candidates: selected.map((c) => publicCandidate(c, searchId)),
      automaticId: selected.find((c) => c.match === 'edition')?.id ?? null,
      warnings: [...new Map(warnings.map((w) => [w.source + ':' + w.code, w])).values()],
    };
  }
  async function image(searchId, candidateId, size, { signal } = {}) {
    signal?.throwIfAborted();
    const { session, candidate } = alive(searchId, candidateId);
    if (candidate.duplicate)
      throw problem('COVER_DUPLICATE', t('Ta sama grafika jest już na liście.'));
    let result = candidate.image
      ? await imageLoader.load({ ...candidate.image, size }, { signal })
      : imageLoader.cached(candidate.cacheKey);
    if (!result && candidate.cacheKey) {
      const isbn = candidate.isbn;
      result = await inventaireLookup(isbn, { signal });
      signal?.throwIfAborted();
      if (result) imageLoader.remember(candidate.cacheKey, result);
    }
    signal?.throwIfAborted();
    checkImage(result);
    alive(searchId, candidateId);
    const digest = size + ':' + createHash('sha256').update(result.bytes).digest('hex'),
      existing = session.seen.get(digest);
    if (existing && existing !== candidateId) {
      candidate.duplicate = true;
      throw problem('COVER_DUPLICATE', t('Ta sama grafika jest już na liście.'));
    }
    session.seen.set(digest, candidateId);
    return { ...result, source: candidate.source };
  }
  return {
    search,
    preview: (searchId, candidateId, options) => image(searchId, candidateId, 'M', options),
    select: (searchId, candidateId, options) => image(searchId, candidateId, 'L', options),
  };
}
