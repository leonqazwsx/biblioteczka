import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand } from '../src/domain.mjs';
const module = await import('../public/manager/room-layout-controller.mjs').catch(() => ({}));
function fixture() {
  let s = createInitialState();
  s = applyCommand(s, {
    type: 'addBook',
    draft: { title: 'A', authors: ['Autor'], shelfId: s.shelves[0].id, status: 'read' },
  });
  return s;
}
test('room draft assigns genre sources and books while discarding legacy decoration without changing saved state', () => {
  const state = fixture(),
    before = structuredClone(state),
    c = module.createRoomLayoutController(state),
    slot = c.slots[1].id,
    id = state.books[0].id;
  c.select(slot);
  c.setEnabled(true);
  c.setCavity({ source: { kind: 'shelf', id: state.shelves[0].id }, decoration: 'plant' });
  c.place(id);
  assert.equal(c.selectedSlot, slot);
  assert.deepEqual(c.layout.placements[id], { slotId: slot, order: 0 });
  assert.equal(c.layout.cavities[slot].decoration, null);
  assert.equal(c.dirty, true);
  assert.deepEqual(state, before);
  const copy = c.layout;
  copy.enabled = false;
  assert.equal(c.layout.enabled, true);
});
test('moving/removing assignments preserves order and cancel adopts current saved state', () => {
  let s = fixture();
  s = applyCommand(s, {
    type: 'addBook',
    draft: { title: 'B', authors: ['Autor'], shelfId: s.shelves[0].id, status: 'to-read' },
  });
  const c = module.createRoomLayoutController(s),
    [a, b] = s.books;
  c.place(a.id);
  c.place(b.id);
  c.shift(b.id, -1);
  assert.deepEqual(
    c.booksInSlot().map((v) => v.id),
    [b.id, a.id],
  );
  c.select(c.slots[1].id);
  c.place(a.id);
  assert.equal(c.layout.placements[a.id].slotId, c.slots[1].id);
  c.remove(a.id);
  assert.equal(c.layout.placements[a.id], undefined);
  c.discard();
  assert.equal(c.dirty, false);
  assert.deepEqual(c.layout.placements, {});
});
test('save sends the captured revision and only clears the draft after success', async () => {
  const s = fixture(),
    c = module.createRoomLayoutController(s);
  c.setEnabled(true);
  let sent;
  const result = await c.save(async (cmd, revision) => {
    sent = { cmd, revision };
    assert.equal(c.dirty, true);
    assert.throws(() => c.setEnabled(false), /zapisu/);
    return applyCommand(s, cmd);
  });
  assert.equal(sent.revision, s.revision);
  assert.equal(sent.cmd.type, 'setRoomLayout');
  assert.equal(sent.cmd.roomId, s.settings.room);
  assert.equal(result.revision, s.revision + 1);
  assert.equal(c.dirty, false);
});
test('external room/revision changes and conflicts keep the original draft until explicit discard', async () => {
  const s = fixture(),
    c = module.createRoomLayoutController(s),
    room = c.roomId;
  c.setEnabled(true);
  c.place(s.books[0].id);
  const draft = c.layout;
  const next = applyCommand(s, { type: 'updateSettings', patch: { room: 'green-library' } });
  c.receive(next);
  assert.equal(c.roomId, room);
  assert.deepEqual(c.layout, draft);
  assert.equal(c.stale, true);
  await assert.rejects(
    c.save(async () => {
      throw Object.assign(new Error('conflict'), { code: 'CONFLICT' });
    }),
    (e) => e.code === 'CONFLICT',
  );
  assert.deepEqual(c.layout, draft);
  assert.equal(c.revision, s.revision);
  c.discard();
  assert.equal(c.roomId, 'green-library');
  assert.equal(c.revision, next.revision);
  assert.equal(c.dirty, false);
  assert.equal(c.stale, false);
});
test('reset is an unsaved disabled layout; invalid references cannot enter the draft', () => {
  const s = fixture(),
    c = module.createRoomLayoutController(s);
  assert.throws(() => c.select('outside'));
  assert.throws(() => c.place('missing'));
  assert.throws(() => c.setCavity({ decoration: 'lamp' }));
  c.setEnabled(true);
  c.place(s.books[0].id);
  c.reset();
  assert.deepEqual(c.layout, { enabled: false, cavities: {}, placements: {} });
});
test('known local room-away/room-back updates preserve and safely save the original draft', async () => {
  let s = fixture();
  const c = module.createRoomLayoutController(s),
    room = c.roomId;
  c.setEnabled(true);
  c.setCavity({ decoration: 'plant' });
  const draft = c.layout;
  for (const target of ['green-library', room]) {
    s = applyCommand(s, { type: 'updateSettings', patch: { room: target } });
    c.receive(s, { local: true });
    assert.equal(c.stale, false);
    assert.equal(c.roomId, room);
    assert.deepEqual(c.layout, draft);
  }
  await c.save(async (cmd, revision) => {
    assert.equal(revision, s.revision);
    s = applyCommand(s, cmd);
    return s;
  });
  assert.deepEqual(s.settings.roomLayouts[room], draft);
  assert.equal(c.dirty, false);
});
test('local acknowledgement cannot rebase over an external target layout or deleted draft reference', () => {
  let s = fixture();
  const c = module.createRoomLayoutController(s),
    draftBook = s.books[0].id;
  c.setEnabled(true);
  c.place(draftBook);
  const original = c.layout;
  s = applyCommand(s, {
    type: 'setRoomLayout',
    roomId: c.roomId,
    layout: { enabled: true, cavities: {}, placements: {} },
  });
  c.receive(s);
  s = applyCommand(s, { type: 'updateSettings', patch: { theme: 'dark' } });
  c.receive(s, { local: true });
  assert.equal(c.stale, true);
  assert.deepEqual(c.layout, original);
  const deleted = module.createRoomLayoutController(fixture());
  deleted.setEnabled(true);
  deleted.place(deleted.state.books[0].id);
  const next = applyCommand(deleted.state, { type: 'deleteBook', id: deleted.state.books[0].id });
  deleted.receive(next, { local: true });
  assert.equal(deleted.stale, true);
  assert.equal(Object.keys(deleted.layout.placements).length, 1);
});
