import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openStore} from '../src/store.mjs';
import {createAppServer} from '../src/server.mjs';
test('deprecated generator returns 410 and creates no ticket, work or charge for an old client', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-generation-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true})); const store = await openStore(dataDir); let calls = 0;
  const jobs = {status: () => ({available: true, enabled: true, connection: 'online', jobs: []}), enqueue() {calls++;}, schedule() {calls++;}};
  const server = createAppServer({store, jobs, covers: {}, publicDir: path.resolve('public')}); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => {server.closeAllConnections(); server.close();}); const origin = 'http://127.0.0.1:' + server.address().port, {token} = await (await fetch(origin + '/api/bootstrap')).json();
  const before = store.read(), response = await fetch(origin + '/api/spines/generate', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token}, body: JSON.stringify({bookId: 'missing', force: true, expectedRevision: 0})});
  assert.equal(response.status, 410); assert.deepEqual(store.read(), before); assert.equal(calls, 0);
});
test('manager has only upload callback; existing crop and draft protection remain connected', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /onGenerate:|\/api\/spines\/generate|OPENAI_API_KEY|onEnable:|onDisable:/);
  assert.match(source, /frameEditor\.patch/); assert.match(source, /selectedOperation!==operation/);
});
