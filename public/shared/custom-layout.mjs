import { sortBooks } from './book-order.mjs';
import { t } from './i18n.mjs';
const matches = (book, source) => source?.kind === 'shelf' && book.shelfId === source.id;
export function buildCustomPages(state, { scene, slots, size, fit }) {
  const layout = state.settings.roomLayouts[scene.id],
    pages = [],
    pageRows = [],
    used = new WeakMap(),
    cursors = new Map(),
    bookById = new Map(state.books.map((book) => [book.id, book])),
    slotById = new Map(slots.map((slot) => [slot.id, slot])),
    placed = new Set();
  const sourceName = (source) =>
    source?.kind === 'shelf' ? state.shelves.find((shelf) => shelf.id === source.id)?.name : null;
  function page(index) {
    while (pages.length <= index) {
      const rows = slots.map((slot, i) => {
        const source = layout.cavities[slot.id]?.source,
          row = {
            slotId: slot.id,
            bounds: slot.books,
            key: 'custom-' + slot.id + '-' + pages.length,
            label: sourceName(source) || t('Półka ') + (i + 1),
            books: [],
          };
        used.set(row, 0);
        return row;
      });
      pages.push({ rows });
      pageRows.push(new Map(rows.map((row) => [row.slotId, row])));
    }
    return pageRows[index];
  }
  function place(book, candidates, key) {
    const dimensions = new Map(candidates.map((slot) => [slot.id, size(book, slot)]));
    if (
      !candidates.some((slot) => {
        const d = dimensions.get(slot.id);
        return d.width > 0 && d.height > 0 && d.width <= slot.books.width * fit.width + 0.001;
      })
    )
      throw Object.assign(new Error(t('Powiększ podgląd, aby zobaczyć książki.')), {
        code: 'VIEWPORT_TOO_SMALL',
      });
    let index = cursors.get(key) ?? 0;
    for (; ; index++) {
      const rows = page(index);
      for (const slot of candidates) {
        const row = rows.get(slot.id),
          d = dimensions.get(slot.id),
          fullWidth = slot.books.width * fit.width;
        const capacity = fullWidth,
          gap = row.books.length ? 2 : 0;
        if (used.get(row) + gap + d.width > capacity + 0.001) continue;
        row.books.push({ book, ...d });
        used.set(row, used.get(row) + gap + d.width);
        cursors.set(key, index);
        placed.add(book.id);
        return;
      }
    }
  }
  const manual = Object.entries(layout.placements).toSorted(
    ([a, x], [b, y]) => x.order - y.order || a.localeCompare(b),
  );
  for (const [id, placement] of manual) {
    const book = bookById.get(id),
      slot = slotById.get(placement.slotId);
    if (book && slot) place(book, [slot], 'manual:' + slot.id);
  }
  const automatic = sortBooks(
      state.books.filter((book) => !placed.has(book.id)),
      state.settings.sort,
    ),
    unmatched = [];
  for (const book of automatic) {
    const candidates = slots.filter((slot) => matches(book, layout.cavities[slot.id]?.source));
    if (candidates.length)
      place(book, candidates, 'source:' + candidates.map((slot) => slot.id).join('|'));
    else unmatched.push(book);
  }
  for (const book of unmatched) place(book, slots, 'automatic');
  page(0);
  for (const { rows } of pages)
    for (const [i, row] of rows.entries()) {
      const source = layout.cavities[row.slotId]?.source;
      if (source && row.books.some((item) => !matches(item.book, source)))
        row.label = t('Półka ') + (i + 1);
    }
  return pages;
}
