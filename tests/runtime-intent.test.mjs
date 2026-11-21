import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run } from '../src/main.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf runtime intent '));
  const app = await run({ appRoot: root, port: 0, ...options });
  t.after(async () => {
    await fs.rm(path.join(root, 'data/runtime-stop.json'), { recursive: true, force: true });
    await app.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { root, app, health: await (await fetch(app.origin + '/api/health')).json() };
}
async function shutdown(app) {
  const { token } = await (await fetch(app.origin + '/api/bootstrap')).json();
  return fetch(app.origin + '/api/shutdown', {
    method: 'POST',
    headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
    body: '{}',
  });
}

test('intentional shutdown persists the exact runtime identity before acknowledging success', async (t) => {
  const { root, app, health } = await fixture(t);
  const response = await shutdown(app);
  assert.equal(response.status, 200);
  const intent = JSON.parse(await fs.readFile(path.join(root, 'data/runtime-stop.json'), 'utf8'));
  assert.deepEqual(Object.keys(intent).sort(), [
    'appId',
    'createdAt',
    'installationId',
    'pid',
    'sessionId',
    'version',
  ]);
  assert.equal(intent.version, 1);
  assert.equal(intent.appId, 'bookshelf-wallpaper');
  assert.equal(intent.installationId, health.installationId);
  assert.equal(intent.pid, health.pid);
  assert.equal(intent.sessionId, health.sessionId);
  assert.ok(Number.isFinite(Date.parse(intent.createdAt)));
});

test('failed stop-intent persistence leaves the server running instead of acknowledging shutdown', async (t) => {
  const { root, app, health } = await fixture(t);
  const blocked = path.join(root, 'data/runtime-stop.json');
  await fs.mkdir(blocked);
  await fs.writeFile(path.join(blocked, 'keep'), 'owned fixture');
  const response = await shutdown(app);
  assert.equal(response.status, 500);
  assert.equal(
    (await (await fetch(app.origin + '/api/health')).json()).sessionId,
    health.sessionId,
  );
  assert.equal(await fs.readFile(path.join(blocked, 'keep'), 'utf8'), 'owned fixture');
  await fs.rm(blocked, { recursive: true });
});

test('shutdown of a not-yet-adopted server identifies its recovery lease', async (t) => {
  const recoveryNonce = crypto.randomUUID(),
    { root, app, health } = await fixture(t, { recoveryNonce });
  assert.equal((await shutdown(app)).status, 200);
  const intent = JSON.parse(await fs.readFile(path.join(root, 'data/runtime-stop.json'), 'utf8'));
  assert.equal(intent.recoveryNonce, recoveryNonce);
  assert.equal(intent.sessionId, health.sessionId);
});

test('programmatic close also publishes intentional stop and a new session replaces stale intent', async (t) => {
  const { root, app, health } = await fixture(t);
  await app.close();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'data/runtime-stop.json'), 'utf8')).sessionId,
    health.sessionId,
  );
  const again = await run({ appRoot: root, port: 0 });
  t.after(() => again.close());
  const next = await (await fetch(again.origin + '/api/health')).json();
  assert.notEqual(next.sessionId, health.sessionId);
  await again.close();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'data/runtime-stop.json'), 'utf8')).sessionId,
    next.sessionId,
  );
});
