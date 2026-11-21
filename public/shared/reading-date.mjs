import { formatReadDate } from './calendar-date.mjs';
export function readingDateLabel(book) {
  const date = formatReadDate(book.readDate);
  if (!date) return null;
  return 'Przeczytano: ' + date;
}
