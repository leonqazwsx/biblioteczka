import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { run } from '../src/main.mjs';

async function root(t) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-ownership-'));
  t.after(() => fs.rm(p, { recursive: true, force: true }));
  return p;
}
async function fixtureOwner(dataDir, owner) {
  await fs.mkdir(path.join(dataDir, '.bookshelf-data-lock'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, '.bookshelf-data-lock', 'owner-' + owner.token + '.json'),
    JSON.stringify(owner),
  );
}
const owner = (pid) => ({
  version: 1,
  pid,
  hostname: os.hostname(),
  token: crypto.randomUUID(),
  createdAt: '2000-01-01T00:00:00.000Z',
});

test('another port cannot open the same data while its server owns it', async (t) => {
  const p = await root(t),
    a = await run({ appRoot: p, port: 0 });
  t.after(() => a.close());
  let b;
  try {
    await assert.rejects(
      async () => {
        b = await run({ appRoot: p, port: 0 });
      },
      (e) => e.code === 'DATA_IN_USE',
    );
  } finally {
    await b?.close();
  }
  const health = await (await fetch(a.origin + '/api/health')).json();
  assert.equal(health.recovery, 'none');
  await a.close();
  const next = await run({ appRoot: p, port: 0 });
  await next.close();
});

test('an old lock with a living owner is retained regardless of age', async (t) => {
  const p = await root(t),
    dataDir = path.join(p, 'data'),
    record = owner(process.pid);
  await fixtureOwner(dataDir, record);
  let app;
  try {
    await assert.rejects(
      async () => {
        app = await run({ appRoot: p, port: 0 });
      },
      (e) => e.code === 'DATA_IN_USE',
    );
  } finally {
    await app?.close();
  }
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(dataDir, '.bookshelf-data-lock', 'owner-' + record.token + '.json'),
        'utf8',
      ),
    ),
    record,
  );
});

test('ambiguous owner metadata is retained without opening the collection', async (t) => {
  const p = await root(t),
    dataDir = path.join(p, 'data');
  await fs.mkdir(path.join(dataDir, '.bookshelf-data-lock'), { recursive: true });
  await fs.writeFile(path.join(dataDir, '.bookshelf-data-lock', 'broken.json'), 'broken');
  let app;
  try {
    await assert.rejects(
      async () => {
        app = await run({ appRoot: p, port: 0 });
      },
      (e) => e.code === 'DATA_IN_USE',
    );
  } finally {
    await app?.close();
  }
  assert.equal(
    await fs.readFile(path.join(dataDir, '.bookshelf-data-lock', 'broken.json'), 'utf8'),
    'broken',
  );
  await assert.rejects(
    () => fs.access(path.join(dataDir, 'library.json')),
    (e) => e.code === 'ENOENT',
  );
});

test('a positively dead process owner can be recovered', async (t) => {
  const p = await root(t),
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  await once(child, 'spawn');
  const pid = child.pid;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  await fixtureOwner(path.join(p, 'data'), owner(pid));
  const app = await run({ appRoot: p, port: 0 });
  t.after(() => app.close());
  const blocked = await run({ appRoot: p, port: 0 }).then(
    (value) => {
      value.close();
      return false;
    },
    (e) => e.code === 'DATA_IN_USE',
  );
  assert.equal(blocked, true);
  await app.close();
  assert.equal(
    await fs.access(path.join(p, 'data', '.bookshelf-data-lock')).then(
      () => true,
      () => false,
    ),
    false,
  );
});

test('failed startup releases data ownership for a corrected retry', async (t) => {
  const p = await root(t),
    dataDir = path.join(p, 'data');
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, 'covers'), 'not a directory');
  await assert.rejects(() => run({ appRoot: p, port: 0 }));
  await fs.unlink(path.join(dataDir, 'covers'));
  const app = await run({ appRoot: p, port: 0 });
  await app.close();
  assert.equal(
    await fs.access(path.join(dataDir, '.bookshelf-data-lock')).then(
      () => true,
      () => false,
    ),
    false,
  );
});
test(
  'an independent process owns data until termination and its stale lock is recovered',
  { timeout: 10000 },
  async (t) => {
    const p = await root(t),
      dataDir = path.join(p, 'data');
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../src/main.mjs', import.meta.url)),
        '--port',
        '0',
        '--data-dir',
        dataDir,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit');
        child.kill();
        await ended;
      }
    });
    const output = await new Promise((resolve, reject) => {
      child.stdout.once('data', (chunk) => resolve(String(chunk)));
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error('Child startup failed: ' + code)));
    });
    const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(origin);
    const first = await (await fetch(origin + '/api/health')).json();
    assert.equal(first.pid, child.pid);
    await assert.rejects(
      () => run({ appRoot: p, port: 0 }),
      (e) => e.code === 'DATA_IN_USE',
    );
    const ended = once(child, 'exit');
    child.kill();
    await ended;
    const restored = await run({ appRoot: p, port: 0 });
    t.after(() => restored.close());
    const health = await (await fetch(restored.origin + '/api/health')).json();
    assert.notEqual(health.sessionId, first.sessionId);
    assert.equal(health.collectionId, first.collectionId);
    await restored.close();
  },
);

test('concurrent recovery contenders accept only one writer', async (t) => {
  const p = await root(t),
    child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await once(child, 'spawn');
  const pid = child.pid;
  await once(child, 'exit');
  await fixtureOwner(path.join(p, 'data'), owner(pid));
  const results = await Promise.allSettled([
    run({ appRoot: p, port: 0 }),
    run({ appRoot: p, port: 0 }),
    run({ appRoot: p, port: 0 }),
  ]);
  const accepted = results.filter((x) => x.status === 'fulfilled');
  t.after(() => Promise.all(accepted.map((x) => x.value.close())));
  assert.equal(accepted.length, 1);
  assert.ok(
    results.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'DATA_IN_USE'),
  );
  await accepted[0].value.close();
});

test('a recovered lower revision advertises a new session and backup recovery in bootstrap and events', async (t) => {
  const p = await root(t),
    dataDir = path.join(p, 'data'),
    first = await run({ appRoot: p, port: 0 });
  t.after(() => first.close());
  const bootstrap = await (await fetch(first.origin + '/api/bootstrap')).json();
  const post = (command, revision) =>
    fetch(first.origin + '/api/commands', {
      method: 'POST',
      headers: {
        Origin: first.origin,
        'Content-Type': 'application/json',
        'X-Bookshelf-Token': bootstrap.token,
      },
      body: JSON.stringify({ command, expectedRevision: revision }),
    });
  await post({ type: 'updateSettings', patch: { theme: 'dark' } }, 0);
  await post({ type: 'updateSettings', patch: { theme: 'light' } }, 1);
  const before = await (await fetch(first.origin + '/api/bootstrap')).json();
  assert.equal(before.revision, 2);
  await first.close();
  await fs.writeFile(path.join(dataDir, 'library.json'), 'broken primary');
  const recovered = await run({ appRoot: p, port: 0 });
  t.after(() => recovered.close());
  const info = await (await fetch(recovered.origin + '/api/bootstrap')).json();
  assert.notEqual(info.sessionId, before.sessionId);
  assert.equal(info.revision, 1);
  assert.equal(info.collectionId, before.collectionId);
  assert.equal(info.recovery, 'backup');
  const controller = new AbortController();
  const stream = await fetch(recovered.origin + '/api/events', { signal: controller.signal });
  const reader = stream.body.getReader();
  const { value } = await reader.read();
  const event = JSON.parse(new TextDecoder().decode(value).split('data: ')[1].trim());
  controller.abort();
  assert.equal(event.sessionId, info.sessionId);
  assert.equal(event.recovery, 'backup');
  assert.equal(event.revision, 1);
  const state = await (await fetch(recovered.origin + '/api/state')).json();
  assert.equal('sessionId' in state, false);
  assert.equal('recovery' in state, false);
  await recovered.close();
});
