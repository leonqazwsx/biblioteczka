export const importState = () => ({
  collectionId: 'collection',
  revision: 7,
  books: [],
  shelves: [
    { id: 'other', name: 'Pozostałe' },
    { id: 'fantasy', name: 'Fantastyka' },
  ],
});
export function importPreview(count = 101) {
  return {
    importId: 'preview',
    collectionId: 'collection',
    revision: 7,
    expiresAt: Date.now() + 600000,
    summary: {
      total: count,
      addable: count,
      duplicates: 0,
      invalid: 0,
      warningRows: 0,
      newShelves: 0,
    },
    notices: [],
    rows: Array.from({ length: count }, (_, i) => ({
      rowId: 'row' + i,
      recordNumber: i + 1,
      display: { title: 'Tytuł ' + i, authors: ['Autor'], status: 'read', readDate: '2024-02-29' },
      candidate: {
        title: 'Tytuł ' + i,
        authors: ['Autor'],
        status: 'read',
        readDate: '2024-02-29',
        shelfId: 'other',
        newShelfName: null,
      },
      category: { shelfId: 'other', newShelfName: null },
      errors: [],
      warnings: [],
      duplicate: null,
      selectable: true,
    })),
  };
}
