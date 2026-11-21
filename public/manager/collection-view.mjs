import { sortBooks } from '../shared/book-order.mjs';

const searchText = (value) =>
  String(value ?? '')
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();

export function collectionView(
  state,
  { shelfId = null, status = '', query = '', page = 0, pageSize = 60 } = {},
) {
  const groups = new Map(),
    shelfNames = new Map(state.shelves.map((s) => [s.id, s.name]));
  for (const book of state.books) {
    if (!groups.has(book.shelfId)) groups.set(book.shelfId, []);
    groups.get(book.shelfId).push(book);
  }
  const terms = searchText(query).split(' ').filter(Boolean);
  const matches = (book) =>
    (!shelfId || book.shelfId === shelfId) &&
    (!terms.length ||
      terms.every((term) =>
        searchText([book.title, ...book.authors, book.isbn ?? ''].join(' ')).includes(term),
      ));
  const positions = new Map();
  let ordered;
  if (state.settings.sort === 'manual') {
    ordered = [];
    for (const shelf of state.shelves.toSorted((a, b) => a.order - b.order)) {
      const siblings = sortBooks(groups.get(shelf.id) ?? [], 'manual');
      siblings.forEach((book, index) => positions.set(book.id, { index, count: siblings.length }));
      ordered.push(...siblings.filter(matches));
    }
  } else ordered = sortBooks(state.books.filter(matches), state.settings.sort);
  const total = ordered.length,
    size = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 120 ? pageSize : 60;
  const pages = Math.max(1, Math.ceil(total / size)),
    current = Math.max(0, Math.min(pages - 1, Number.isSafeInteger(page) ? page : 0));
  return {
    books: ordered.slice(current * size, (current + 1) * size),
    total,
    pages,
    page: current,
    positions,
    shelfNames,
  };
}
