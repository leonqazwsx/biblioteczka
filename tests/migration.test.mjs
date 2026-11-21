import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.mjs';
const { migrateState } = await import('../src/migrations.mjs').catch(() => ({}));
const old = () => ({
  schemaVersion: 1,
  revision: 5,
  books: [
    {
      id: 'legacy',
      title: 'Solaris',
      authors: ['Lem'],
      shelfId: 'fantasy',
      status: 'read',
      order: 0,
      coverId: 'a'.repeat(64),
    },
  ],
  shelves: [{ id: 'fantasy', name: 'Fantastyka', order: 0 }],
  settings: { theme: 'dark', grouping: 'shelves', iconSpace: 0.2 },
});
test('spine result attaches to ticket book rather than first collection entry', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-target-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = await openStore(dir);
  for (const title of ['First', 'Second'])
    await s.commit(
      {
        type: 'addBook',
        draft: {
          title,
          authors: ['Author'],
          shelfId: 'other',
          status: 'read',
          coverId: 'a'.repeat(64),
        },
      },
      s.read().revision,
    );
  const { ticket } = await s.beginSpine(s.read().books[1].id, { expectedRevision: 2 });
  await s.attachSpineIfCurrent(ticket, {
    assetId: 'b'.repeat(64),
    kind: 'ai',
    sourceCoverId: ticket.coverId,
    model: 'model',
    promptVersion: 'v1',
  });
  assert.equal(s.read().books[0].spine, null);
  assert.equal(s.read().books[1].spine.assetId, 'b'.repeat(64));
});
test('schema one migration preserves books and disables paid generation', () => {
  assert.equal(typeof migrateState, 'function');
  const s = migrateState(old());
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.books[0].coverId, 'a'.repeat(64));
  assert.equal(s.books[0].spine, null);
  assert.equal(s.books[0].spineGeneration, 0);
  assert.equal(s.settings.aiEnabled, false);
  assert.equal(s.settings.theme, 'dark');
  assert.throws(() => migrateState({ ...old(), schemaVersion: 2 }));
});
test('migration keeps immutable original bytes and survives interrupted write', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-migration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = JSON.stringify(old());
  await fs.writeFile(path.join(dir, 'library.json'), original);
  let fail = true;
  const adapter = {
    ...fs,
    rename: async (a, b) => {
      if (fail && b.endsWith('library.json')) throw new Error('disk full');
      return fs.rename(a, b);
    },
  };
  await assert.rejects(() => openStore(dir, { fsAdapter: adapter }));
  assert.equal(await fs.readFile(path.join(dir, 'library.json'), 'utf8'), original);
  assert.equal(await fs.readFile(path.join(dir, 'library.schema1.backup.json'), 'utf8'), original);
  fail = false;
  const s = await openStore(dir);
  assert.equal(s.read().books.length, 1);
  await s.commit({ type: 'updateSettings', patch: { theme: 'light' } }, 5);
  await openStore(dir);
  assert.equal(await fs.readFile(path.join(dir, 'library.schema1.backup.json'), 'utf8'), original);
});
test('spine attachment allows unrelated revisions and rejects replaced collections', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spine-ticket-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = await openStore(dir);
  await s.commit(
    {
      type: 'addBook',
      draft: {
        title: 'A',
        authors: ['B'],
        shelfId: 'other',
        status: 'read',
        coverId: 'a'.repeat(64),
      },
    },
    0,
  );
  assert.equal(typeof s.beginSpine, 'function');
  const { ticket } = await s.beginSpine(s.read().books[0].id, { expectedRevision: 1 });
  await s.commit({ type: 'updateSettings', patch: { theme: 'dark' } }, 2);
  const image = {
    assetId: 'b'.repeat(64),
    kind: 'ai',
    sourceCoverId: ticket.coverId,
    model: 'model',
    promptVersion: 'v1',
  };
  assert.ok(await s.attachSpineIfCurrent(ticket, image));
  const current = s.read();
  const second = await s.beginSpine(current.books[0].id, { expectedRevision: current.revision });
  await s.replace(s.read(), s.read().revision);
  assert.equal(await s.attachSpineIfCurrent(second.ticket, image), null);
});
