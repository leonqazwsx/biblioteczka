import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { createAppServer } from '../src/server.mjs';
async function app(t, options = {}) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-api-'));
  const store = await openStore(p),
    covers = await openCoverStore(p);
  const server = createAppServer({
    store,
    covers,
    publicDir: path.resolve('public'),
    catalog: { search: async () => [], resolveEdition: async () => null },
    onShutdown: () => {},
    ...options,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const token = (await (await fetch(origin + '/api/bootstrap')).json()).token;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(p, { recursive: true, force: true });
  });
  return {
    store,
    origin,
    token,
    request: (url, body, extra = {}) =>
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
  };
}
const add = {
  type: 'addBook',
  draft: { title: 'Solaris', authors: ['Lem'], shelfId: 'fantasy', status: 'read' },
};
test('the full supported collection can save individual cavity assignments through HTTP', async (t) => {
  const a = await app(t);
  await a.store.commit(add, 0);
  const state = a.store.read(),
    sample = state.books[0];
  state.books = Array.from({ length: 10000 }, (_, i) => ({
    ...sample,
    id: crypto.randomUUID(),
    title: 'Book ' + i,
    order: i,
    isbn: null,
    provider: null,
    providerId: null,
  }));
  await a.store.replace(state, 1);
  const current = a.store.read(),
    placements = Object.fromEntries(
      current.books.map((b, i) => [b.id, { slotId: 'top-left', order: i }]),
    );
  const response = await a.request('/api/commands', {
    expectedRevision: current.revision,
    command: {
      type: 'setRoomLayout',
      roomId: current.settings.room,
      layout: { enabled: true, cavities: {}, placements },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(
    Object.keys((await response.json()).settings.roomLayouts[current.settings.room].placements)
      .length,
    10000,
  );
});
test('local commands persist and stale panels get a conflict', async (t) => {
  const a = await app(t);
  const r = await a.request('/api/commands', { command: add, expectedRevision: 0 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).books.length, 1);
  assert.equal(
    (await a.request('/api/commands', { command: add, expectedRevision: 0 })).status,
    409,
  );
});
test('foreign Origin, missing token and unsafe paths cannot modify state', async (t) => {
  const a = await app(t);
  assert.equal(
    (
      await a.request(
        '/api/commands',
        { command: add, expectedRevision: 0 },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await a.request(
        '/api/commands',
        { command: add, expectedRevision: 0 },
        { 'X-Bookshelf-Token': '' },
      )
    ).status,
    403,
  );
  assert.equal(a.store.read().books.length, 0);
  const r = await fetch(a.origin + '/%2e%2e%2fpackage.json');
  assert.notEqual(r.status, 200);
});
test('SSE publishes committed revision', async (t) => {
  const a = await app(t);
  const controller = new AbortController();
  const r = await fetch(a.origin + '/api/events', { signal: controller.signal });
  const reader = r.body.getReader();
  let all = '';
  await a.request('/api/commands', { command: add, expectedRevision: 0 });
  while (!all.includes('"revision":1')) {
    const { value } = await reader.read();
    all += new TextDecoder().decode(value);
  }
  controller.abort();
  assert.match(all, /"revision":1/);
});
test('import preview is read-only and confirm assigns current revision', async (t) => {
  const a = await app(t);
  await a.request('/api/commands', { command: add, expectedRevision: 0 });
  const backup = await (await fetch(a.origin + '/api/export')).json();
  const preview = await (await a.request('/api/import/preview', backup)).json();
  assert.equal(a.store.read().revision, 1);
  assert.equal(preview.summary.books, 1);
  const result = await a.request('/api/import/confirm', {
    importId: preview.importId,
    expectedRevision: 1,
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).revision, 2);
});
test('Windows preferences require ownership token and leave collection revision unchanged', async (t) => {
  let autostart = false;
  const status = () => ({ supported: true, autostart, conflict: false, canEnable: true });
  const a = await app(t, {
    windows: {
      status: async () => status(),
      setAutostart: async (value) => {
        autostart = value;
        return status();
      },
    },
  });
  assert.equal((await (await fetch(a.origin + '/api/windows')).json()).autostart, false);
  assert.equal(
    (await a.request('/api/windows', { autostart: true }, { 'X-Bookshelf-Token': '' })).status,
    403,
  );
  assert.equal((await a.request('/api/windows', { autostart: 'true' })).status, 400);
  assert.equal(
    (await a.request('/api/windows', { autostart: true, appRoot: 'C:\\foreign' })).status,
    400,
  );
  const response = await a.request('/api/windows', { autostart: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).autostart, true);
  assert.equal(a.store.read().revision, 0);
});
test('a stale tray cannot shut down a replacement server', async (t) => {
  const a = await app(t);
  assert.equal((await a.request('/api/shutdown', { expectedPid: process.pid + 1 })).status, 409);
  assert.equal((await fetch(a.origin + '/api/health')).status, 200);
});

test('JSON restore confirmation cannot adopt an intervening revision', async (t) => {
  const a = await app(t);
  await a.request('/api/commands', { command: add, expectedRevision: 0 });
  const backup = await (await fetch(a.origin + '/api/export')).json();
  const preview = await (await a.request('/api/import/preview', backup)).json();
  const saved = await (
    await a.request('/api/commands', {
      command: { type: 'addBook', draft: { ...add.draft, title: 'Added after preview' } },
      expectedRevision: 1,
    })
  ).json();
  const response = await a.request('/api/import/confirm', {
    importId: preview.importId,
    expectedRevision: saved.revision,
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CONFLICT');
  assert.equal(a.store.read().revision, 2);
  assert.equal(a.store.read().books.length, 2);
  assert.equal(preview.collectionId, backup.state.collectionId);
  assert.equal(preview.revision, 1);
});

test('bootstrap and events share session metadata without entering persistent state', async (t) => {
  const a = await app(t);
  await a.store.commit(add, 0);
  await a.store.commit({ type: 'updateSettings', patch: { theme: 'dark' } }, 1);
  const first = await (await fetch(a.origin + '/api/bootstrap')).json();
  assert.equal(typeof first.sessionId, 'string');
  assert.ok(first.sessionId.length > 0);
  assert.equal(first.collectionId, a.store.read().collectionId);
  assert.equal(first.revision, 2);
  const stream = await fetch(a.origin + '/api/events');
  const reader = stream.body.getReader();
  const { value } = await reader.read();
  const event = JSON.parse(new TextDecoder().decode(value).split('data: ')[1].trim());
  await reader.cancel();
  assert.equal(event.sessionId, first.sessionId);
  assert.equal(event.recovery, 'none');
  assert.equal(event.collectionId, first.collectionId);
  assert.equal('sessionId' in a.store.read(), false);
  assert.equal('recovery' in a.store.read(), false);
});
