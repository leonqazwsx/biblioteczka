import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPages } from '../public/shared/layout.mjs';
import { createInitialState } from '../src/domain.mjs';
import { ROOM_SCENE, fitScene } from '../public/shared/room-scene.mjs';
import * as rooms from '../public/shared/room-scene.mjs';
const fixture = () => {
  const s = createInitialState();
  s.books = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    title: 'Bardzo długi polski tytuł książki ' + i,
    authors: ['Autor'],
    shelfId: s.shelves[i % 3].id,
    status: ['to-read', 'reading', 'read'][i % 3],
    order: i,
    pageCount: 300 + i,
    palette: ['#32556a'],
  }));
  return s;
};
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
])
  for (const iconSpace of [0, 0.2, 0.3])
    test(`100 books fit measured cavities at ${width}x${height}, icons ${iconSpace}`, () => {
      const s = fixture();
      s.settings.iconSpace = iconSpace;
      const pages = buildPages(s, { width, height }),
        ids = pages.flatMap((p) => p.rows.flatMap((r) => r.books.map((x) => x.book.id)));
      assert.equal(ids.length, 100);
      assert.equal(new Set(ids).size, 100);
      const fit = fitScene(ROOM_SCENE, { width, height, iconSpace });
      for (const p of pages) {
        assert.ok(p.rows.length <= 7);
        for (const r of p.rows) {
          const slot = ROOM_SCENE.slots.find((x) => x.id === r.slotId);
          assert.ok(slot, 'every row maps to an actual shelf cavity');
          assert.ok(
            r.books.every(
              (b) => b.width >= 14 && b.height > 0 && b.height <= slot.books.height * fit.height,
            ),
          );
          assert.ok(
            r.books.reduce((n, b) => n + b.width, 0) + Math.max(0, r.books.length - 1) * 2 <=
              slot.books.width * fit.width + 0.001,
          );
        }
      }
    });
test('theme change retains layout and legacy grouping does not duplicate books', () => {
  const s = fixture();
  const pages = buildPages(s, { width: 1366, height: 768 });
  s.settings.theme = 'dark';
  assert.deepEqual(buildPages(s, { width: 1366, height: 768 }), pages);
  s.settings.grouping = 'status';
  const grouped = buildPages(s, { width: 1366, height: 768 });
  assert.equal(grouped.flatMap((p) => p.rows.flatMap((r) => r.books)).length, 100);
  assert.equal(grouped[0].rows[0].label, 'Fantastyka');
});
test('large single group flows across cavities and pages without loss', () => {
  const s = fixture();
  s.books = Array.from({ length: 300 }, (_, i) => ({
    ...s.books[i % 100],
    id: String(i),
    shelfId: s.shelves[0].id,
  }));
  const pages = buildPages(s, { width: 1366, height: 768 });
  assert.ok(pages.length > 1);
  assert.equal(pages.flatMap((p) => p.rows.flatMap((r) => r.books)).length, 300);
});
test('empty categories and no categories remain navigable', () => {
  const s = createInitialState();
  s.shelves = Array.from({ length: 200 }, (_, i) => ({
    id: String(i),
    name: 'Półka ' + i,
    order: i,
  }));
  const pages = buildPages(s, { width: 1366, height: 768 });
  assert.equal(pages.length, 1);
  assert.equal(pages.flatMap((p) => p.rows).length, 1);
  s.shelves = [];
  assert.equal(buildPages(s, { width: 1366, height: 768 }).length, 1);
});
test('tiny preview reports insufficient space instead of clipping books', () =>
  assert.throws(() => buildPages(fixture(), { width: 120, height: 80 }), {
    code: 'VIEWPORT_TOO_SMALL',
  }));
test('room books keep spine proportions relative to their actual height', () => {
  const items = buildPages(fixture(), { width: 1920, height: 1080 }).flatMap((p) =>
    p.rows.flatMap((r) => r.books),
  );
  assert.ok(
    items.every((b) => b.width >= 14 && b.width <= b.height * 0.32),
    'spines should scale with their height, not the old 260px preview',
  );
});
test('cropped room uses visible shelf space and keeps every book out of the icon strip', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1920, 1200],
    [1600, 1200],
    [3440, 1440],
    [5120, 1440],
  ]) {
    const s = fixture();
    s.settings.iconSpace = 0.3;
    const fit = fitScene(ROOM_SCENE, { width, height, iconSpace: 0.3 }),
      pages = buildPages(s, { width, height });
    const items = pages.flatMap((p) => p.rows.flatMap((r) => r.books));
    assert.equal(items.length, 100);
    assert.equal(new Set(items.map((i) => i.book.id)).size, 100);
    for (const p of pages)
      for (const row of p.rows) {
        const slot = ROOM_SCENE.slots.find((s) => s.id === row.slotId),
          r = row.bounds ?? slot.books,
          left = fit.x + r.x * fit.width,
          right = left + r.width * fit.width;
        assert.ok(
          left >= width * 0.3 - 0.001 && right <= width + 0.001,
          'books must stay in visible space outside desktop icons',
        );
        assert.ok(
          fit.y + r.y * fit.height >= 0 &&
            fit.y + (slot.front.y + slot.front.height) * fit.height <= height,
          'only visible cavities may receive books',
        );
        assert.ok(
          row.books.reduce((sum, b) => sum + b.width, 0) + Math.max(0, row.books.length - 1) * 2 <=
            r.width * fit.width + 0.001,
        );
      }
  }
});
test('room selection positions all books in that room across desktop ratios and pagination', () => {
  assert.ok(Array.isArray(rooms.ROOM_SCENES));
  for (const scene of rooms.ROOM_SCENES)
    for (const [width, height] of [
      [1366, 768],
      [1920, 1200],
      [3440, 1440],
      [5120, 1440],
    ]) {
      const s = fixture();
      s.settings.room = scene.id;
      s.settings.iconSpace = 0.3;
      const pages = buildPages(s, { width, height }),
        fit = fitScene(scene, { width, height, iconSpace: 0.3 });
      const ids = pages.flatMap((p) => p.rows.flatMap((r) => r.books.map((b) => b.book.id)));
      assert.equal(ids.length, 100);
      assert.equal(new Set(ids).size, 100);
      for (const page of pages)
        for (const row of page.rows) {
          const slot = scene.slots.find((c) => c.id === row.slotId);
          assert.ok(slot, scene.id + ' uses its own cavities');
          const r = row.bounds,
            left = fit.x + r.x * fit.width;
          assert.ok(left >= width * 0.3 - 0.001);
          assert.ok(left + r.width * fit.width <= width + 0.001);
          assert.ok((slot.front.y + slot.front.height) * fit.height + 24 <= height + 0.001);
          assert.ok(
            row.books.reduce((sum, b) => sum + b.width, 0) +
              Math.max(0, row.books.length - 1) * 2 <=
              r.width * fit.width + 0.001,
          );
        }
    }
});
test('identical books keep their height across differently tall green cavities', () => {
  const s = createInitialState();
  s.settings.room = 'green-library';
  s.shelves = Array.from({ length: 5 }, (_, i) => ({
    id: 's' + i,
    name: 'Gatunek ' + i,
    order: i,
  }));
  s.books = s.shelves.map((shelf, i) => ({
    id: String(i),
    title: 'Solaris',
    authors: ['Lem'],
    shelfId: shelf.id,
    order: 0,
    pageCount: 240,
  }));
  const items = buildPages(s, { width: 1672, height: 941 }).flatMap((p) =>
    p.rows.flatMap((r) => r.books),
  );
  assert.equal(items.length, 5);
  assert.equal(items[0].height, items[4].height);
  assert.ok(
    items.every((b) => b.height < 118),
    'green books must be substantially shorter than the previous ~168px',
  );
});
test('room scale affects both dimensions while preserving fit and the whole collection', () => {
  for (const scene of rooms.ROOM_SCENES)
    for (const scale of [0.6, 1.4]) {
      const s = fixture();
      s.settings.room = scene.id;
      s.settings.bookScales = { [scene.id]: scale };
      const pages = buildPages(s, { width: 1366, height: 768 }),
        fit = fitScene(scene, { width: 1366, height: 768, iconSpace: 0.2 });
      assert.equal(pages.flatMap((p) => p.rows.flatMap((r) => r.books)).length, 100);
      for (const row of pages.flatMap((p) => p.rows)) {
        assert.ok(
          row.books.every((b) => b.height <= row.bounds.height * fit.height && b.width >= 14),
        );
        assert.ok(
          row.books.reduce((n, b) => n + b.width, 0) + Math.max(0, row.books.length - 1) * 2 <=
            row.bounds.width * fit.width + 0.001,
        );
      }
    }
  const s = fixture();
  s.settings.room = 'green-library';
  const h = buildPages(s, { width: 1920, height: 1080 })[0].rows[0].books[0].height;
  s.settings.bookScales = { 'green-library': 0.6, 'oak-library': 1.4 };
  assert.ok(
    Math.abs(buildPages(s, { width: 1920, height: 1080 })[0].rows[0].books[0].height - h * 0.6) <
      0.00001,
  );
});
test('shared sorting is applied within wallpaper genres despite legacy grouping', () => {
  const s = createInitialState();
  s.books = [
    {
      id: 'a',
      title: 'Zima',
      authors: ['Autor'],
      shelfId: 'fantasy',
      status: 'read',
      order: 0,
      readDate: null,
    },
    {
      id: 'b',
      title: 'Lato',
      authors: ['Autor'],
      shelfId: 'fantasy',
      status: 'read',
      order: 1,
      readDate: '2026-10-05',
    },
  ];
  s.settings.sort = 'title-asc';
  assert.deepEqual(
    buildPages(s, { width: 1920, height: 1080 })[0].rows[0].books.map((x) => x.book.id),
    ['b', 'a'],
  );
  s.settings.grouping = 'status';
  s.settings.sort = 'read-oldest';
  assert.deepEqual(
    buildPages(s, { width: 1920, height: 1080 })[0].rows[0].books.map((x) => x.book.id),
    ['b', 'a'],
  );
});
