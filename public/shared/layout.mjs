import { makeSpine } from './spines.mjs';
import { getRoomScene, fitScene } from './room-scene.mjs';
import { sortBooks } from './book-order.mjs';
import { buildCustomPages } from './custom-layout.mjs';
import { buildAnnualPages } from './annual-reading.mjs';
import { t } from './i18n.mjs';
// State snapshots are immutable between revisions. Keep one plan per consumer so
// page changes and the lighting clock never traverse the whole collection again.
export function createPagePlanner() {
  let previous;
  return (state, { width, height, scene = getRoomScene(state.settings.room) }) => {
    const settings = state.settings,
      key = JSON.stringify([
        state.collectionId,
        state.revision,
        width,
        height,
        scene.id,
        scene.annual,
        scene.aspectRatio,
        scene.bookHeight,
        scene.slots,
        settings.iconSpace,
        settings.grouping,
        settings.readingYear,
        settings.sort,
        settings.bookScales?.[scene.id] ?? 1,
        settings.roomLayouts?.[scene.id] ?? null,
      ]);
    if (previous?.state === state && previous.key === key) return previous.pages;
    const pages = buildPages(state, { width, height, scene });
    previous = { state, key, pages };
    return pages;
  };
}
export function buildPages(state, { width, height, scene = getRoomScene(state.settings.room) }) {
  const annual = state.settings.grouping === 'months' && scene.annual === true;
  const fit = fitScene(scene, { width, height, iconSpace: state.settings.iconSpace });
  const slots = scene.slots.flatMap((slot) => {
    const r = slot.books,
      left = Math.max(width * state.settings.iconSpace, fit.x + r.x * fit.width),
      right = Math.min(width, fit.x + (r.x + r.width) * fit.width);
    // A cropped cavity can use its visible width; vertically cut shelves cannot.
    if (
      right - left < 24 ||
      r.height * fit.height < 48 ||
      fit.y + r.y * fit.height < 0 ||
      fit.y + (slot.front.y + slot.front.height) * fit.height + 24 > height
    )
      return [];
    return [
      {
        ...slot,
        books: { ...r, x: (left - fit.x) / fit.width, width: (right - left) / fit.width },
      },
    ];
  });
  if (!slots.length || (annual && (scene.slots.length !== 12 || slots.length !== 12)))
    throw Object.assign(new Error(t('Powiększ podgląd, aby zobaczyć książki.')), {
      code: 'VIEWPORT_TOO_SMALL',
    });
  const rows = [];
  const nextRow = (group, part) => ({
    slotId: slots[rows.length % slots.length].id,
    bounds: slots[rows.length % slots.length].books,
    key: group.id + '-' + part,
    label: group.name + (part ? ' · ' + (part + 1) : ''),
    books: [],
  });
  const spineProperties = new WeakMap(),
    dimensions = new WeakMap(),
    scale = state.settings.bookScales?.[scene.id] ?? 1;
  const size = (book, slot) => {
    let bySlot = dimensions.get(book);
    if (bySlot?.has(slot.id)) return bySlot.get(slot.id);
    let art = spineProperties.get(book);
    if (!art) {
      art = makeSpine(book);
      spineProperties.set(book, art);
    }
    const h = Math.min(
        (scene.bookHeight / 941) * fit.height * scale * (0.92 + art.spineStyle * 0.016),
        slot.books.height * fit.height * 0.96,
      ),
      result = {
        height: h,
        width: Math.min(slot.books.width * fit.width, Math.max(14, (art.width * h) / 260)),
      };
    if (!bySlot) {
      bySlot = new Map();
      dimensions.set(book, bySlot);
    }
    bySlot.set(slot.id, result);
    return result;
  };
  if (annual) return buildAnnualPages(state, { slots, size, fit });
  if (state.settings.roomLayouts?.[scene.id]?.enabled)
    return buildCustomPages(state, { scene, slots, size, fit });
  const groupBooks = new Map(),
    field = 'shelfId';
  for (const book of state.books) {
    const id = book[field];
    if (!groupBooks.has(id)) groupBooks.set(id, []);
    groupBooks.get(id).push(book);
  }
  const groupDefinitions = state.shelves.toSorted((a, b) => a.order - b.order);
  const groups = groupDefinitions
    .filter((group) => groupBooks.has(group.id))
    .map((group) => ({
      ...group,
      books: sortBooks(groupBooks.get(group.id) ?? [], state.settings.sort),
    }));
  for (const group of groups) {
    let part = 0,
      row = nextRow(group, part),
      used = 0;
    for (const b of group.books) {
      let slot = slots[rows.length % slots.length],
        dimensions = size(b, slot),
        available = slot.books.width * fit.width;
      if (row.books.length && used + 2 + dimensions.width > available) {
        rows.push(row);
        row = nextRow(group, ++part);
        used = 0;
        slot = slots[rows.length % slots.length];
        dimensions = size(b, slot);
      }
      row.books.push({ book: b, ...dimensions });
      used += dimensions.width + (row.books.length > 1 ? 2 : 0);
    }
    rows.push(row);
  }
  if (!rows.length) rows.push(nextRow({ id: 'empty', name: t('Twoja biblioteczka') }, 0));
  const pages = [];
  for (let i = 0; i < rows.length; i += slots.length)
    pages.push({ rows: rows.slice(i, i + slots.length) });
  return pages;
}
