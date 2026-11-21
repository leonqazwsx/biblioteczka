import { completedCsv } from './helpers/completed-csv.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { createAppServer } from '../src/server.mjs';
async function app(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goodreads-api-')),
    store = await openStore(dir);
  let paid = 0,
    media = 0,
    catalog = 0;
  const server = createAppServer({
    store,
    publicDir: path.resolve('public'),
    jobs: {
      enqueue: () => {
        paid++;
      },
      status: () => ({ available: true }),
    },
    covers: {
      read: () => {
        media++;
      },
      put: () => {
        media++;
      },
    },
    catalog: {
      search: () => {
        catalog++;
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port,
    token = (await (await fetch(origin + '/api/bootstrap')).json()).token;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    store,
    origin,
    counts: () => ({ paid, media, catalog }),
    request: (route, input, extra = {}) =>
      fetch(origin + route, {
        method: 'POST',
        headers: {
          Origin: origin,
          'X-Bookshelf-Token': token,
          'Content-Type': 'application/json',
          ...extra,
        },
        body: JSON.stringify(input),
      }),
  };
}
const csv = completedCsv(
  'Title,Author,Book Id,Date Read,Bookshelves,Private Notes\nA,B,1,2024/02/29,fantasy,PRIVATE_HTTP_MARKER\n',
);
test('protected preview rejects origin/token/unknown keys/bad or noncanonical base64', async (t) => {
  const a = await app(t),
    route = '/api/goodreads/preview',
    body = { base64: Buffer.from(csv).toString('base64') };
  for (const extra of [{ Origin: 'https://evil.example' }, { 'X-Bookshelf-Token': '' }])
    assert.equal((await a.request(route, body, extra)).status, 403);
  for (const invalid of [
    { ...body, books: [] },
    { base64: '!bad' },
    { base64: 'Zg=' },
    { base64: 'Zh==' },
    { base64: 123 },
    null,
  ])
    assert.equal((await a.request(route, invalid)).status, 400);
  const response = await a.request(route, body);
  assert.equal(response.status, 200);
  const p = await response.json();
  assert.equal(p.summary.addable, 1);
  assert.ok(!JSON.stringify(p).includes('PRIVATE_HTTP_MARKER'));
  assert.equal(a.store.read().revision, 0);
});
test('decoded10MiB and JSON14MiB bounds are independent; malformed CSV never writes', async (t) => {
  const a = await app(t),
    route = '/api/goodreads/preview';
  assert.equal(
    (await a.request(route, { base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }))
      .status,
    413,
  );
  assert.equal((await a.request(route, { base64: 'x'.repeat(14 * 1024 * 1024) })).status, 413);
  const bad = await a.request(route, {
    base64: completedCsv('Title,Author\n"bad,B').toString('base64'),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'INVALID_CSV');
  assert.equal(a.store.read().books.length, 0);
});
test('confirm uses retained candidates, publishes one change and never starts AI/media/catalog work', async (t) => {
  const a = await app(t);
  await a.store.commit({ type: 'updateSettings', patch: { aiEnabled: true } }, 0);
  const controller = new AbortController(),
    events = await fetch(a.origin + '/api/events', { signal: controller.signal }),
    reader = events.body.getReader();
  await reader.read();
  const preview = await (
    await a.request('/api/goodreads/preview', { base64: Buffer.from(csv).toString('base64') })
  ).json();
  const confirm = {
    importId: preview.importId,
    expectedRevision: preview.revision,
    selectedRowIds: [preview.rows[0].rowId],
    overrides: {},
  };
  assert.equal((await a.request('/api/goodreads/confirm', { ...confirm, books: [] })).status, 400);
  assert.equal(
    (
      await a.request('/api/commands', {
        expectedRevision: 1,
        command: { type: 'appendImported', drafts: [] },
      })
    ).status,
    400,
  );
  assert.equal(
    (await a.request('/api/goodreads/confirm', confirm, { 'X-Bookshelf-Token': '' })).status,
    403,
  );
  const result = await a.request('/api/goodreads/confirm', confirm);
  assert.equal(result.status, 200);
  const state = await result.json();
  assert.equal(state.revision, 2);
  assert.equal(state.books[0].goodreadsId, '1');
  assert.equal(state.books[0].readDate, '2024-02-29');
  assert.deepEqual(a.counts(), { paid: 0, media: 0, catalog: 0 });
  const event = new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  assert.equal((event.match(/data: /g) || []).length, 1);
  assert.ok(event.includes('"revision":2'));
  assert.equal((await a.request('/api/goodreads/confirm', confirm)).status, 400);
});
test('HTTP confirms all10000 selections with default and maximum escaped category overrides', async (t) => {
  const source = completedCsv(
    'Title,Author,Book Id\n' +
      Array.from({ length: 10000 }, (_, i) => `HTTP ${i},Autor,${i + 1}`).join('\n'),
  ).toString('base64');
  for (const withOverrides of [false, true])
    await t.test(withOverrides ? 'maximum overrides' : 'default selection', async (sub) => {
      const a = await app(sub),
        p = await (await a.request('/api/goodreads/preview', { base64: source })).json();
      assert.equal(p.summary.addable, 10000);
      const category = 'X' + '\u0001'.repeat(98) + 'Y',
        overrides = withOverrides
          ? Object.fromEntries(
              p.rows.map((r) => [
                r.rowId,
                { status: 'read', shelfId: null, newShelfName: category },
              ]),
            )
          : {};
      const body = {
        importId: p.importId,
        expectedRevision: p.revision,
        selectedRowIds: p.rows.map((r) => r.rowId),
        overrides,
      };
      assert.ok(Buffer.byteLength(JSON.stringify(body)) > 256 * 1024);
      const response = await a.request('/api/goodreads/confirm', body);
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await response.json();
      assert.equal(saved.books.length, 10000);
      assert.equal(saved.revision, 1);
      assert.deepEqual(a.store.read(), saved);
      assert.deepEqual(a.counts(), { paid: 0, media: 0, catalog: 0 });
      if (withOverrides) {
        assert.ok(saved.books.every((b) => b.status === 'read'));
        assert.equal(saved.shelves.filter((s) => s.name === category).length, 1);
      }
    });
  await t.test('oversized confirmation remains bounded without a write', async (sub) => {
    const a = await app(sub),
      r = await a.request('/api/goodreads/confirm', { padding: 'x'.repeat(8 * 1024 * 1024) });
    assert.equal(r.status, 413);
    assert.equal(a.store.read().revision, 0);
  });
});
