import test from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../public/shared/layout.mjs';
import { createInitialState } from '../src/domain.mjs';
import { getRoomScene } from '../public/shared/room-scene.mjs';

function fixture() {
  const state = createInitialState();
  state.books = Array.from({ length: 300 }, (_, i) => ({
    id: 'book-' + i,
    title: 'Książka ' + i,
    authors: ['Autor'],
    shelfId: 'fantasy',
    status: 'read',
    order: i,
    pageCount: 300,
    spineStyle: i % 6,
  }));
  return state;
}
const viewport = { width: 1920, height: 1080 };
const books = (pages) => pages.flatMap((page) => page.rows.flatMap((row) => row.books));

test('page navigation and lighting reuse the complete plan for one state snapshot', () => {
  const state = fixture(),
    plan = layout.createPagePlanner();
  const first = plan(state, viewport);
  assert.ok(first.length > 1);
  state.settings.theme = 'dark';
  state.settings.lighting = 'evening';
  assert.equal(
    plan(state, viewport),
    first,
    'presentation-only changes must not recompute all book pages',
  );
});

test('page plan refreshes data references and dimensions after a collection revision', () => {
  const state = fixture(),
    plan = layout.createPagePlanner(),
    first = plan(state, viewport);
  const next = structuredClone(state);
  next.revision++;
  next.books[0].title = 'Nowy tytuł';
  next.books[0].pageCount = 1000;
  const refreshed = plan(next, viewport);
  assert.notEqual(refreshed, first);
  assert.equal(books(refreshed).find((item) => item.book.id === 'book-0').book.title, 'Nowy tytuł');
  assert.ok(books(refreshed)[0].width > books(first)[0].width);
  const replacement = structuredClone(next);
  replacement.books[0].title = 'Szkic podglądu';
  assert.equal(
    books(plan(replacement, viewport))[0].book.title,
    'Szkic podglądu',
    'draft snapshots can share a saved revision',
  );
});

test('viewport, reserve, room, scale, grouping, sorting and custom placement invalidate plans', () => {
  const state = fixture(),
    plan = layout.createPagePlanner();
  let previous = plan(state, viewport);
  const check = (options = viewport) => {
    const next = plan(state, options);
    assert.notEqual(next, previous);
    previous = next;
  };
  check({ width: 1366, height: 768 });
  check(viewport);
  state.settings.iconSpace = 0.3;
  check();
  state.settings.room = 'green-library';
  check();
  state.settings.bookScales = { 'green-library': 0.6 };
  check();
  state.settings.grouping = 'status';
  check();
  state.settings.sort = 'title-desc';
  check();
  const scene = getRoomScene('green-library'),
    last = scene.slots.at(-1).id;
  state.settings.roomLayouts = {
    'green-library': {
      enabled: true,
      cavities: {},
      placements: { 'book-0': { slotId: last, order: 0 } },
    },
  };
  check();
  assert.equal(
    previous
      .flatMap((page) => page.rows)
      .find((row) => row.books.some((item) => item.book.id === 'book-0')).slotId,
    last,
  );
  state.settings.roomLayouts['green-library'].placements['book-0'].slotId = scene.slots[0].id;
  check();
  check({ ...viewport, scene: { ...scene, bookHeight: scene.bookHeight * 0.8 } });
});

test('custom layout derives expensive spine properties once per book, not once per cavity', () => {
  const state = fixture();
  state.settings.roomLayouts = {
    [state.settings.room]: { enabled: true, cavities: {}, placements: {} },
  };
  let paletteReads = 0;
  for (const book of state.books)
    Object.defineProperty(book, 'palette', {
      get() {
        paletteReads++;
        return ['#32556a'];
      },
    });
  const pages = layout.buildPages(state, viewport);
  assert.equal(books(pages).length, 300);
  assert.ok(
    paletteReads <= state.books.length * 5,
    `palette accessed ${paletteReads} times for 300 books`,
  );
});
