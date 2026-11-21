import test from 'node:test';
import assert from 'node:assert/strict';
import { coverPng } from './helpers/cover-fixtures.mjs';
const module = await import('../src/cover-discovery.mjs').catch(() => ({}));
const isbn = '9780593440643',
  book = {
    title: 'Reacher',
    authors: ['Lee Child'],
    isbn,
    providerId: '/books/OL1M',
    catalogCoverId: 101,
  };
const edition = {
  key: '/books/OL1M',
  title: 'Reacher',
  authors: [{ key: '/authors/OL1A' }],
  isbn_13: [isbn],
  works: [{ key: '/works/OL10W' }],
  covers: [101],
  publishers: ['Jove'],
  publish_date: '2021',
  languages: [{ key: '/languages/eng' }],
};
const polish = {
  key: '/books/OL2M',
  title: 'Poziom śmierci',
  authors: [{ key: '/authors/OL1A' }],
  isbn_13: ['9780140328721'],
  works: [{ key: '/works/OL10W' }],
  covers: [102],
  publishers: ['Albatros'],
  publish_date: '2024',
  languages: [{ key: '/languages/pol' }],
};
function fixture(options = {}) {
  assert.equal(typeof module.createCoverDiscovery, 'function');
  let time = 1000;
  const requests = [],
    saved = [];
  const imageCache = new Map();
  const routes = {
    '/books/OL1M.json': edition,
    ['/isbn/' + isbn + '.json']: edition,
    '/authors/OL1A.json': { name: 'Lee Child' },
    '/works/OL10W.json': { key: '/works/OL10W', title: 'Killing Floor', covers: [101, 102, 103] },
    '/works/OL10W/editions.json?limit=50': {
      entries: [
        polish,
        { ...polish, key: '/books/OL3M', works: [{ key: '/works/OL11W' }], covers: [999] },
      ],
    },
    ...options.routes,
  };
  const loader = {
    load: async ({ kind, value }) =>
      kind === 'isbn' ? null : { bytes: coverPng(Number(value)), mime: 'image/png' },
    cached: (key) => imageCache.get(key) ?? null,
    remember: (key, image) => {
      imageCache.set(key, image);
      return image;
    },
    ...options.loader,
  };
  const service = module.createCoverDiscovery({
    imageLoader: loader,
    inventaireLookup: options.inventaireLookup ?? (async () => null),
    clock: { now: () => time, sleep: async () => {} },
    fetchImpl: async (url) => {
      requests.push(url);
      const key = new URL(url).pathname + new URL(url).search;
      if (options.fetchImpl) return options.fetchImpl(url, routes[key]);
      return Object.hasOwn(routes, key)
        ? Response.json(routes[key])
        : new Response(null, { status: 404 });
    },
    timeoutMs: options.timeoutMs ?? 20000,
  });
  return { service, requests, saved, advance: (ms) => (time += ms) };
}
const titles = (result) => result.candidates.map((c) => c.title);
test('Reacher resolves only Killing Floor covers and ranks exact then Polish editions', async () => {
  const { service } = fixture(),
    result = await service.search(book);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].match, 'edition');
  assert.equal(result.automaticId, result.candidates[0].id);
  assert.equal(result.candidates[0].isbn, isbn);
  assert.equal(result.candidates[1].language, 'pol');
  assert.equal(result.candidates[1].publisher, 'Albatros');
  assert.ok(!titles(result).includes('Other Reacher'));
  assert.ok(
    result.candidates.every((c) =>
      c.previewUrl.startsWith('/api/cover-search/' + result.searchId + '/'),
    ),
  );
  for (const c of result.candidates)
    assert.equal((await service.preview(result.searchId, c.id)).mime, 'image/png');
});
test('other work editions are manual only when the chosen edition has no available cover', async () => {
  const { service } = fixture({
      routes: {
        '/books/OL1M.json': { ...edition, covers: [] },
        ['/isbn/' + isbn + '.json']: { ...edition, covers: [] },
      },
    }),
    result = await service.search({ ...book, catalogCoverId: null });
  assert.equal(result.automaticId, null);
  assert.ok(result.candidates.length >= 2);
  assert.ok(result.candidates.every((c) => c.match === 'work'));
});
test('manual title and author lookup accepts one confirmed work and refuses multiple works', async () => {
  const result = { docs: [{ key: '/works/OL10W', title: 'Reacher', author_name: ['Lee Child'] }] };
  const f = fixture({
    fetchImpl: async (url, data) =>
      new URL(url).pathname === '/search.json'
        ? Response.json(result)
        : data
          ? Response.json(data)
          : new Response(null, { status: 404 }),
  });
  let found = await f.service.search({
    ...book,
    isbn: null,
    providerId: null,
    catalogCoverId: null,
  });
  assert.equal(found.candidates.length, 3);
  assert.equal(found.automaticId, null);
  result.docs.push({ key: '/works/OL11W', title: 'Reacher', author_name: ['Lee Child'] });
  f.advance(300001);
  found = await f.service.search({ ...book, isbn: null, providerId: null, catalogCoverId: null });
  assert.equal(found.candidates.length, 0);
});
test('a provider ID without matching identity cannot lend another Reacher volume its covers', async () => {
  const { service } = fixture({
    routes: {
      '/books/OL1M.json': { ...edition, title: 'Other Reacher', isbn_13: ['9780140328721'] },
      ['/isbn/' + isbn + '.json']: null,
    },
  });
  const result = await service.search(book);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.automaticId, null);
});
test('a failing source preserves the other source and image selection never writes collection assets', async () => {
  const image = { bytes: coverPng(5), mime: 'image/png' };
  const { service, saved } = fixture({
    fetchImpl: async () => new Response(null, { status: 503 }),
    inventaireLookup: async () => image,
  });
  const r = await service.search({ ...book, catalogCoverId: null });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].source, 'inventaire');
  assert.equal(r.automaticId, r.candidates[0].id);
  assert.ok(r.warnings.length);
  await service.preview(r.searchId, r.candidates[0].id);
  assert.deepEqual((await service.select(r.searchId, r.candidates[0].id)).bytes, image.bytes);
  assert.deepEqual(saved, []);
});
test('duplicate image bytes and tiny placeholders never become two usable choices', async () => {
  const { service } = fixture({
    loader: {
      load: async ({ kind, value }) =>
        kind === 'isbn'
          ? null
          : {
              bytes: coverPng(5, value === 103 ? 1 : 8, value === 103 ? 1 : 12),
              mime: 'image/png',
            },
    },
  });
  const r = await service.search(book);
  await service.preview(r.searchId, r.candidates[0].id);
  await assert.rejects(() => service.preview(r.searchId, r.candidates[1].id), {
    code: 'COVER_DUPLICATE',
  });
  await assert.rejects(() => service.preview(r.searchId, r.candidates[2].id), {
    code: 'COVER_UNAVAILABLE',
  });
});
test('candidate count is bounded, sessions expire, invalid inputs and foreign IDs are refused', async () => {
  const { service, advance } = fixture({
    routes: {
      '/works/OL10W.json': {
        key: '/works/OL10W',
        title: 'Killing Floor',
        covers: Array.from({ length: 100 }, (_, i) => i + 100),
      },
    },
  });
  const r = await service.search(book);
  assert.equal(r.candidates.length, 12);
  await assert.rejects(() => service.preview(r.searchId, 'not-a-candidate'), {
    code: 'COVER_SEARCH_EXPIRED',
  });
  advance(15 * 60 * 1000 + 1);
  await assert.rejects(() => service.select(r.searchId, r.candidates[0].id), {
    code: 'COVER_SEARCH_EXPIRED',
  });
  for (const input of [
    { ...book, url: 'https://example.com/x' },
    { ...book, providerId: 'https://127.0.0.1' },
    { ...book, isbn: '9780593440644' },
  ])
    await assert.rejects(() => service.search(input));
});
test('caller cancellation issues no request and a provider ignoring cancellation remains bounded', async () => {
  const f = fixture();
  const c = new AbortController();
  c.abort();
  await assert.rejects(() => f.service.search(book, { signal: c.signal }), { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
  const slow = fixture({
    timeoutMs: 10,
    inventaireLookup: () => new Promise(() => {}),
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    const r = await slow.service.search({ ...book, catalogCoverId: null });
    assert.equal(r.candidates.length, 0);
    assert.ok(r.warnings.length);
  } finally {
    clearTimeout(keepAlive);
  }
});
test('an ISBN image remains usable even when the metadata catalogue has no edition record', async () => {
  const { service } = fixture({
    fetchImpl: async () => new Response(null, { status: 404 }),
    loader: { load: async () => ({ bytes: coverPng(31), mime: 'image/png' }) },
  });
  const r = await service.search({ ...book, providerId: null, catalogCoverId: null });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].match, 'edition');
  assert.equal(r.candidates[0].isbn, isbn);
  assert.equal(r.automaticId, r.candidates[0].id);
  assert.equal((await service.select(r.searchId, r.automaticId)).mime, 'image/png');
});
test('a selected catalogue image survives an unavailable edition catalogue without an ISBN', async () => {
  const { service } = fixture({ fetchImpl: async () => new Response(null, { status: 404 }) });
  const r = await service.search({ ...book, isbn: null });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.automaticId, r.candidates[0].id);
  assert.equal(r.candidates[0].match, 'edition');
  assert.deepEqual((await service.select(r.searchId, r.automaticId)).bytes, coverPng(101));
});
test('a stale advertised CoverID cannot suppress a working exact ISBN image', async () => {
  const { service } = fixture({
    loader: {
      load: async ({ kind, value }) =>
        kind === 'id' && value === 101 ? null : { bytes: coverPng(31), mime: 'image/png' },
    },
  });
  const r = await service.search(book);
  const exact = r.candidates.filter((c) => c.match === 'edition');
  assert.equal(exact.length, 2);
  await assert.rejects(() => service.select(r.searchId, exact[0].id), {
    code: 'COVER_UNAVAILABLE',
  });
  assert.deepEqual((await service.select(r.searchId, exact[1].id)).bytes, coverPng(31));
});
