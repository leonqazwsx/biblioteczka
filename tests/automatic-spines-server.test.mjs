import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
import { createAppServer } from '../src/server.mjs';
test('successful mutation schedules after save without waiting for service; status is coordinator-only', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-server-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = await openStore(dataDir),
    calls = [];
  const jobs = {
    schedule(input) {
      calls.push({ input, count: store.read().books.length });
      return new Promise(() => {});
    },
    status: () => ({ available: true, enabled: true, connection: 'online', jobs: [] }),
  };
  const server = createAppServer({ store, jobs, covers: {}, publicDir: path.resolve('public') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const { token } = await (await fetch(origin + '/api/bootstrap')).json();
  const response = await fetch(origin + '/api/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Bookshelf-Token': token },
    body: JSON.stringify({
      expectedRevision: 0,
      command: {
        type: 'addBook',
        draft: { title: 'A', authors: ['Author'], status: 'read', shelfId: 'other' },
      },
    }),
  });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].count, 1);
  assert.deepEqual(calls[0].input.newBookIds, [state.books[0].id]);
  assert.deepEqual(await (await fetch(origin + '/api/ai/status')).json(), jobs.status());
});
