import test from 'node:test';
import { t } from '../public/shared/i18n.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { catalogDraft } from '../public/manager/catalog-selection.mjs';
const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8'),
  choose = source.slice(
    source.indexOf('async function chooseCatalogBook('),
    source.indexOf('\nfunction showSuggestions'),
  );
const book = {
  provider: 'bn',
  editionId: 'bn:123',
  title: 'Fantastyczny pan Lis',
  authors: ['Roald Dahl'],
  isbn: '9780140328721',
  coverId: null,
};
function editor() {
  const fields = new Map(),
    $ = (id) => {
      if (!fields.has(id))
        fields.set(id, { value: '', disabled: false, hidden: false, textContent: '', focus() {} });
      return fields.get(id);
    },
    searches = [];
  const c = vm.createContext({
    t,
    $,
    operation: 0,
    uploading: false,
    coverId: null,
    palette: [],
    shelfTouched: false,
    catalogImageId: null,
    suggestions: { cancel() {} },
    catalogDraft,
    request: async () => null,
    coverPicker: {
      cancel() {},
      reset() {},
      search(options) {
        searches.push({ options, draft: c.draft, catalogImageId: c.catalogImageId });
        return new Promise(() => {});
      },
    },
    populate(draft) {
      c.draft = draft;
      $('isbn').value = draft.isbn ?? '';
      c.coverId = null;
    },
  });
  vm.runInContext(choose, c);
  return { c, $, searches };
}
test('catalog selection starts exact cover discovery without blocking book saving', async () => {
  const { c, $, searches } = editor();
  await c.chooseCatalogBook(book);
  assert.equal(searches.length, 1);
  assert.equal(searches[0].options.automatic, true);
  assert.equal(searches[0].draft.isbn, book.isbn);
  assert.equal(searches[0].draft.providerId, 'bn:123');
  assert.equal($('save-book').disabled, false);
  assert.equal(c.uploading, false);
});
test('the selected remote cover ID reaches discovery without becoming a saved cover ID', async () => {
  const { c, searches } = editor();
  await c.chooseCatalogBook({ ...book, coverId: 123 });
  assert.equal(searches[0].catalogImageId, 123);
  assert.equal(c.coverId, null);
  assert.equal(c.draft.coverId, null);
});
test('title and author discovery is also available when a catalogue record has no ISBN', async () => {
  const { c, $, searches } = editor();
  await c.chooseCatalogBook({ ...book, isbn: null });
  assert.equal(searches.length, 1);
  assert.equal(searches[0].draft.title, book.title);
  assert.equal($('save-book').disabled, false);
  assert.match($('cover-note').textContent, /propozycji.*pliku.*linku/);
});
