import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { createInitialState, applyCommand } from '../src/domain.mjs';
const drafts = () => [
  {
    title: 'A',
    authors: ['Autor'],
    shelfId: 'other',
    status: 'read',
    goodreadsId: '1',
    readDate: '2024-02-29',
  },
  {
    title: 'B',
    authors: ['Autor'],
    shelfId: null,
    newShelfName: 'Biografie',
    status: 'to-read',
    goodreadsId: '2',
  },
];
async function folder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goodreads-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('opening old schema2 adds null Goodreads IDs in memory without rewriting bytes', async (t) => {
  const dir = await folder(t),
    file = path.join(dir, 'library.json'),
    old = applyCommand(createInitialState(), {
      type: 'addBook',
      draft: { title: 'Ręczna', authors: ['Autor'], shelfId: 'other', status: 'read' },
    });
  delete old.books[0].goodreadsId;
  const bytes = JSON.stringify(old);
  await fs.writeFile(file, bytes);
  const store = await openStore(dir);
  assert.equal(store.read().books[0].goodreadsId, null);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  assert.equal(store.read().revision, old.revision);
});
test('one atomic append persists and reopens all imported fields, preserving unrelated media', async (t) => {
  const dir = await folder(t),
    store = await openStore(dir),
    before = store.read();
  await fs.writeFile(path.join(dir, 'manual-media.png'), 'unchanged');
  const next = await store.appendImported(drafts(), {
    expectedRevision: before.revision,
    expectedCollectionId: before.collectionId,
  });
  assert.equal(next.revision, before.revision + 1);
  assert.equal(next.collectionId, before.collectionId);
  assert.deepEqual((await openStore(dir)).read(), next);
  assert.equal(next.books[0].goodreadsId, '1');
  assert.equal(next.books[0].readDate, '2024-02-29');
  assert.equal(await fs.readFile(path.join(dir, 'manual-media.png'), 'utf8'), 'unchanged');
  const backup = JSON.parse(await fs.readFile(path.join(dir, 'library.backup.json'), 'utf8'));
  assert.deepEqual(backup, before);
});
test('captured collection identity is checked even when revision matches', async (t) => {
  const store = await openStore(await folder(t)),
    before = store.read();
  await assert.rejects(
    () =>
      store.appendImported(drafts(), {
        expectedRevision: before.revision,
        expectedCollectionId: crypto.randomUUID(),
      }),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(store.read(), before);
});
test('an ordinary edit queued before import invalidates the captured revision inside the queue', async (t) => {
  const store = await openStore(await folder(t)),
    before = store.read();
  const edit = store.commit({ type: 'updateSettings', patch: { theme: 'dark' } }, before.revision),
    append = store.appendImported(drafts(), {
      expectedRevision: before.revision,
      expectedCollectionId: before.collectionId,
    });
  await edit;
  await assert.rejects(() => append, { code: 'CONFLICT' });
  assert.equal(store.read().settings.theme, 'dark');
  assert.equal(store.read().books.length, 0);
  assert.equal(store.read().revision, 1);
});
test('failed primary rename leaves memory/file/previous backup unchanged and no partial row', async (t) => {
  const dir = await folder(t);
  let fail = false;
  const adapter = {
    ...fs,
    rename: async (...args) => {
      if (fail && args[1].endsWith('library.json'))
        throw Object.assign(new Error('disk full'), { code: 'EIO' });
      return fs.rename(...args);
    },
  };
  const store = await openStore(dir, { fsAdapter: adapter });
  await store.commit(
    {
      type: 'addBook',
      draft: { title: 'Ręczna', authors: ['Autor'], shelfId: 'other', status: 'reading' },
    },
    0,
  );
  const before = store.read(),
    bytes = await fs.readFile(path.join(dir, 'library.json'));
  fail = true;
  await assert.rejects(
    () =>
      store.appendImported(drafts(), {
        expectedRevision: before.revision,
        expectedCollectionId: before.collectionId,
      }),
    { code: 'EIO' },
  );
  assert.deepEqual(store.read(), before);
  assert.ok((await fs.readFile(path.join(dir, 'library.json'))).equals(bytes));
  assert.deepEqual((await openStore(dir)).read(), before);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, 'library.backup.json'), 'utf8')),
    before,
  );
  assert.equal(
    (await fs.readdir(dir)).some((n) => n.endsWith('.tmp')),
    false,
  );
});
