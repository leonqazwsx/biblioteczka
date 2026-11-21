import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAppServer } from '../src/server.mjs';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { createCoverDiscovery } from '../src/cover-discovery.mjs';
import { createStorageGate } from '../src/asset-maintenance.mjs';
import { coverPng } from './helpers/cover-fixtures.mjs';
async function fixture(t, { storage = null } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-discovery-api-')),
    store = await openStore(dir),
    covers = await openCoverStore(dir);
  let time = 1000;
  const discovery = createCoverDiscovery({
    imageLoader: {
      cached: () => null,
      remember() {},
      load: async () => ({ bytes: coverPng(19), mime: 'image/png' }),
    },
    clock: { now: () => time, sleep: async () => {} },
    fetchImpl: async (url) => {
      const p = new URL(url).pathname;
      return p === '/isbn/9780593440643.json'
        ? Response.json({
            key: '/books/OL1M',
            title: 'Reacher',
            isbn_13: ['9780593440643'],
            covers: [101],
          })
        : new Response(null, { status: 404 });
    },
  });
  const server = createAppServer({
    store,
    covers,
    coverDiscovery: discovery,
    storage,
    publicDir: path.resolve('public'),
    catalog: { search: async () => [] },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port,
    token = (await (await fetch(origin + '/api/bootstrap')).json()).token;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const post = (route, body, extra = {}) =>
    fetch(origin + route, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
      body: JSON.stringify(body),
      ...extra,
    });
  return { dir, store, origin, post, server, advance: (ms) => (time += ms) };
}
test('search and thumbnail are read only, applying a candidate stores an offline cover only', async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.store.read());
  let response = await f.post('/api/cover-search', {
    title: 'Reacher',
    authors: ['Lee Child'],
    isbn: '9780593440643',
  });
  assert.equal(response.status, 200);
  const r = await response.json();
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].match, 'edition');
  assert.ok(r.automaticId);
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'covers')), []);
  response = await fetch(f.origin + r.candidates[0].previewUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), coverPng(19));
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'covers')), []);
  response = await f.post('/api/covers', { searchId: r.searchId, candidateId: r.automaticId });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.match(saved.coverId, /^[a-f0-9]{64}$/);
  assert.equal(saved.source, 'openlibrary');
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'covers')), [saved.coverId]);
  assert.deepEqual(f.store.read(), before);
});
test('search and candidate application enforce tokens, exact input shapes and scoped expiring IDs', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await fetch(f.origin + '/api/cover-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.post('/api/cover-search', {
        title: 'Reacher',
        authors: ['Lee Child'],
        url: 'https://127.0.0.1',
      })
    ).status,
    400,
  );
  const r = await (
    await f.post('/api/cover-search', {
      title: 'Reacher',
      authors: ['Lee Child'],
      isbn: '9780593440643',
    })
  ).json();
  assert.ok(r.automaticId);
  assert.equal(
    (
      await f.post('/api/covers', {
        searchId: r.searchId,
        candidateId: r.automaticId,
        url: 'https://example.com',
      })
    ).status,
    400,
  );
  assert.equal((await fetch(f.origin + '/api/cover-search/foreign/' + r.automaticId)).status, 410);
  f.advance(15 * 60 * 1000 + 1);
  const response = await f.post('/api/covers', {
    searchId: r.searchId,
    candidateId: r.automaticId,
  });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'COVER_SEARCH_EXPIRED');
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'covers')), []);
});
test('an abandoned selection cannot write after waiting behind the storage gate', async (t) => {
  const gate = createStorageGate();
  let held, release, queued;
  const started = new Promise((r) => (held = r)),
    waiting = new Promise((r) => (queued = r));
  const f = await fixture(t, {
    storage: {
      withMutation: (operation) => {
        const result = gate(operation);
        queued();
        return result;
      },
    },
  });
  const r = await (
    await f.post('/api/cover-search', {
      title: 'Reacher',
      authors: ['Lee Child'],
      isbn: '9780593440643',
    })
  ).json();
  assert.ok(r.automaticId);
  const blocking = gate(async () => {
    held();
    await new Promise((r) => (release = r));
  });
  t.after(() => release());
  await started;
  const disconnected = new Promise((resolve) =>
    f.server.once('request', (_req, res) => res.once('close', resolve)),
  );
  const controller = new AbortController(),
    pending = f.post(
      '/api/covers',
      { searchId: r.searchId, candidateId: r.automaticId },
      { signal: controller.signal },
    );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await waiting;
  controller.abort();
  await rejected;
  await disconnected;
  release();
  await blocking;
  await f.server.drainRequests();
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'covers')), []);
});
