import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand, validateState } from '../src/domain.mjs';
import { validateBookForm } from '../public/manager/forms.mjs';
import { readRoute, routeHash } from '../public/manager/navigation.mjs';
import { readingDateLabel } from '../public/shared/reading-date.mjs';
import { buildPages } from '../public/shared/layout.mjs';
import { suggestShelf, suggestCategory } from '../public/shared/categories.mjs';
import { createBackup, validateBackup } from '../src/backup.mjs';
import { createGoodreadsImports } from '../src/goodreads-import.mjs';
import { createBookPicker } from '../public/wallpaper/book-picker.mjs';
import { importDom } from './helpers/import-dom.mjs';

function legacy() {
  let state = createInitialState();
  state = applyCommand(state, {
    type: 'addBook',
    draft: {
      title: 'Książka',
      authors: ['Autorka'],
      shelfId: 'fantasy',
      status: 'read',
      readDate: '2024-02-29',
    },
  });
  state.books[0].status = 'reading';
  state.settings.grouping = 'status';
  state.settings.roomLayouts = {
    'green-library': {
      enabled: true,
      cavities: {
        'green-top-left': { source: { kind: 'status', id: 'reading' }, decoration: 'plant' },
      },
      placements: { [state.books[0].id]: { slotId: 'green-top-left', order: 0 } },
    },
  };
  return state;
}
test('legacy collection becomes read-only without losing metadata, dates or manual placements', () => {
  const input = legacy(),
    original = structuredClone(input),
    next = validateState(input);
  assert.equal(next.books[0].status, 'read');
  assert.equal(next.books[0].readDate, '2024-02-29');
  assert.equal(next.books[0].id, input.books[0].id);
  assert.equal(next.collectionId, input.collectionId);
  assert.equal(next.revision, input.revision);
  assert.equal(next.settings.grouping, 'shelves');
  assert.deepEqual(next.settings.roomLayouts['green-library'].cavities['green-top-left'], {
    source: null,
    decoration: null,
  });
  assert.deepEqual(
    next.settings.roomLayouts['green-library'].placements,
    input.settings.roomLayouts['green-library'].placements,
  );
  assert.deepEqual(input, original);
});
test('new books and legacy status updates cannot reintroduce unfinished books or invent completion dates', () => {
  let s = applyCommand(createInitialState(), {
    type: 'addBook',
    draft: {
      title: 'Bez daty',
      authors: ['Autor'],
      shelfId: 'fantasy',
      status: 'to-read',
      readDate: null,
    },
  });
  assert.equal(s.books[0].status, 'read');
  assert.equal(s.books[0].readDate, null);
  s = applyCommand(s, { type: 'updateBook', id: s.books[0].id, patch: { status: 'reading' } });
  assert.equal(s.books[0].status, 'read');
  assert.equal(s.books[0].readDate, null);
  assert.throws(
    () => applyCommand(s, { type: 'updateBook', id: s.books[0].id, patch: { status: 'unknown' } }),
    { code: 'INVALID' },
  );
});
test('book form defaults to completed reading, including legacy draft inputs', () => {
  for (const status of [undefined, 'to-read', 'reading', 'read'])
    assert.equal(
      validateBookForm({ title: 'Tytuł', authors: 'Autor', shelfId: 'fantasy', status }).status,
      'read',
    );
});
test('old status URLs open the complete collection instead of silently hiding books', () => {
  assert.equal(readRoute('#books?status=to-read').status, '');
  assert.equal(routeHash({ view: 'books', status: 'reading' }), '#books');
});
test('backup imports preserve every legacy book while clearing removed presentation features', async () => {
  const input = legacy(),
    copy = await createBackup(input, null, null),
    next = validateBackup(copy).state;
  assert.equal(next.books.length, 1);
  assert.equal(next.books[0].status, 'read');
  assert.equal(next.books[0].readDate, '2024-02-29');
  assert.equal(
    next.settings.roomLayouts['green-library'].cavities['green-top-left'].decoration,
    null,
  );
});
test('wallpaper uses occupied genre shelves and ignores legacy status grouping', () => {
  const state = legacy();
  state.settings.roomLayouts = {};
  const rows = buildPages(state, { width: 1920, height: 1080 }).flatMap((page) => page.rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].books.length, 1);
  assert.equal(rows[0].label, state.shelves[0].name);
});
test('completion date no longer introduces a reading status label', () => {
  assert.equal(
    readingDateLabel({ status: 'reading', readDate: '2024-02-29' }),
    'Przeczytano: 29.02.2024',
  );
  assert.equal(readingDateLabel({ status: 'to-read', readDate: null }), null);
});
test('specific genres create separate shelves instead of merging fantasy with science fiction or crime with thrillers', () => {
  const shelves = [
    { id: 'fantasy', name: 'Fantasy' },
    { id: 'crime', name: 'Kryminał' },
  ];
  for (const [subjects, want] of [
    [['Science fiction'], 'Science fiction'],
    [['Fantastyka naukowa'], 'Science fiction'],
    [['Fantastyka naukowo-fantastyczna'], 'Science fiction'],
    [['Literatura naukowo-fantastyczna'], 'Science fiction'],
    [['SF'], 'Science fiction'],
    [['Thriller'], 'Thriller'],
    [['Contemporary fiction'], 'Literatura obyczajowa'],
    [['Classics'], 'Klasyka'],
    [['Reportage'], 'Reportaż'],
  ]) {
    assert.equal(suggestCategory(subjects)?.name, want);
    assert.equal(suggestShelf(subjects, shelves).newShelfName, want);
  }
  assert.equal(suggestShelf(['Fantasy'], shelves).shelfId, 'fantasy');
  assert.equal(suggestCategory(['Fantasy', 'Science fiction']), null);
});
test('Goodreads skips unfinished and unknown entries without hiding the later read edition as a duplicate', () => {
  const state = createInitialState(),
    service = createGoodreadsImports({ store: { read: () => state } });
  const preview = service.preview(
    Buffer.from(
      'Title,Author,Book Id,Exclusive Shelf\nTa sama,Autor,1,to-read\nTa sama,Autor,1,read\nW trakcie,Autor,2,currently-reading\nNieznana,Autor,3,unknown\n',
    ),
  );
  assert.deepEqual(
    preview.rows.map((row) => row.selectable),
    [false, true, false, false],
  );
  assert.equal(preview.rows[1].duplicate, null);
  assert.equal(preview.summary.addable, 1);
  assert.equal(preview.summary.skipped, 3);
  assert.ok(preview.rows[0].warnings.some((text) => text.includes('przeczyt')));
});
test('Goodreads cannot override a read item into an unfinished item at confirmation', async () => {
  const state = createInitialState(),
    service = createGoodreadsImports({
      store: {
        read: () => state,
        appendImported: () => {
          throw Error('Must not append');
        },
      },
    });
  const p = service.preview(Buffer.from('Title,Author,Exclusive Shelf\nTytuł,Autor,read\n'));
  await assert.rejects(
    () =>
      service.confirm({
        importId: p.importId,
        expectedRevision: 0,
        selectedRowIds: [p.rows[0].rowId],
        overrides: {
          [p.rows[0].rowId]: { status: 'reading', shelfId: 'other', newShelfName: null },
        },
      }),
    { code: 'INVALID' },
  );
});
test('wallpaper picker lists authors and opens books without reading-status badges', (t) => {
  const { doc, root } = importDom(),
    previous = globalThis.document,
    create = doc.createElement;
  doc.body = root;
  doc.createElement = (tag) => {
    const node = create(tag);
    node.addEventListener = () => {};
    node.showModal = () => (node.open = true);
    node.close = () => (node.open = false);
    return node;
  };
  globalThis.document = doc;
  t.after(() => (globalThis.document = previous));
  let selected;
  const book = { id: 'a', title: 'Tytuł', authors: ['Autorka'], status: 'read' };
  const picker = createBookPicker({ onBook: (book) => (selected = book) });
  picker.update([book]);
  root
    .querySelectorAll('button')
    .find((button) => button.id === 'book-picker-open')
    .onclick();
  const choice = root
    .querySelectorAll('button')
    .find((button) => button.className === 'picker-book');
  assert.equal(choice.children[1].textContent, 'Autorka');
  choice.onclick();
  assert.equal(selected, book);
});
