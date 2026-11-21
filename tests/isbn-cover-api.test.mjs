import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../src/server.mjs';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { png } from './helpers/images.mjs';
async function app(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-isbn-api-')),
    store = await openStore(root),
    requests = [];
  const covers = await openCoverStore(root, {
    fetchImpl: async (url) => {
      requests.push(url);
      return url.includes('9788375796025')
        ? new Response(null, { status: 404 })
        : new Response(png);
    },
  });
  const server = createAppServer({ store, covers, catalog: {}, publicDir: path.resolve('public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port,
    { token } = await (await fetch(origin + '/api/bootstrap')).json();
  const post = (body, own = true) =>
    fetch(origin + '/api/covers', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Bookshelf-Token': own ? token : '',
      },
      body: JSON.stringify(body),
    });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { store, covers, requests, post };
}
test('ISBN cover import requires ownership, stores the image locally, and leaves the collection untouched until save', async (t) => {
  const a = await app(t),
    before = a.store.read();
  assert.equal((await a.post({ isbn: '9780140328721' }, false)).status, 403);
  assert.equal(a.requests.length, 0);
  const response = await a.post({ isbn: '9780140328721' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.coverId);
  assert.deepEqual((await a.covers.read(result.coverId)).bytes, png);
  assert.deepEqual(a.store.read(), before);
  assert.equal(
    (await a.post({ isbn: '9780140328721', url: 'https://other.example/a.jpg' })).status,
    400,
  );
  assert.equal(a.requests.length, 1);
});
test('ISBN cover API reports a missing cover without failing book entry', async (t) => {
  const a = await app(t),
    response = await a.post({ isbn: '9788375796025' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { coverId: null });
  assert.equal((await a.post({ isbn: '9788375796026' })).status, 400);
  assert.equal(a.requests.length, 1);
});
