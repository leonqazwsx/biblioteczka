import test from 'node:test';
import { topLevelStatement } from './helpers/source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { createInitialState, applyCommand } from '../src/domain.mjs';
import { createRevisionFeed } from '../public/manager/revision-feed.mjs';
import { createDraftGuard } from '../public/manager/draft-guard.mjs';
import { makeSpine } from '../public/shared/spines.mjs';
import { validateBookForm } from '../public/manager/forms.mjs';
import { CATEGORY_PRESETS } from '../public/shared/categories.mjs';
import { resolveCategoryChoice } from '../public/manager/editor-category.mjs';
import { createGoodreadsImportController } from '../public/manager/goodreads-import-controller.mjs';
import { createRoomLayoutController } from '../public/manager/room-layout-controller.mjs';
import { importDom } from './helpers/import-dom.mjs';
const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
const snapshot = topLevelStatement(source, 'const bookSnapshot =');
const command = source.slice(
  source.indexOf('async function command('),
  source.indexOf('\nfunction navigate'),
);
const refresh = source.slice(
  source.indexOf('async function refresh()'),
  source.indexOf('\nasync function refreshAi'),
);
const importHelper = source.includes('async function requestImport(')
  ? source.slice(
      source.indexOf('async function requestImport('),
      source.indexOf('\nasync function command('),
    )
  : '';
function fixture() {
  let s = applyCommand(createInitialState(), {
    type: 'addBook',
    draft: {
      title: 'Original',
      authors: ['Author'],
      shelfId: 'other',
      status: 'to-read',
      readDate: null,
    },
  });
  return applyCommand(s, { type: 'updateSettings', patch: { theme: 'dark' } });
}
function context(globals) {
  const c = vm.createContext({
    coverPicker: null,
    catalogImageId: null,
    connectionSession: 'old',
    editorSession: 'old',
    coverUrlImport: { reset() {}, setDisabled() {} },
    spineControls: {},
    cancelSpineImageImport() {},
    frameEditor: {
      reset() {},
      patch() {
        return null;
      },
    },
    refreshSequence: 0,
    allowRecoveredRevision: false,
    layoutPanel: null,
    clientUpgrade: { editorClosed() {} },
    notice() {},
    render() {},
    ...globals,
  });
  c.revisionFeed = createRevisionFeed({ getState: () => c.state, onRefresh: () => c.refresh?.() });
  return c;
}
test('editor preserves its draft when recovery reuses the opening revision for a newer book', async () => {
  const fields = new Map(),
    $ = (id) => {
      if (!fields.has(id))
        fields.set(id, {
          value: '',
          hidden: true,
          disabled: false,
          textContent: '',
          append() {},
          replaceChildren() {},
        });
      return fields.get(id);
    };
  let saved = fixture();
  const c = context({
    state: saved,
    $,
    makeSpine,
    categoryNote: { textContent: '' },
    editing: null,
    coverId: null,
    palette: [],
    provider: null,
    providerId: null,
    shelfFilter: null,
    editorRevision: 2,
    currentSpineStyle: null,
    editorSnapshot: null,
    uploading: false,
    validateBookForm,
    CATEGORY_PRESETS,
    resolveCategoryChoice,
    draftGuard: createDraftGuard(),
    editorFields: () => ({ title: $('title').value }),
    el: () => ({
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
      },
    }),
    updateCover() {},
    updateSpineControls() {},
    previewColor() {},
    closeEditor() {},
    reloadLatest: { hidden: true },
    api: {
      state: async () => saved,
      command: async (cmd, rev) => {
        assert.equal(rev, saved.revision);
        saved = applyCommand(saved, cmd);
        return saved;
      },
    },
  });
  vm.runInContext(
    snapshot +
      refresh +
      command +
      source.slice(source.indexOf('function populate('), source.indexOf('\nfunction showEditor')) +
      source.slice(
        source.indexOf("$('book-form').onsubmit ="),
        source.indexOf('\ntry {\n  const info ='),
      ),
    c,
  );
  vm.runInContext('populate(state.books[0])', c);
  $('title').value = 'My unsaved draft';
  saved = structuredClone(saved);
  saved.revision = 1;
  saved.books[0].title = 'Recovered older title';
  c.connectionSession = 'new';
  c.allowRecoveredRevision = true;
  await vm.runInContext('refresh()', c);
  saved = applyCommand(saved, {
    type: 'updateBook',
    id: saved.books[0].id,
    patch: { title: 'Newer accepted title' },
  });
  await vm.runInContext('refresh()', c);
  await $('book-form').onsubmit({ preventDefault() {} });
  assert.equal(saved.books[0].title, 'Newer accepted title');
  assert.equal($('title').value, 'My unsaved draft');
  assert.match($('form-error').textContent, /zmieni|aktual/i);
  assert.equal(c.reloadLatest.hidden, false);
});
test('quick details cannot save over a reused revision from a recovered session', async () => {
  const { doc, root } = importDom();
  globalThis.document = doc;
  const nodes = () => {
    const all = [];
    function visit(n) {
      all.push(n);
      n.children.forEach(visit);
    }
    visit(root);
    return all;
  };
  const el = (tag, cls = '', text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dialog = el('dialog');
  dialog.id = 'book-details';
  dialog.showModal = () => (dialog.open = true);
  dialog.close = () => (dialog.open = false);
  root.append(dialog);
  const $ = (id) => nodes().find((n) => n.id === id),
    button = (text, fn) => {
      const n = el('button', '', text);
      n.onclick = fn;
      return n;
    },
    select = (_, value) => {
      const n = el('select');
      n.value = value;
      return n;
    };
  let saved = fixture();
  const c = context({
    state: saved,
    $,
    el,
    button,
    select,
    labels: { read: 'Przeczytane', 'to-read': 'Do przeczytania' },
    detailsGuard: createDraftGuard(),
    detailBookId: null,
    detailFields: () => ({ readDate: $('detail-date').value }),
    closeBookDetails() {},
    showEditor() {},
    confirm: () => true,
    api: {
      command: async (cmd, rev) => {
        assert.equal(rev, saved.revision);
        saved = applyCommand(saved, cmd);
        return saved;
      },
    },
  });
  c.refresh = async () => {};
  vm.runInContext(
    snapshot +
      command +
      source.slice(
        source.indexOf('function showBookDetails('),
        source.indexOf("\n$('book-details').addEventListener('cancel'"),
      ),
    c,
  );
  vm.runInContext('showBookDetails(state.books[0])', c);
  saved = structuredClone(saved);
  saved.books[0].title = 'Newer accepted title';
  c.state = saved;
  c.connectionSession = 'new';
  $('detail-date').value = '2024-02-29';
  root.querySelector('form').onsubmit({ preventDefault() {} });
  await delay(0);
  assert.equal(saved.books[0].readDate, null);
  assert.equal(dialog.open, true);
  assert.ok(nodes().some((n) => n.getAttribute('role') === 'alert' && !n.hidden));
});
test('layout keeps recovery conflict sticky when revision numbers repeat', async () => {
  const initial = fixture(),
    c = createRoomLayoutController(initial);
  c.setEnabled(true);
  c.setCavity({ source: { kind: 'shelf', id: 'fantasy' } });
  const draft = c.layout;
  const recovered = structuredClone(initial);
  recovered.revision = 1;
  c.receive(recovered, { sessionChanged: true });
  assert.equal(c.stale, true);
  const changed = applyCommand(recovered, {
    type: 'setRoomLayout',
    roomId: c.roomId,
    layout: {
      enabled: true,
      cavities: { [c.selectedSlot]: { source: { kind: 'shelf', id: 'crime' }, decoration: null } },
      placements: {},
    },
  });
  c.receive(changed);
  let writes = 0;
  await assert.rejects(
    c.save(async (cmd) => {
      writes++;
      return applyCommand(changed, cmd);
    }),
    (e) => e.code === 'CONFLICT',
  );
  assert.equal(writes, 0);
  assert.deepEqual(c.layout, draft);
  c.discard();
  assert.equal(c.stale, false);
  assert.equal(c.layout.cavities[c.selectedSlot].source.id, 'crime');
});
test('clean layout adopts a recovered lower revision after confirmed session change', () => {
  const s = fixture(),
    c = createRoomLayoutController(s),
    recovered = structuredClone(s);
  recovered.revision = 1;
  recovered.settings.room = 'green-library';
  c.receive(recovered, { sessionChanged: true });
  assert.equal(c.revision, 1);
  assert.equal(c.roomId, 'green-library');
  assert.equal(c.stale, false);
});
function imports() {
  let reply;
  const initial = fixture(),
    preview = {
      importId: 'preview',
      collectionId: initial.collectionId,
      revision: 2,
      expiresAt: Date.now() + 60000,
      rows: [{ rowId: 'row', selectable: true }],
      summary: { duplicates: 0, invalid: 0 },
    };
  const c = context({
    state: initial,
    request: async (route) =>
      route.endsWith('/preview') ? preview : new Promise((r) => (reply = r)),
    createGoodreadsImportPanel: (opts) => createGoodreadsImportController(opts),
  });
  vm.runInContext(importHelper, c);
  const start = source.indexOf('importPanel ??= createGoodreadsImportPanel('),
    end = source.indexOf(';\n    importPanel.mount', start);
  vm.runInContext(
    'let importPanel;' + source.slice(start, end) + ';globalThis.panel=importPanel;',
    c,
  );
  return { c, preview, reply: (value) => reply(value) };
}
for (const kind of ['recovered', 'newer'])
  test('Goodreads delayed confirmation cannot replace ' + kind + ' state', async () => {
    const { c, reply } = imports();
    c.panel.receive(c.state);
    await c.panel.load('CSV');
    const pending = c.panel.confirm();
    const next = structuredClone(c.state);
    next.revision = kind === 'recovered' ? 1 : 4;
    next.books[0].title = 'Current title';
    c.state = next;
    c.panel.receive(next);
    if (kind === 'recovered') {
      c.connectionSession = 'new';
      c.revisionFeed.sessionChanged();
    }
    const old = structuredClone(next);
    old.revision = 3;
    old.books[0].title = 'Old session imported title';
    reply(old);
    if (kind === 'recovered') await assert.rejects(pending, (e) => e.code === 'CONFLICT');
    else await pending;
    assert.equal(c.state.books[0].title, 'Current title');
    assert.equal(c.state.revision, next.revision);
    if (kind === 'recovered') assert.ok(c.panel.snapshot.preview);
  });
for (const kind of ['recovered', 'newer'])
  test('JSON delayed confirmation cannot replace ' + kind + ' state', async () => {
    let reply, field;
    const c = context({
      state: fixture(),
      el: () => (field = { setAttribute() {}, files: [{ size: 2, text: async () => '{}' }] }),
      confirm: () => true,
      request: async (route) =>
        route.endsWith('/preview')
          ? { importId: 'preview', summary: { books: 1, shelves: 1 } }
          : new Promise((r) => (reply = r)),
    });
    vm.runInContext(importHelper, c);
    const start = source.indexOf(
        "const file = el('input');\n    file.type = 'file';\n    file.accept = '.json",
      ),
      end = source.indexOf(';\n    backup.append', start);
    vm.runInContext(source.slice(start, end) + ';', c);
    const pending = field.onchange();
    await delay(0);
    const next = structuredClone(c.state);
    next.revision = kind === 'recovered' ? 1 : 4;
    next.books[0].title = 'Current title';
    c.state = next;
    if (kind === 'recovered') {
      c.connectionSession = 'new';
      c.revisionFeed.sessionChanged();
    }
    const old = structuredClone(next);
    old.revision = 3;
    old.books[0].title = 'Old import title';
    reply(old);
    await pending;
    assert.equal(c.state.books[0].title, 'Current title');
    assert.equal(c.state.revision, next.revision);
  });

test('an unchanged book can safely rebase its editor baseline after recovery', async () => {
  let saved = fixture();
  const book = saved.books[0],
    c = context({
      state: saved,
      editing: book.id,
      editorSnapshot: null,
      editorRevision: 2,
      shelfFilter: null,
      $: () => ({ hidden: false }),
      previewColor() {},
      updateSpineControls() {},
      api: {
        state: async () => saved,
        command: async (cmd, rev) => {
          assert.equal(rev, saved.revision);
          saved = applyCommand(saved, cmd);
          return saved;
        },
      },
    });
  vm.runInContext(snapshot + refresh + command + 'editorSnapshot=bookSnapshot(state.books[0]);', c);
  saved = structuredClone(saved);
  saved.revision = 1;
  c.connectionSession = 'new';
  c.allowRecoveredRevision = true;
  await vm.runInContext('refresh()', c);
  assert.equal(c.editorSession, 'new');
  assert.equal(c.editorRevision, 1);
  await vm.runInContext(
    "command({type:'updateBook',id:editing,patch:{title:'Safe edit'}},editorRevision,{session:editorSession,book:editorSnapshot})",
    c,
  );
  assert.equal(saved.books[0].title, 'Safe edit');
});
test('intentional JSON import may replace collection identity in the current session', async () => {
  let reply, field;
  const c = context({
    state: fixture(),
    el: () => (field = { setAttribute() {}, files: [{ size: 2, text: async () => '{}' }] }),
    confirm: () => true,
    request: async (route) =>
      route.endsWith('/preview')
        ? { importId: 'preview', summary: { books: 0, shelves: 3 } }
        : new Promise((r) => (reply = r)),
  });
  vm.runInContext(importHelper, c);
  const start = source.indexOf(
      "const file = el('input');\n    file.type = 'file';\n    file.accept = '.json",
    ),
    end = source.indexOf(';\n    backup.append', start);
  vm.runInContext(source.slice(start, end) + ';', c);
  const pending = field.onchange();
  await delay(0);
  const replacement = createInitialState();
  reply(replacement);
  await pending;
  assert.equal(c.state.collectionId, replacement.collectionId);
  assert.equal(c.state.books.length, 0);
});
