import { formatReadDate } from './calendar-date.mjs';
import { t } from './i18n.mjs';
export function readingDateLabel(book) {
  const date = formatReadDate(book.readDate);
  if (!date) return null;
  return t('Przeczytano: ') + date;
}
