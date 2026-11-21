import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { openSpineStore } from '../src/spine-assets.mjs';
import { createAppServer } from '../src/server.mjs';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
  'base64',
);
async function app(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-api-'));
  const store = await openStore(dir),
    covers = await openCoverStore(dir),
    spines = await openSpineStore(dir);
  const server = createAppServer({
    store,
    covers,
    spines,
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
  const { coverId } = await covers.put(png, 'image/png');
  return {
    store,
    origin,
    coverId,
    post: (url, body, extra = {}) =>
      fetch(origin + url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: origin,
          'X-Bookshelf-Token': token,
          ...extra,
        },
        body: JSON.stringify(body),
      }),
    add: async (cover = coverId) => {
      const r = await store.commit(
        {
          type: 'addBook',
          draft: {
            title: 'Solaris',
            authors: ['Lem'],
            shelfId: 'other',
            status: 'read',
            coverId: cover,
          },
        },
        store.read().revision,
      );
      return r.books[0];
    },
  };
}
test('retired generation enforces session and creates no work', async (t) => {
  const a = await app(t);
  const b = await a.add(null),
    input = { bookId: b.id, expectedRevision: a.store.read().revision, force: false };
  assert.equal(
    (await a.post('/api/spines/generate', input, { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await a.post('/api/spines/generate', input, { 'X-Bookshelf-Token': '' })).status,
    403,
  );
  assert.equal((await a.post('/api/spines/generate', input)).status, 410);
  await a.store.commit(
    { type: 'updateSettings', patch: { aiEnabled: true } },
    a.store.read().revision,
  );
  input.expectedRevision = a.store.read().revision;
  assert.equal((await a.post('/api/spines/generate', input)).status, 410);
  assert.equal((await a.post('/api/spines/generate', { ...input, bookId: 'missing' })).status, 410);
  assert.equal(
    (await a.post('/api/spines/generate', { ...input, url: 'https://evil.example' })).status,
    410,
  );
  const noKey = await app(t);
  const status = await (await fetch(noKey.origin + '/api/ai/status')).json();
  assert.equal(status.available, false);
  assert.equal(
    (
      await noKey.post('/api/commands', {
        command: { type: 'updateSettings', patch: { aiEnabled: true } },
        expectedRevision: 0,
      })
    ).status,
    200,
  );
});
test('manual spine upload is CAS protected, immutable, portable and not reachable via generic command', async (t) => {
  const a = await app(t);
  const b = await a.add();
  const body = {
    bookId: b.id,
    expectedRevision: a.store.read().revision,
    mime: 'image/png',
    base64: png.toString('base64'),
  };
  assert.equal((await a.post('/api/spines/upload', { ...body, mime: 'text/html' })).status, 400);
  const r = await a.post('/api/spines/upload', body);
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.books[0].spine.kind, 'manual');
  assert.equal((await a.post('/api/spines/upload', body)).status, 409);
  assert.equal(
    (
      await a.post('/api/commands', {
        command: { type: 'setBookSpine', id: b.id, spine: null },
        expectedRevision: s.revision,
      })
    ).status,
    400,
  );
  const image = await fetch(a.origin + '/spines/' + s.books[0].spine.assetId);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.notEqual((await fetch(a.origin + '/spines/not-a-hash')).status, 200);
  const backup = await (await fetch(a.origin + '/api/export')).json();
  assert.equal(backup.spineImages.length, 1);
  const preview = await (await a.post('/api/import/preview', backup)).json();
  assert.equal(
    (
      await a.post('/api/import/confirm', {
        importId: preview.importId,
        expectedRevision: s.revision,
      })
    ).status,
    200,
  );
});
