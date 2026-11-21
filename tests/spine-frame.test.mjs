import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialState, applyCommand, validateState } from '../src/domain.mjs';
import { createBackup, validateBackup } from '../src/backup.mjs';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1EAAAAASUVORK5CYII=',
  'base64',
);
const assetId = createHash('sha256').update(image).digest('hex');
const frame = { x: 23, y: 72, zoom: 1.6 };
function fixture() {
  let state = applyCommand(createInitialState(), {
    type: 'addBook',
    draft: { title: 'Solaris', authors: ['Stanisław Lem'], shelfId: 'fantasy', status: 'read' },
  });
  return applyCommand(state, {
    type: 'setBookSpine',
    id: state.books[0].id,
    spine: { assetId, kind: 'manual' },
  });
}
const save = (state, value, expectedAssetId = assetId) =>
  applyCommand(state, {
    type: 'updateBook',
    id: state.books[0].id,
    patch: { spineFrame: { assetId: expectedAssetId, frame: value } },
  });
test('saved image frame survives validation and portable backup without changing image bytes', async () => {
  const state = fixture();
  state.books[0].spine.frame = frame;
  assert.deepEqual(validateState(state).books[0].spine.frame, frame);
  const store = { read: async () => ({ bytes: image, mime: 'image/png' }) };
  const restored = validateBackup(await createBackup(state, store, store));
  assert.deepEqual(restored.state.books[0].spine.frame, frame);
  assert.deepEqual(restored.spineImages[0].bytes, image);
});
test('frame and metadata save atomically without replacing artwork or starting a new image generation', () => {
  const before = fixture(),
    id = before.books[0].id;
  const after = applyCommand(before, {
    type: 'updateBook',
    id,
    patch: { title: 'Nowy tytuł', spineFrame: { assetId, frame } },
  });
  assert.deepEqual(after.books[0].spine.frame, frame);
  assert.equal(after.books[0].spine.assetId, assetId);
  assert.equal(after.books[0].spineGeneration, before.books[0].spineGeneration);
  assert.equal(after.books[0].title, 'Nowy tytuł');
  assert.equal(before.books[0].title, 'Solaris');
});
test('reset removes the custom frame and frame-free older collections retain their shape', () => {
  const before = fixture(),
    saved = save(before, frame),
    reset = save(saved, null);
  assert.deepEqual(reset.books[0].spine, before.books[0].spine);
  assert.deepEqual(validateState(before), before);
});
test('invalid crop data is rejected in saved state and edit commands', () => {
  for (const bad of [
    { x: -1, y: 50, zoom: 1 },
    { x: 50, y: 101, zoom: 1 },
    { x: 50, y: 50, zoom: 0.9 },
    { x: 50, y: 50, zoom: 3.1 },
    { x: '50', y: 50, zoom: 1 },
    { x: 50, y: NaN, zoom: 1 },
    { x: 50, zoom: 1 },
    [50, 50, 1],
    { x: 50, y: 50, zoom: 1, extra: true },
  ]) {
    const state = fixture();
    state.books[0].spine.frame = bad;
    assert.throws(
      () => validateState(state),
      (e) => e.code === 'INVALID',
    );
    assert.throws(
      () => save(fixture(), bad),
      (e) => e.code === 'INVALID',
    );
  }
});
test('a stale image frame cannot be applied to replacement artwork and leaves metadata intact', () => {
  const state = fixture();
  assert.throws(
    () =>
      applyCommand(state, {
        type: 'updateBook',
        id: state.books[0].id,
        patch: { title: 'Lost edit', spineFrame: { assetId: 'a'.repeat(64), frame } },
      }),
    (e) => e.code === 'CONFLICT',
  );
  assert.equal(state.books[0].title, 'Solaris');
});
test('changing a cover clears its old image and frame, while replacement artwork starts unframed', () => {
  const saved = save(fixture(), frame);
  const replaced = applyCommand(saved, {
    type: 'setBookSpine',
    id: saved.books[0].id,
    spine: { assetId: 'b'.repeat(64), kind: 'manual' },
  });
  assert.equal(replaced.books[0].spine.frame, undefined);
  const changed = applyCommand(saved, {
    type: 'updateBook',
    id: saved.books[0].id,
    patch: { coverId: 'a'.repeat(64) },
  });
  assert.equal(changed.books[0].spine, null);
});
