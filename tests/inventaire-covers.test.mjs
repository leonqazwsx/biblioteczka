import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openCoverStore } from '../src/covers.mjs';
import { png } from './helpers/service-images.mjs';
const module = await import('../src/inventaire-covers.mjs').catch(() => ({}));
const isbn = '9788370541163',
  uri = 'inv:6703e9d56f0860634193cfc03ff570b5',
  imagePath = '/img/entities/36e86f4fdfb2710e977efa0d4dceace9adcc78c1';
const record = () => ({
  redirects: { ['isbn:' + isbn]: uri },
  entities: {
    [uri]: {
      type: 'edition',
      claims: { 'wdt:P212': ['978-83-7054-116-3'] },
      image: { url: imagePath },
    },
  },
});
function lookup(data = record(), overrides = {}) {
  assert.equal(typeof module.createInventaireCoverLookup, 'function');
  const requests = [],
    images = [];
  const resolve = module.createInventaireCoverLookup({
    clock: { now: () => Date.now(), sleep: async () => {} },
    fetchImpl: async (url) => {
      requests.push(url);
      return Response.json(data);
    },
    imageDownloader: async (url, { signal }) => {
      signal?.throwIfAborted();
      images.push(url);
      return { bytes: png, mime: 'image/png' };
    },
    ...overrides,
  });
  return { resolve, requests, images };
}
test('Inventaire resolves the requested edition ISBN and downloads only its hosted cover', async () => {
  const a = lookup(),
    result = await a.resolve(isbn);
  assert.deepEqual(result, { bytes: png, mime: 'image/png' });
  assert.deepEqual(a.requests, ['https://inventaire.io/api/entities/by-uris?uris=isbn%3A' + isbn]);
  assert.deepEqual(a.images, ['https://inventaire.io' + imagePath]);
});
test('unrelated editions, absent covers, ambiguous redirects and unsafe image URLs are never downloaded', async () => {
  for (const change of [
    (data) => (data.entities[uri].claims['wdt:P212'] = ['9780140328721']),
    (data) => delete data.entities[uri].image,
    (data) => delete data.redirects['isbn:' + isbn],
    (data) => (data.entities[uri].image.url = 'https://127.0.0.1/private'),
    (data) => (data.entities[uri].image.url = '/img/entities/../private'),
    (data) => (data.entities[uri].type = 'work'),
  ]) {
    const data = record();
    change(data);
    const a = lookup(data);
    assert.equal(await a.resolve(isbn), null);
    assert.deepEqual(a.images, []);
  }
});
test('a missing Inventaire record returns null; an outage stays distinguishable from missing data', async () => {
  const missing = lookup({ notFound: ['isbn:' + isbn], entities: {} });
  assert.equal(await missing.resolve(isbn), null);
  const unavailable = lookup(null, { fetchImpl: async () => new Response(null, { status: 503 }) });
  await assert.rejects(() => unavailable.resolve(isbn), { code: 'CATALOG_UNAVAILABLE' });
});
test('Inventaire lookup propagates cancellation before issuing a request or downloading an image', async () => {
  const controller = new AbortController(),
    a = lookup();
  controller.abort();
  await assert.rejects(() => a.resolve(isbn, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(a.requests.length, 0);
  assert.equal(a.images.length, 0);
});
test('Open Library timeout uses the independent ISBN fallback and persists its actual image', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-fallback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let received;
  const covers = await openCoverStore(root, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    isbnFallback: async (value, { signal }) => {
      received = value;
      signal.throwIfAborted();
      return { bytes: png, mime: 'image/png' };
    },
  });
  const result = await covers.fetchIsbnCover('837054116X');
  assert.equal(result.source, 'inventaire');
  assert.equal(received, isbn);
  assert.deepEqual((await covers.read(result.coverId)).bytes, png);
});
test('an absent primary cover uses fallback, while a successful primary does not query it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-sources-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let status = 404,
    calls = 0;
  const covers = await openCoverStore(root, {
    fetchImpl: async () => new Response(status === 200 ? png : null, { status }),
    isbnFallback: async () => {
      calls++;
      return { bytes: png, mime: 'image/png' };
    },
  });
  assert.equal((await covers.fetchIsbnCover(isbn)).source, 'inventaire');
  status = 200;
  await covers.fetchIsbnCover(isbn);
  assert.equal(calls, 1);
});
test('failure of both sources remains an outage and an aborted fallback never writes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-fail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  let abort = false;
  const covers = await openCoverStore(root, {
    fetchImpl: async () => new Response(null, { status: 404 }),
    isbnFallback: async () => {
      if (abort) {
        controller.abort();
        return { bytes: png, mime: 'image/png' };
      }
      throw Error('down');
    },
  });
  await assert.rejects(() => covers.fetchIsbnCover(isbn), { code: 'COVER_UNAVAILABLE' });
  abort = true;
  await assert.rejects(() => covers.fetchIsbnCover(isbn, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.deepEqual(await fs.readdir(path.join(root, 'covers')), []);
});
test('fallback receives a fresh bounded signal after a slow primary has timed out', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-cover-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let primarySignal, fallbackSignal, primaryStarted, fallbackStarted, finishFallback;
  const primaryReady = new Promise((resolve) => (primaryStarted = resolve)),
    fallbackReady = new Promise((resolve) => (fallbackStarted = resolve));
  const imageLoader = {
    load: async (input, { signal }) => {
      primarySignal = signal;
      primaryStarted();
      return new Promise(() => {});
    },
  };
  const covers = await openCoverStore(root, {
    imageLoader,
    isbnFallback: async (value, { signal }) => {
      fallbackSignal = signal;
      fallbackStarted();
      return new Promise((resolve) => (finishFallback = resolve));
    },
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const pending = covers.fetchIsbnCover(isbn);
  await primaryReady;
  t.mock.timers.tick(8000);
  await fallbackReady;
  assert.equal(primarySignal.aborted, true);
  assert.notEqual(fallbackSignal, primarySignal);
  assert.equal(fallbackSignal.aborted, false);
  t.mock.timers.tick(7000);
  assert.equal(fallbackSignal.aborted, false);
  finishFallback({ bytes: png, mime: 'image/png' });
  assert.equal((await pending).source, 'inventaire');
  assert.equal(fallbackSignal.aborted, false);
});
