import { cleanSubjects } from '../shared/categories.mjs';
export function catalogDraft(item, edition) {
  const draft = { ...item };
  for (const [key, value] of Object.entries(edition ?? {}))
    if (value != null && value !== '' && (!Array.isArray(value) || value.length))
      draft[key] = value;
  return {
    ...draft,
    isbn: item.provider === 'bn' ? (item.isbn ?? draft.isbn) : draft.isbn,
    subjects: cleanSubjects([...cleanSubjects(item.subjects), ...cleanSubjects(edition?.subjects)]),
    id: undefined,
    coverId: null,
    publicationYear:
      edition?.publicationYear ??
      (item.provider === 'bn' || item.id?.startsWith('/books/')
        ? (item.publicationYear ?? null)
        : null),
    provider: item.provider ?? 'openlibrary',
    providerId: edition?.editionId ?? item.editionId ?? null,
  };
}
