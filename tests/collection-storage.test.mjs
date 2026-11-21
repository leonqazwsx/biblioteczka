import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run } from '../src/main.mjs';
test('an initialized installation reports recovery when its entire data folder disappears', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka missing data '));
  let app;
  t.after(async () => {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  app = await run({ appRoot: root, port: 0 });
  const first = await (await fetch(app.origin + '/api/bootstrap')).json();
  assert.equal(first.recovery, 'none');
  await app.close();
  await fs.rm(path.join(root, 'data'), { recursive: true, force: true });
  app = await run({ appRoot: root, port: 0 });
  const next = await (await fetch(app.origin + '/api/bootstrap')).json();
  assert.equal(next.recovery, 'unrecoverable');
  await assert.rejects(
    () => fs.access(path.join(root, 'data/library.json')),
    (e) => e.code === 'ENOENT',
  );
  const response = await fetch(app.origin + '/api/commands', {
    method: 'POST',
    headers: {
      Origin: app.origin,
      'Content-Type': 'application/json',
      'X-Bookshelf-Token': next.token,
    },
    body: JSON.stringify({
      expectedRevision: 0,
      command: {
        type: 'addBook',
        draft: {
          title: 'Must not create a replacement',
          authors: ['Reader'],
          shelfId: 'other',
          status: 'read',
        },
      },
    }),
  });
  assert.equal(response.status, 409);
});
