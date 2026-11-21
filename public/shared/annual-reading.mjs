import { normalizeReadDate } from './calendar-date.mjs';
import { sortBooks } from './book-order.mjs';

const monthNames = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];
function calendarParts(value) {
  try {
    const date = normalizeReadDate(value);
    return date ? date.split('-').map(Number) : null;
  } catch {
    return null;
  }
}

export function summarizeReadingYear(books, year) {
  const summary = { year, total: 0, undated: 0, otherYears: 0, months: Array(12).fill(0) };
  for (const book of books) {
    const date = calendarParts(book.readDate);
    if (!date) summary.undated++;
    else if (date[0] !== year) summary.otherYears++;
    else {
      summary.total++;
      summary.months[date[1] - 1]++;
    }
  }
  return summary;
}

export function buildAnnualPages(state, { slots, size, fit }) {
  const year =
    state.settings.readingYear === undefined
      ? new Date().getFullYear()
      : state.settings.readingYear;
  const months = Array.from({ length: 12 }, () => []),
    pages = [];
  for (const book of state.books) {
    const date = calendarParts(book.readDate);
    if (date && date[0] === year) months[date[1] - 1].push(book);
  }
  function page(index) {
    while (pages.length <= index)
      pages.push({
        rows: slots.map((slot, month) => ({
          slotId: slot.id,
          bounds: slot.books,
          key: `month-${month + 1}-${pages.length}`,
          label: monthNames[month],
          books: [],
        })),
      });
    return pages[index];
  }
  page(0);
  for (const [month, books] of months.entries()) {
    const slot = slots[month],
      available = slot.books.width * fit.width;
    let index = 0,
      used = 0,
      row = page(index).rows[month];
    for (const book of sortBooks(books, state.settings.sort)) {
      const dimensions = size(book, slot),
        gap = row.books.length ? 2 : 0;
      if (row.books.length && used + gap + dimensions.width > available + 0.001) {
        row = page(++index).rows[month];
        used = 0;
      }
      used += dimensions.width + (row.books.length ? 2 : 0);
      row.books.push({ book, ...dimensions });
    }
  }
  return pages;
}
