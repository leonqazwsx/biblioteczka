import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { createAppServer } from '../src/server.mjs';
async function app(t, windows) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-entry-')),
    store = await openStore(dir),
    covers = await openCoverStore(dir);
  let mutations = 0;
  const server = createAppServer({
    store,
    covers,
    windows,
    catalog: {},
    publicDir: path.resolve('public'),
    storage: {
      withMutation: () => {
        mutations++;
        throw Error('Settings opening must not wait for collection mutation');
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port,
    { token } = await (await fetch(origin + '/api/bootstrap')).json();
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    origin,
    token,
    store,
    mutations: () => mutations,
    post: (body, headers = {}) =>
      fetch(origin + '/api/windows/open-settings', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Bookshelf-Token': token,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
  };
}
test('authenticated settings launch opens the fixed action without touching collection or storage gate', async (t) => {
  let calls = 0;
  const a = await app(t, {
      openSettings: async () => {
        calls++;
        return { opened: true };
      },
    }),
    before = a.store.read();
  const response = await a.post({});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { opened: true });
  assert.equal(calls, 1);
  assert.equal(a.mutations(), 0);
  assert.deepEqual(a.store.read(), before);
});
test('settings launch rejects forged requests and arbitrary URL or command inputs', async (t) => {
  let calls = 0;
  const a = await app(t, {
    openSettings: async () => {
      calls++;
      return { opened: true };
    },
  });
  for (const headers of [
    { Origin: 'https://example.org' },
    { 'X-Bookshelf-Token': '' },
    { 'Content-Type': 'text/plain' },
  ])
    assert.equal((await a.post({}, headers)).status, 403);
  const forged = await new Promise((resolve, reject) => {
    const req = http.request(
      a.origin + '/api/windows/open-settings',
      {
        method: 'POST',
        headers: {
          Host: 'localhost',
          Origin: a.origin,
          'Content-Type': 'application/json',
          'X-Bookshelf-Token': a.token,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(forged, 403);
  for (const input of [
    null,
    [],
    { url: 'https://example.org' },
    { command: 'calc.exe' },
    'settings',
    1,
  ])
    assert.equal((await a.post(input)).status, 400);
  assert.equal((await fetch(a.origin + '/api/windows/open-settings')).status, 404);
  assert.equal(calls, 0);
});
test('settings opening has an explicit unavailable error and never changes state', async (t) => {
  for (const windows of [
    undefined,
    {},
    {
      openSettings: async () => {
        throw Object.assign(Error('Nie udało się otworzyć ustawień.'), {
          code: 'WINDOWS_UNAVAILABLE',
        });
      },
    },
  ]) {
    const a = await app(t, windows),
      before = a.store.read(),
      response = await a.post({});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'WINDOWS_UNAVAILABLE');
    assert.deepEqual(a.store.read(), before);
  }
});
