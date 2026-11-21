import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand } from '../src/domain.mjs';
import { createRoomLayoutController } from '../public/manager/room-layout-controller.mjs';
import { createRoomLayoutPanel } from '../public/manager/room-layout-panel.mjs';
import { importDom } from './helpers/import-dom.mjs';
import * as manager from '../public/manager/annual-settings.mjs';
import { ROOM_SCENES } from '../public/shared/room-scene.mjs';
import { buildPages } from '../public/shared/layout.mjs';

test('changing the room keeps undated books visible in the chosen genre view', () => {
  let state = createInitialState();
  state.settings.readingYear = 2024;
  for (const title of ['Solaris', 'Limes inferior'])
    state = applyCommand(state, {
      type: 'addBook',
      draft: { title, authors: ['Autor'], shelfId: 'fantasy', status: 'read', readDate: null },
    });
  const before = structuredClone(state);
  for (const scene of ROOM_SCENES) {
    state = applyCommand(state, {
      type: 'updateSettings',
      patch: manager.roomSelectionPatch(scene),
    });
    assert.equal(state.settings.room, scene.id);
    assert.equal(state.settings.grouping, 'shelves', scene.id + ' must not enable a date filter');
    const visible = buildPages(state, { width: 1920, height: 1080 }).flatMap((p) =>
      p.rows.flatMap((r) => r.books.map((b) => b.book.title)),
    );
    assert.deepEqual(visible.toSorted(), ['Limes inferior', 'Solaris']);
    assert.deepEqual(state.books, before.books);
    assert.deepEqual(state.shelves, before.shelves);
    assert.deepEqual(state.settings.roomLayouts, before.settings.roomLayouts);
    assert.equal(state.settings.readingYear, 2024);
  }
});

test('an explicitly chosen annual view survives changing to a legacy room and back', () => {
  let state = createInitialState();
  state = applyCommand(state, {
    type: 'updateSettings',
    patch: { grouping: 'months', readingYear: 2024 },
  });
  for (const roomId of ['annual-niches', 'green-library', 'annual-panorama']) {
    const scene = ROOM_SCENES.find((s) => s.id === roomId);
    state = applyCommand(state, {
      type: 'updateSettings',
      patch: manager.roomSelectionPatch(scene),
    });
    assert.equal(state.settings.room, roomId);
    assert.equal(state.settings.grouping, 'months');
    assert.equal(state.settings.readingYear, 2024);
  }
});

function panelDom(t) {
  const { doc, root } = importDom(),
    previousDocument = globalThis.document,
    previousObserver = globalThis.ResizeObserver;
  globalThis.document = doc;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.ResizeObserver = previousObserver;
  });
  return root;
}

test('annual preview hides manual placement and lets the user return to genres', async (t) => {
  const root = panelDom(t),
    state = createInitialState();
  state.settings.room = 'annual-niches';
  state.settings.grouping = 'months';
  let command;
  const panel = createRoomLayoutPanel({
    state,
    onSave: async (value) => {
      command = value;
    },
    onDirtyChange() {},
    notice() {},
  });
  panel.mount(root, state);
  assert.equal(root.querySelectorAll('input,select').length, 0);
  assert.equal(
    root
      .querySelectorAll('button')
      .some((button) => /Przywróć automatyczny|Zapisz rozmieszczenie/.test(button.textContent)),
    false,
  );
  assert.match(root.textContent, /miesi|roczn/i);
  const switchView = root
    .querySelectorAll('button')
    .find((button) => button.textContent === 'Pokaż według gatunków');
  assert.ok(switchView);
  await switchView.onclick();
  assert.deepEqual(command, { type: 'updateSettings', patch: { grouping: 'shelves' } });
});

test('an old-room draft stays dirty while the active annual room hides its controls', (t) => {
  const root = panelDom(t);
  let state = createInitialState();
  const originalRoom = state.settings.room;
  const panel = createRoomLayoutPanel({
    state,
    onSave: async () => {},
    onDirtyChange() {},
    notice() {},
  });
  panel.mount(root, state);
  const enabled = root
    .querySelectorAll('input')
    .find((input) => input.getAttribute('aria-label') === 'Własny układ w tym pokoju');
  enabled.checked = true;
  enabled.onchange();
  assert.equal(panel.isDirty(), true);
  state = applyCommand(state, {
    type: 'updateSettings',
    patch: { room: 'annual-niches', grouping: 'months' },
  });
  panel.receive(state, { local: true });
  panel.refresh();
  assert.equal(root.querySelectorAll('input,select').length, 0);
  assert.equal(panel.isDirty(), true);
  assert.match(root.textContent, /szkic.*zachowan/i);
  panel.unmount();
  state = applyCommand(state, {
    type: 'updateSettings',
    patch: { room: originalRoom, grouping: 'shelves' },
  });
  panel.receive(state, { local: true });
  panel.mount(root, state);
  assert.equal(panel.isDirty(), true);
  assert.equal(
    root
      .querySelectorAll('input')
      .find((input) => input.getAttribute('aria-label') === 'Własny układ w tym pokoju').checked,
    true,
  );
});

test('monthly controls are active only in a scene that supports annual reading', () => {
  assert.equal(manager.isMonthlyView({ grouping: 'months' }, { annual: true }), true);
  assert.equal(manager.isMonthlyView({ grouping: 'shelves' }, { annual: true }), false);
  assert.equal(manager.isMonthlyView({ grouping: 'months' }, {}), false);
  assert.equal(manager.isMonthlyView({}, {}), false);
});

test('year input accepts only complete years from 1 through 9999', () => {
  for (const [input, year] of [
    ['1', 1],
    ['2024', 2024],
    ['9999', 9999],
    [2026, 2026],
  ])
    assert.deepEqual(manager.readingYearPatch(input), { readingYear: year });
  for (const input of ['', null, undefined, '0', '10000', '-1', '2024.5', '2e3', '2024x', Infinity])
    assert.throws(() => manager.readingYearPatch(input), /1.*9999/);
});

test('missing year uses the local current year and valid saved years survive', () => {
  const date = new Date(2026, 0, 1, 0, 30);
  assert.equal(manager.readingYearValue({}, date), 2026);
  assert.equal(manager.readingYearValue({ readingYear: 1 }, date), 1);
  assert.equal(manager.readingYearValue({ readingYear: 2024 }, date), 2024);
  assert.equal(manager.readingYearValue({ readingYear: 9999 }, date), 9999);
});

test('local grouping and year changes preserve a dirty layout draft until it is saved', async () => {
  let state = createInitialState();
  state = applyCommand(state, {
    type: 'addBook',
    draft: {
      title: 'A',
      authors: ['Autor'],
      shelfId: state.shelves[0].id,
      status: 'read',
      readDate: '2024-02-29',
    },
  });
  const originalBooks = structuredClone(state.books),
    controller = createRoomLayoutController(state),
    room = controller.roomId;
  controller.setEnabled(true);
  controller.place(state.books[0].id);
  const draft = controller.layout;
  for (const patch of [{ grouping: 'months' }, { readingYear: 2024 }, { grouping: 'shelves' }]) {
    state = applyCommand(state, { type: 'updateSettings', patch });
    controller.receive(state, { local: true });
    assert.deepEqual(controller.layout, draft);
    assert.equal(controller.dirty, true);
    assert.equal(controller.stale, false);
    assert.deepEqual(state.books, originalBooks);
  }
  await controller.save(async (cmd, revision) => {
    assert.equal(revision, state.revision);
    state = applyCommand(state, cmd);
    return state;
  });
  assert.deepEqual(state.settings.roomLayouts[room], draft);
  assert.equal(controller.dirty, false);
  assert.deepEqual(state.books, originalBooks);
});
