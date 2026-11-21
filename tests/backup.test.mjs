import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialState } from '../src/domain.mjs';
import { validateBackup, createBackup } from '../src/backup.mjs';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
  'base64',
);
test('complete backup retains cover bytes and rejects modified hashes', async () => {
  const state = createInitialState(),
    hash = createHash('sha256').update(png).digest('hex');
  state.books.push({
    id: 'one',
    title: 'Solaris',
    authors: ['Lem'],
    shelfId: 'fantasy',
    status: 'read',
    order: 0,
    coverId: hash,
  });
  const backup = await createBackup(state, {
    read: async () => ({ bytes: png, mime: 'image/png' }),
  });
  const checked = validateBackup(backup);
  assert.equal(checked.summary.books, 1);
  assert.deepEqual(checked.images[0].bytes, png);
  backup.images[0].coverId = 'a'.repeat(64);
  assert.throws(() => validateBackup(backup));
});
test('invalid version and missing referenced covers are rejected', () => {
  assert.throws(() =>
    validateBackup({
      format: 'bookshelf-backup',
      version: 2,
      state: createInitialState(),
      images: [],
    }),
  );
  const state = createInitialState();
  state.books.push({
    id: 'one',
    title: 'Solaris',
    authors: ['Lem'],
    shelfId: 'fantasy',
    status: 'read',
    order: 0,
    coverId: 'a'.repeat(64),
  });
  assert.throws(() =>
    validateBackup({ format: 'bookshelf-backup', version: 1, state, images: [] }),
  );
});
test('export refuses a JSON backup that cannot be restored within the import limit', async () => {
  const state = createInitialState();
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  for (let i = 0; i < 10; i++)
    state.books.push({
      id: String(i),
      title: 'A',
      authors: ['B'],
      shelfId: 'other',
      status: 'read',
      order: i,
      coverId: String(i).padStart(64, '0'),
    });
  await assert.rejects(
    () => createBackup(state, { read: async () => ({ bytes, mime: 'image/png' }) }),
    (e) => e.code === 'TOO_LARGE' && /data/.test(e.message),
  );
});
test('backup restores a calendar completion date and keeps unknown dates empty', async () => {
  const state = createInitialState();
  state.books.push(
    {
      id: 'dated',
      title: 'Solaris',
      authors: ['Lem'],
      shelfId: 'fantasy',
      status: 'read',
      order: 0,
      readDate: '2026-10-04',
    },
    { id: 'legacy', title: 'Lalka', authors: ['Prus'], shelfId: 'other', status: 'read', order: 0 },
  );
  const restored = validateBackup(await createBackup(state, {})).state;
  assert.equal(restored.books[0].readDate, '2026-10-04');
  assert.equal(restored.books[1].readDate, null);
});
test('backup retains the selected room independently of its interface theme', async () => {
  const state = createInitialState();
  state.settings.room = 'window-reading';
  state.settings.theme = 'dark';
  const restored = validateBackup(await createBackup(state, {})).state;
  assert.equal(restored.settings.room, 'window-reading');
  assert.equal(restored.settings.theme, 'dark');
});
