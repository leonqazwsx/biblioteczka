import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createDraftGuard } from '../public/manager/draft-guard.mjs';
const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
function editor(confirmResult) {
  const draftGuard = createDraftGuard();
  draftGuard.start({ title: 'Saved' });
  const fields = { editor: { hidden: false }, 'add-book': { focus() {} } },
    context = vm.createContext({
      $: (id) => fields[id],
      draftGuard,
      editorFields: () => ({ title: 'Changed' }),
      confirm: () => confirmResult,
      suggestions: { cancel() {} },
      cancelEditorWork() {},
      document: {
        querySelector() {
          return { inert: true };
        },
      },
      clientUpgrade: { editorClosed() {} },
    });
  const start = source.indexOf('function closeEditor('),
    end = source.indexOf('\nconst categoryNote', start);
  vm.runInContext(source.slice(start, end), context);
  return { fields, context, draftGuard };
}
test('actual close handler keeps a changed book open when discard is rejected', () => {
  const { fields, context } = editor(false);
  vm.runInContext('closeEditor()', context);
  assert.equal(fields.editor.hidden, false);
});
test('actual close handler closes after explicit discard', () => {
  const { fields, context } = editor(true);
  vm.runInContext('closeEditor()', context);
  assert.equal(fields.editor.hidden, true);
});
test('page unload protects a changed book form', () => {
  let handler;
  const draftGuard = createDraftGuard();
  draftGuard.start({ title: 'Saved' });
  const context = vm.createContext({
    addEventListener: (name, fn) => {
      handler = fn;
    },
    layoutPanel: null,
    importPanel: null,
    draftGuard,
    editorFields: () => ({ title: 'Changed' }),
    $: () => ({ hidden: false }),
    detailDirty: () => false,
  });
  const start = source.indexOf("addEventListener('beforeunload'"),
    end = source.indexOf('\nfunction notice', start);
  vm.runInContext(source.slice(start, end), context);
  const event = new Event('beforeunload', { cancelable: true });
  handler(event);
  assert.equal(event.defaultPrevented, true);
});
test('manual spine upload refuses an unsaved cover change before sending an upload', async () => {
  let controls,
    requests = 0;
  const context = vm.createContext({
    state: { revision: 1, books: [{ id: 'b', coverId: 'old' }] },
    editing: 'b',
    coverId: 'new',
    operation: 1,
    aiStatus: {},
    spineControls: {},
    $: () => ({ hidden: false }),
    renderSpineControls: (root, options) => {
      controls = options;
    },
    request: async () => {
      requests++;
    },
    refresh: async () => {},
    refreshAi: async () => {},
  });
  const start = source.indexOf('function updateSpineControls('),
    end = source.indexOf('\nspinePreview.addEventListener', start);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('updateSpineControls()', context);
  await assert.rejects(controls.onUpload('b', { mime: 'image/png', base64: 'dummy' }), /okładki/i);
  assert.equal(requests, 0);
});
