import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { importDom } from './helpers/import-dom.mjs';
import { validateBookForm } from '../public/manager/forms.mjs';
import { makeSpine } from '../public/shared/spines.mjs';
const module = await import('../public/manager/cover-editor.mjs').catch(() => ({}));
function setup({
  palette = async () => ['#123456'],
  request = async (route) =>
    route === '/api/cover-search'
      ? {
          searchId: 's',
          automaticId: 'c',
          candidates: [{ id: 'c', match: 'edition', previewUrl: '/api/cover-search/s/c' }],
        }
      : { coverId: 'new', source: 'openlibrary' },
} = {}) {
  assert.equal(typeof module.createEditorCoverPicker, 'function');
  const { root, doc } = importDom();
  root.ownerDocument = doc;
  let context = {
      identity: 'a',
      coverId: null,
      book: {
        title: 'Reacher',
        authors: ['Lee Child'],
        isbn: '9780593440643',
        providerId: null,
        catalogCoverId: null,
      },
    },
    applied = [];
  const picker = module.createEditorCoverPicker(root, {
    request,
    getContext: () => context,
    localPalette: palette,
    applyCover: (saved, colors) => {
      applied.push({ saved, colors });
      context = { ...context, coverId: saved.coverId };
    },
    setBusy() {},
    onError() {},
  });
  return { picker, applied, set: (v) => (context = v), get: () => context };
}
test('editor cover selection derives palette and changes only the graphic draft', async () => {
  const f = setup(),
    before = structuredClone(f.get().book);
  await f.picker.search({ automatic: true });
  assert.equal(f.applied.length, 1);
  assert.deepEqual(f.applied[0].colors, ['#123456']);
  assert.equal(f.get().coverId, 'new');
  assert.deepEqual(f.get().book, before);
});
test('late palette work cannot undo a manual cover, identity edit or closed editor', async () => {
  for (const change of [
    (f) => f.set({ ...f.get(), coverId: 'manual' }),
    (f) => f.set({ ...f.get(), book: { ...f.get().book, title: 'Other' } }),
    (f) => f.set(null),
  ]) {
    let release, started;
    const begun = new Promise((r) => (started = r));
    const f = setup({
      palette: () => {
        started();
        return new Promise((r) => (release = r));
      },
    });
    const pending = f.picker.search({ automatic: true });
    await begun;
    change(f);
    release(['#123456']);
    await pending;
    assert.equal(f.applied.length, 0);
  }
});
test('submitting a book cancels discovery before the pending save response returns', async () => {
  let releaseSearch, finishSave;
  const f = setup({
    request: (route) =>
      route === '/api/cover-search'
        ? new Promise((r) => (releaseSearch = r))
        : Promise.resolve({ coverId: 'late' }),
  });
  const searching = f.picker.search({ automatic: true });
  const fields = new Map(),
    $ = (id) => {
      if (!fields.has(id))
        fields.set(id, {
          value:
            {
              title: 'Reacher',
              authors: 'Lee Child',
              isbn: '9780593440643',
              shelf: 'fantasy',
              'spine-color': '#123456',
            }[id] ?? '',
          disabled: false,
          hidden: true,
        });
      return fields.get(id);
    };
  const c = vm.createContext({
    $,
    coverPicker: f.picker,
    uploading: false,
    bookSubjects: [],
    coverId: null,
    palette: [],
    provider: null,
    providerId: null,
    currentSpineStyle: 0,
    makeSpine,
    validateBookForm,
    editing: null,
    editorRevision: 1,
    editorSession: 'a',
    editorSnapshot: null,
    command: () => new Promise((r) => (finishSave = r)),
    draftGuard: { saved() {} },
    editorFields: () => ({}),
    closeEditor() {},
    notice() {},
  });
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  vm.runInContext(
    source.slice(source.indexOf("$('book-form').onsubmit ="), source.indexOf('\ntry {\n  const info =')),
    c,
  );
  const saving = $('book-form').onsubmit({ preventDefault() {} });
  try {
    assert.equal(typeof finishSave, 'function');
    releaseSearch({
      searchId: 's',
      automaticId: 'c',
      candidates: [{ id: 'c', match: 'edition', previewUrl: '/api/cover-search/s/c' }],
    });
    await searching;
    assert.equal(f.applied.length, 0);
  } finally {
    finishSave?.();
    await saving;
  }
});
