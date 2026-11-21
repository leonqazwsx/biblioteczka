import test from 'node:test';
import assert from 'node:assert/strict';
import { png, variant } from './helpers/service-images.mjs';
const { createCoverImageLoader } = await import('../src/cover-images.mjs').catch(() => ({}));
const request = { kind: 'id', value: 14425283 };
function loader(options = {}) {
  assert.equal(typeof createCoverImageLoader, 'function', 'shared image loader exists');
  return createCoverImageLoader({ clock: { now: () => 1000, sleep: async () => {} }, ...options });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const archiveM = 'https://archive.org/download/m_covers_0014/m_covers_0014_42.zip/0014425283-M.jpg';
const archiveL = 'https://archive.org/download/l_covers_0014/l_covers_0014_42.zip/0014425283-L.jpg';
const dataM =
  'https://ia801601.us.archive.org/view_archive.php?archive=/25/items/m_covers_0014/m_covers_0014_42.zip&file=0014425283-M.jpg';
const dataL =
  'https://ia801601.us.archive.org/view_archive.php?archive=/25/items/l_covers_0014/l_covers_0014_42.zip&file=0014425283-L.jpg';
function redirectedLoader(first, second, { reply = () => new Response(png) } = {}) {
  const calls = [],
    a = loader({
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1)
          return new Response(null, { status: 302, headers: { location: first } });
        if (calls.length === 2 && second)
          return new Response(null, { status: 302, headers: { location: second } });
        return reply();
      },
    });
  return { a, calls };
}

test('the confirmed Reacher cover archive chain loads M and L images with manual bounded redirects', async () => {
  for (const [size, bundle, data] of [
    ['M', archiveM, dataM],
    ['L', archiveL, dataL],
  ]) {
    const { a, calls } = redirectedLoader(bundle, data);
    assert.deepEqual(await a.load({ ...request, size }), { bytes: png, mime: 'image/png' });
    assert.deepEqual(
      calls.map((call) => call.url),
      [`https://covers.openlibrary.org/b/id/14425283-${size}.jpg?default=false`, bundle, data],
    );
    assert.ok(calls.every((call) => call.options.redirect === 'manual'));
  }
});
test('a trusted ISBN or edition redirect may establish its cover ID once', async () => {
  for (const input of [
    { kind: 'isbn', value: '9780140328721', size: 'M' },
    { kind: 'olid', value: 'OL7353617M', size: 'M' },
  ]) {
    const { a, calls } = redirectedLoader(archiveM, dataM);
    assert.ok(await a.load(input));
    assert.equal(calls.length, 3);
  }
});
test('documented legacy cover bundles validate the id shard and allow regional numeric data servers', async () => {
  const first = 'https://archive.org/download/olcovers1442/olcovers1442-M.zip/14425283-M.jpg';
  for (const host of [
    'ia801601.us.archive.org',
    'dn720001.ca.archive.org',
    'ia600005.eu.archive.org',
  ]) {
    const data = `https://${host}/view_archive.php?archive=/25/items/olcovers1442/olcovers1442-M.zip&file=14425283-M.jpg`,
      { a, calls } = redirectedLoader(first, data);
    assert.ok(await a.load({ ...request, size: 'M' }));
    assert.equal(calls.length, 3);
  }
});
test('the first archive hop rejects unrelated bundles, wrong cover identities and unsafe endpoints before requesting them', async () => {
  const bad = [
    archiveM.replace('https:', 'http:'),
    archiveM.replace('archive.org/', 'user:pass@archive.org/'),
    archiveM.replace('archive.org/', 'archive.org:444/'),
    archiveM.replace('archive.org/', 'archive.org.evil.example/'),
    archiveM.replace('m_covers_0014/', 'm_covers_0015/'),
    archiveM.replace('_42.zip', '_43.zip'),
    archiveM.replace('0014425283-M.jpg', '0014425284-M.jpg'),
    archiveL,
    'https://archive.org/download/unrelated/unrelated.zip/0014425283-M.jpg',
    'https://archive.org/metadata/m_covers_0014',
    'https://archive.org/download/m_covers_0014/m_covers_0014_42.zip',
    archiveM + '?download=1',
    archiveM + '#fragment',
    archiveM.replace('0014425283-M.jpg', '%2e%2e/private'),
    dataM,
    'https://archive.org/download/olcovers1443/olcovers1443-M.zip/14425283-M.jpg',
    'https://archive.org/download/olcovers1442/olcovers1442-L.zip/14425283-L.jpg',
    'https://archive.org/download/olcovers1442/olcovers1442-M.zip/014425283-M.jpg',
  ];
  for (const first of bad) {
    const { a, calls } = redirectedLoader(first);
    await assert.rejects(a.load({ ...request, size: 'M' }), { code: 'INVALID' }, first);
    assert.equal(calls.length, 1, first);
  }
});
test('archive data hops stay pinned to the first item, zip and image and accept no arbitrary parameters', async () => {
  const bad = [
    dataM.replace('ia801601.us.archive.org', 'evil.example'),
    dataM.replace('ia801601.us.archive.org', 'ia801601.us.archive.org.evil.example'),
    dataM.replace('ia801601.us.archive.org', 'anything.us.archive.org'),
    dataM.replace('ia801601.us.archive.org', 'ia801601.archive.org'),
    dataM.replace('ia801601.us.archive.org', 'ia801601.au.archive.org'),
    dataM.replace('ia801601.us.archive.org', 'archive.org'),
    dataM.replace('https:', 'http:'),
    dataM.replace('ia801601.us.archive.org', 'user@ia801601.us.archive.org'),
    dataM.replace('ia801601.us.archive.org', 'ia801601.us.archive.org:444'),
    dataM.replace('/view_archive.php', '/metadata'),
    dataM.replace('/25/items/', '/25/private/'),
    dataM.replace('archive=/25/items/', 'archive=https://evil.example/25/items/'),
    dataM.replaceAll('m_covers_0014', 'm_covers_0015'),
    dataM.replace('_42.zip', '_43.zip'),
    dataM.replace('file=0014425283-M.jpg', 'file=0014425284-M.jpg'),
    dataL,
    dataM + '&download=1',
    dataM + '&file=0014425283-M.jpg',
    dataM + '&archive=/25/items/m_covers_0014/m_covers_0014_42.zip',
    dataM + '&callback=alert',
    dataM.replace('file=0014425283-M.jpg', 'file=../secret'),
    dataM.replace('/25/items/', '/25/items/../'),
    dataM + '#ignored',
    archiveM.replace('0014425283-M.jpg', '0014425284-M.jpg'),
    'https://covers.openlibrary.org/image.jpg',
  ];
  for (const second of bad) {
    const { a, calls } = redirectedLoader(archiveM, second);
    await assert.rejects(a.load({ ...request, size: 'M' }), { code: 'INVALID' }, second);
    assert.equal(calls.length, 2, second);
  }
  const { a, calls } = redirectedLoader(
    archiveM,
    dataM.replace('0014425283-M.jpg', '0014425284-M.jpg'),
  );
  await assert.rejects(a.load({ kind: 'isbn', value: '9780140328721', size: 'M' }), {
    code: 'INVALID',
  });
  assert.equal(calls.length, 2);
});
test('archive image responses retain size validation and the existing four-request chain bound', async () => {
  const { a, calls } = redirectedLoader(archiveM, dataM, {
    reply: () => new Response(png, { headers: { 'content-length': String(6 * 1024 * 1024) } }),
  });
  await assert.rejects(a.load({ ...request, size: 'M' }), { code: 'TOO_LARGE' });
  assert.equal(calls.length, 3);
  let count = 0;
  const loop = loader({
    fetchImpl: async () => {
      count++;
      return new Response(null, {
        status: 302,
        headers: { location: count === 1 ? archiveM : dataM },
      });
    },
  });
  await assert.rejects(loop.load({ ...request, size: 'M' }), { code: 'INVALID' });
  assert.equal(count, 4);
});

test('a transient 503 is retried once and the validated image is reused without network', async () => {
  let calls = 0;
  const a = loader({
    fetchImpl: async () =>
      ++calls === 1 ? new Response(null, { status: 503 }) : new Response(png),
  });
  assert.deepEqual(await a.load(request), { bytes: png, mime: 'image/png' });
  assert.deepEqual(await a.load(request), { bytes: png, mime: 'image/png' });
  assert.equal(calls, 2);
});
test('network failures and 408/5xx stop after two attempts and remain retryable', async () => {
  for (const failure of [
    () => {
      throw new TypeError('offline');
    },
    () => new Response(null, { status: 408 }),
    () => new Response(null, { status: 503 }),
  ]) {
    let calls = 0;
    const a = loader({
      fetchImpl: async () => {
        calls++;
        return failure();
      },
    });
    await assert.rejects(
      a.load(request),
      (error) => error.code === 'COVER_UNAVAILABLE' && typeof error.details.reason === 'string',
    );
    assert.equal(calls, 2);
    await assert.rejects(a.load(request), { code: 'COVER_UNAVAILABLE' });
    assert.equal(calls, 4);
  }
});
test('transient Retry-After delays the retry and a long wait is deferred to a later call', async () => {
  let calls = 0,
    now = 1000;
  const waits = [];
  const a = loader({
    clock: {
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    },
    fetchImpl: async () =>
      ++calls === 1
        ? new Response(null, { status: 503, headers: { 'retry-after': '1' } })
        : new Response(png),
  });
  assert.ok(await a.load(request));
  assert.equal(calls, 2);
  assert.ok(waits[0] >= 1000);
  calls = 0;
  const b = loader({
    clock: {
      now: () => now,
      sleep: async () => {
        throw Error('must not wait for 120seconds');
      },
    },
    fetchImpl: async () => {
      calls++;
      return new Response(null, { status: 503, headers: { 'retry-after': '120' } });
    },
  });
  await assert.rejects(
    b.load(request),
    (error) => error.code === 'COVER_UNAVAILABLE' && error.details.retryAt === now + 120000,
  );
  assert.equal(calls, 1);
  await assert.rejects(b.load(request), { code: 'COVER_UNAVAILABLE' });
  assert.equal(calls, 1);
});
test('a true 404 returns absence after one request without poisoning future attempts', async () => {
  let calls = 0;
  const a = loader({
    fetchImpl: async () =>
      ++calls === 1 ? new Response(null, { status: 404 }) : new Response(png),
  });
  assert.equal(await a.load(request), null);
  assert.equal(calls, 1);
  assert.ok(await a.load(request));
  assert.equal(calls, 2);
});
test('429 and ISBN 403 set a shared path cooldown and respect Retry-After', async () => {
  for (const status of [429, 403]) {
    let now = 1000,
      calls = 0;
    const a = loader({
      clock: { now: () => now, sleep: async () => {} },
      fetchImpl: async () =>
        ++calls === 1
          ? new Response(null, { status, headers: { 'retry-after': '120' } })
          : new Response(png),
    });
    const isbn = { kind: 'isbn', value: '9780140328721' };
    await assert.rejects(
      a.load(isbn),
      (error) =>
        error.code === 'COVER_UNAVAILABLE' &&
        error.details.reason === 'rate_limit' &&
        error.details.retryAt === 121000,
    );
    await assert.rejects(a.load({ kind: 'isbn', value: '9788370541163' }), {
      code: 'COVER_UNAVAILABLE',
    });
    assert.equal(calls, 1);
    assert.ok(await a.load(request));
    assert.equal(calls, 2);
    now = 121001;
    assert.ok(await a.load(isbn));
    assert.equal(calls, 3);
  }
});
test('nontransient HTTP failures and malformed files are never retried', async () => {
  for (const response of [
    () => new Response(null, { status: 400 }),
    () => new Response(Buffer.from([255, 216, 255, 217])),
    () => new Response(png.subarray(0, 30)),
    () => new Response('<html>bad</html>'),
  ]) {
    let calls = 0;
    const a = loader({
      fetchImpl: async () => {
        calls++;
        return response();
      },
    });
    await assert.rejects(a.load(request), (error) =>
      ['INVALID', 'COVER_UNAVAILABLE'].includes(error.code),
    );
    assert.equal(calls, 1);
  }
});
test('strict cover identifiers and sizes cannot become arbitrary request URLs', async () => {
  let calls = 0;
  const urls = [];
  const a = loader({
    fetchImpl: async (url) => {
      calls++;
      urls.push(url);
      return new Response(png);
    },
  });
  for (const input of [
    null,
    {},
    'https://evil.example',
    { kind: 'url', value: 'https://evil.example' },
    { kind: 'id', value: 0 },
    { kind: 'id', value: 1.2 },
    { kind: 'id', value: '1/../../secret' },
    { kind: 'olid', value: '/books/OL1M' },
    { kind: 'olid', value: 'OL1W' },
    { kind: 'isbn', value: '9780140328722' },
    { kind: 'id', value: 3, size: '../' },
  ])
    await assert.rejects(a.load(input), { code: 'INVALID' });
  assert.equal(calls, 0);
  await a.load({ kind: 'olid', value: 'OL7353617M', size: 'M' });
  await a.load({ kind: 'isbn', value: '0-14-032872-6' });
  assert.deepEqual(urls, [
    'https://covers.openlibrary.org/b/olid/OL7353617M-M.jpg?default=false',
    'https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg?default=false',
  ]);
});
test('redirects remain HTTPS on the cover host and redirect loops are bounded', async () => {
  for (const location of [
    'http://covers.openlibrary.org/a',
    'https://other.example/a',
    'https://covers.openlibrary.org:444/a',
    'https://user:pass@covers.openlibrary.org/a',
    null,
  ]) {
    let calls = 0;
    const a = loader({
      fetchImpl: async () => {
        calls++;
        return new Response(null, { status: 302, headers: location ? { location } : {} });
      },
    });
    await assert.rejects(a.load(request), { code: 'INVALID' });
    assert.equal(calls, 1);
  }
  let calls = 0;
  const a = loader({
    fetchImpl: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: '/again' } });
    },
  });
  await assert.rejects(a.load(request), { code: 'INVALID' });
  assert.ok(calls <= 4);
  const safe = loader({
    fetchImpl: async (url) =>
      url.includes('/b/')
        ? new Response(null, { status: 302, headers: { location: '/image.jpg' } })
        : new Response(png),
  });
  assert.ok(await safe.load(request));
});
test('size checks reject declared and streamed images over 5MiB without retry', async () => {
  for (const response of [
    () => new Response(png, { headers: { 'content-length': String(6 * 1024 * 1024) } }),
    () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1)),
  ]) {
    let calls = 0;
    const a = loader({
      fetchImpl: async () => {
        calls++;
        return response();
      },
    });
    await assert.rejects(a.load(request), { code: 'TOO_LARGE' });
    assert.equal(calls, 1);
  }
});
test('shared consumers cancel independently while the remaining consumer receives the image', async () => {
  let calls = 0,
    finish,
    providerSignal;
  const a = loader({
      fetchImpl: async (url, { signal }) => {
        calls++;
        providerSignal = signal;
        return new Promise((resolve) => (finish = resolve));
      },
    }),
    one = new AbortController(),
    two = new AbortController();
  const first = a.load(request, { signal: one.signal }),
    second = a.load(request, { signal: two.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await tick();
  one.abort();
  await rejected;
  assert.equal(providerSignal.aborted, false);
  finish(new Response(png));
  assert.deepEqual(await second, { bytes: png, mime: 'image/png' });
  assert.equal(calls, 1);
});
test('all cancelled consumers stop upstream and cannot seed a late cache result', async () => {
  let calls = 0,
    finish,
    providerSignal;
  const a = loader({
      fetchImpl: async (url, { signal }) => {
        calls++;
        providerSignal = signal;
        if (calls > 1) return new Response(png);
        return new Promise((resolve) => (finish = resolve));
      },
    }),
    controller = new AbortController();
  const pending = a.load(request, { signal: controller.signal }),
    rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  controller.abort();
  await rejected;
  assert.equal(providerSignal.aborted, true);
  finish(new Response(png));
  await tick();
  assert.ok(await a.load(request));
  assert.equal(calls, 2);
});
test('cancellation releases a body which stalled during streaming', async () => {
  let started,
    cancelled = false;
  const startedPromise = new Promise((resolve) => (started = resolve)),
    controller = new AbortController();
  const body = new ReadableStream({
    start(stream) {
      stream.enqueue(png.subarray(0, 20));
      started();
    },
    cancel() {
      cancelled = true;
    },
  });
  const a = loader({ fetchImpl: async () => new Response(body) }),
    pending = a.load(request, { signal: controller.signal }),
    rejected = assert.rejects(pending, { name: 'AbortError' });
  await startedPromise;
  await tick();
  controller.abort();
  await rejected;
  await tick();
  assert.equal(cancelled, true);
});
test('an image larger than the cache budget still loads and does not evict usable entries', async () => {
  let calls = 0;
  const a = loader({
    maximumBytes: png.length - 1,
    fetchImpl: async () => {
      calls++;
      return new Response(png);
    },
  });
  assert.deepEqual(await a.load(request), { bytes: png, mime: 'image/png' });
  assert.deepEqual(await a.load(request), { bytes: png, mime: 'image/png' });
  assert.equal(calls, 2);
});
test('preaborted calls never use the provider, including when the image is cached', async () => {
  let calls = 0;
  const a = loader({
    fetchImpl: async () => {
      calls++;
      return new Response(png);
    },
  });
  await a.load(request);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(a.load(request, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('image LRU evicts oldest entries under its byte budget and expires after 15minutes', async () => {
  let now = 1000;
  const a = loader({
    maximumBytes: png.length * 2,
    clock: { now: () => now, sleep: async () => {} },
  });
  a.remember('a', { bytes: png, mime: 'image/png' });
  a.remember('b', { bytes: png, mime: 'image/png' });
  assert.ok(a.cached('a'));
  a.remember('c', { bytes: png, mime: 'image/png' });
  assert.equal(a.cached('b'), null);
  assert.ok(a.cached('a'));
  assert.ok(a.cached('c'));
  now += 15 * 60 * 1000;
  assert.equal(a.cached('a'), null);
  assert.equal(a.cached('c'), null);
});
test('the default image budget retains less than 32MiB and no more than 100 entries', () => {
  const a = loader(),
    image = { bytes: variant('x'.repeat(4 * 1024 * 1024)), mime: 'image/png' };
  for (let n = 0; n < 8; n++) a.remember('large:' + n, image);
  assert.equal(a.cached('large:0'), null);
  assert.ok(a.cached('large:7'));
  const b = loader();
  for (let n = 0; n < 101; n++) b.remember('small:' + n, { bytes: png, mime: 'image/png' });
  assert.equal(b.cached('small:0'), null);
  assert.ok(b.cached('small:1'));
  assert.ok(b.cached('small:100'));
});
test('cached image copies cannot be corrupted through a caller buffer and invalid images never enter memory', async () => {
  const a = loader(),
    bytes = Buffer.from(png);
  a.remember('a', { bytes, mime: 'image/png' });
  bytes[0] = 0;
  const read = a.cached('a');
  assert.deepEqual(read.bytes, png);
  read.bytes[0] = 0;
  assert.deepEqual(a.cached('a').bytes, png);
  assert.throws(
    () => a.remember('bad', { bytes: Buffer.from([255, 216, 255]), mime: 'image/jpeg' }),
    { code: 'INVALID' },
  );
  assert.equal(a.cached('bad'), null);
});
test('a valid legacy tiny image remains loadable for existing import callers', async () => {
  const a = loader({ fetchImpl: async () => new Response(png) });
  assert.deepEqual(await a.load(request), { bytes: png, mime: 'image/png' });
});
