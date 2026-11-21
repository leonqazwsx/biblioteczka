import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { openSpineStore } from '../src/spine-assets.mjs';
import { openAutomaticSpines } from '../src/automatic-spines.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { createAppServer } from '../src/server.mjs';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
  'base64',
);
async function app(
  t,
  {
    available = true,
    generate = async () => ({ bytes: png, mime: 'image/png', usage: null }),
  } = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-api-'));
  const store = await openStore(dir),
    covers = await openCoverStore(dir),
    spines = await openSpineStore(dir);
  let calls = 0,
    server;
  const jobs = await openAutomaticSpines({
    dataDir: dir,
    store,
    covers,
    spines,
    catalog: { search: async () => [] },
    client: available
      ? {
          origin: 'http://127.0.0.1:47842',
          submit: async (x) => {
            calls++;
            const image = await generate(x);
            return {
              id: randomUUID(),
              state: 'ready',
              retryAt: null,
              errorCode: null,
              result: {
                assetId: createHash('sha256').update(image.bytes).digest('hex'),
                mime: image.mime,
                size: image.bytes.length,
                model: 'fixture',
                promptVersion: 'cover-motif-v1',
              },
            };
          },
          download: async () => ({ bytes: png, mime: 'image/png' }),
        }
      : null,
    onState: () => server?.publishChanges(true),
  });
  server = createAppServer({
    store,
    covers,
    spines,
    jobs,
    publicDir: path.resolve('public'),
    catalog: { search: async () => [] },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port,
    token = (await (await fetch(origin + '/api/bootstrap')).json()).token;
  t.after(async () => {
    await jobs.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const { coverId } = await covers.put(png, 'image/png');
  return {
    store,
    jobs,
    origin,
    coverId,
    calls: () => calls,
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
  assert.equal(a.calls(), 0);
  const noKey = await app(t, { available: false });
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
  assert.equal(a.calls(), 0);
});
test('adding a book returns before its single automatic job completes; edits do not regenerate', async (t) => {
  let release, started;
  const start = new Promise((r) => (started = r));
  const a = await app(t, {
    generate: async () => {
      started();
      await new Promise((r) => (release = r));
      return { bytes: png, mime: 'image/png', usage: null };
    },
  });
  await a.store.commit({ type: 'updateSettings', patch: { aiEnabled: true } }, 0);
  const response = await a.post('/api/commands', {
    command: {
      type: 'addBook',
      draft: {
        title: 'Solaris',
        authors: ['Lem'],
        shelfId: 'other',
        status: 'read',
        coverId: a.coverId,
      },
    },
    expectedRevision: 1,
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  await start;
  assert.equal(saved.books[0].spine, null);
  assert.equal(a.calls(), 1);
  release();
  while (a.jobs.status().jobs.some((j) => ['queued', 'generating'].includes(j.state)))
    await new Promise((r) => setTimeout(r, 5));
  const s = a.store.read();
  await a.post('/api/commands', {
    command: { type: 'updateBook', id: s.books[0].id, patch: { status: 'reading' } },
    expectedRevision: s.revision,
  });
  assert.equal(a.calls(), 1);
});
test('job SSE announces AI changes even without a library revision', async (t) => {
  const a = await app(t),
    controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(a.origin + '/api/events', { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  assert.equal(typeof a.jobs.status, 'function');
  await a.store.commit({ type: 'updateSettings', patch: { aiEnabled: true } }, 0);
  const b = await a.add();
  await a.jobs.schedule();
  let output = '';
  while (!output.includes('"aiChanged":true')) {
    const { value } = await reader.read();
    output += new TextDecoder().decode(value);
  }
  assert.match(output, /"aiChanged":true/);
  controller.abort();
});
