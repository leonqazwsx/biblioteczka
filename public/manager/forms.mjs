import { normalizeReadDate } from '../shared/calendar-date.mjs';
import { cleanSubjects } from '../shared/categories.mjs';
import { t } from '../shared/i18n.mjs';
function validIsbn(v) {
  if (!/^([0-9]{13}|[0-9]{9}[0-9X])$/.test(v)) return false;
  const sum = [...v].reduce(
    (n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (v.length === 13 ? (i % 2 ? 3 : 1) : 10 - i),
    0,
  );
  return sum % (v.length === 13 ? 10 : 11) === 0;
}
export function validateBookForm(v) {
  const title = v.title?.trim(),
    authors = Array.isArray(v.authors)
      ? v.authors
      : v.authors
          ?.split(';')
          .map((a) => a.trim())
          .filter(Boolean);
  if (!title || title.length > 500) throw new Error(t('Podaj tytuł książki (do 500 znaków).'));
  if (
    !authors?.length ||
    authors.length > 20 ||
    authors.some((a) => typeof a !== 'string' || !a.trim() || a.length > 200)
  )
    throw new Error(t('Podaj autora. Wielu autorów oddziel średnikiem.'));
  const isbn = v.isbn?.replace(/[\s-]/g, '').toUpperCase() || null;
  if (isbn && !validIsbn(isbn)) throw new Error(t('Sprawdź ISBN książki.'));
  const pageCount = v.pageCount == null || v.pageCount === '' ? null : Number(v.pageCount);
  if (
    pageCount !== null &&
    (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 100000)
  )
    throw new Error(t('Liczba stron musi być dodatnią liczbą całkowitą.'));
  if (
    !Array.isArray(v.palette ?? []) ||
    (v.palette ?? []).length > 5 ||
    (v.palette ?? []).some((c) => typeof c !== 'string' || !/^#[\da-fA-F]{6}$/.test(c))
  )
    throw new Error(t('Nieprawidłowy kolor grzbietu.'));
  return {
    title,
    authors,
    isbn,
    pageCount,
    subjects: cleanSubjects(v.subjects),
    shelfId: v.shelfId,
    status: 'read',
    readDate: normalizeReadDate(v.readDate),
    provider: v.provider ?? null,
    providerId: v.providerId ?? null,
    publisher: v.publisher?.trim() || null,
    publicationYear: v.publicationYear?.trim() || null,
    language: v.language?.trim() || null,
    coverId: v.coverId ?? null,
    palette: v.palette ?? [],
    spineStyle: v.spineStyle ?? 0,
  };
}
