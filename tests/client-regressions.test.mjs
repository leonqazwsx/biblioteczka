import { createRevisionFeed } from '../public/manager/revision-feed.mjs';
import { topLevelStatement } from './helpers/source.mjs';
function clientContext(globals) {
  const context = vm.createContext({
    coverPicker: null,
    catalogImageId: null,
    connectionSession: null,
    editorSession: null,
    coverUrlImport: { cancel() {}, reset() {}, setDisabled() {} },
    spineControls: {},
    cancelSpineImageImport() {},
    updateSpineControls() {},
    frameEditor: {
      reset() {},
      patch() {
        return null;
      },
    },
    ...globals,
  });
  context.revisionFeed = createRevisionFeed({
    getState: () => context.state,
    onRefresh: () => context.refresh?.(),
  });
  return context;
}
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { applyCommand, createInitialState } from '../src/domain.mjs';
import { makeSpine } from '../public/shared/spines.mjs';
import { validateBookForm } from '../public/manager/forms.mjs';
import { catalogDraft } from '../public/manager/catalog-selection.mjs';
import { CATEGORY_PRESETS } from '../public/shared/categories.mjs';
import { resolveCategoryChoice } from '../public/manager/editor-category.mjs';
import { createDraftGuard } from '../public/manager/draft-guard.mjs';
test('typing a new query cancels the previous edition selection before it can populate the form', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const fields = new Map();
  const $ = (id) => {
    if (!fields.has(id))
      fields.set(id, {
        value: 'Prus',
        hidden: false,
        disabled: false,
        focus() {},
        addEventListener(_, fn) {
          this.input = fn;
        },
      });
    return fields.get(id);
  };
  let resolve,
    populations = 0;
  const context = clientContext({
    $,
    layoutPanel: null,
    operation: 1,
    uploading: false,
    suggestions: { cancel() {}, input() {} },
    catalogDraft,
    request: () => new Promise((r) => (resolve = r)),
    populate: () => populations++,
  });
  const helper = source.includes('function cancelEditorWork()')
    ? source.slice(
        source.indexOf('function cancelEditorWork()'),
        source.indexOf('\nfunction closeEditor'),
      )
    : '';
  const choose = source.slice(
    source.indexOf('async function chooseCatalogBook('),
    source.indexOf('\nfunction showSuggestions'),
  );
  const input = source.slice(
    source.indexOf("$('query').addEventListener('input'"),
    source.indexOf("\n$('search-form').onsubmit ="),
  );
  vm.runInContext(helper + choose + input, context);
  const selected = vm.runInContext(
    "chooseCatalogBook({title:'Solaris',authors:['Lem'],editionId:'/books/OL1M'})",
    context,
  );
  $('query').input();
  resolve(null);
  await selected;
  assert.equal(populations, 0);
});
test('switching to manual entry during edition loading enables saving again', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const fields = new Map();
  const $ = (id) => {
    if (!fields.has(id))
      fields.set(id, { hidden: false, disabled: id === 'save-book', focus() {} });
    return fields.get(id);
  };
  const context = clientContext({
    $,
    layoutPanel: null,
    operation: 2,
    uploading: true,
    suggestions: { cancel() {} },
  });
  const helper = source.includes('function cancelEditorWork()')
    ? source.slice(
        source.indexOf('function cancelEditorWork()'),
        source.indexOf('\nfunction closeEditor'),
      )
    : '';
  const handler = source.slice(
    source.indexOf("$('manual-button').onclick ="),
    source.indexOf("document.addEventListener('keydown'"),
  );
  vm.runInContext(helper + handler, context);
  $('manual-button').onclick();
  assert.equal($('save-book').disabled, false);
  assert.equal(context.uploading, false);
  assert.equal($('search-area').hidden, true);
  assert.ok(context.operation > 2);
});
test('an obsolete cover upload cannot clear the busy state or show errors in a new editor', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const fields = new Map();
  const $ = (id) => {
    if (!fields.has(id))
      fields.set(id, {
        hidden: true,
        disabled: false,
        files: [{ type: 'image/jpeg' }],
        value: '',
        textContent: '',
      });
    return fields.get(id);
  };
  let reject;
  const context = clientContext({
    $,
    layoutPanel: null,
    operation: 3,
    uploading: false,
    suggestions: { cancel() {} },
    readCoverFile: () => new Promise((_, r) => (reject = r)),
  });
  const start = source.indexOf('function beginCoverImport(');
  const end = source.indexOf('\nconst coverUrlRoot =', start);
  vm.runInContext(source.slice(start, end), context);
  const upload = $('cover-file').onchange();
  context.operation++;
  context.uploading = true;
  $('save-book').disabled = true;
  reject(new Error('Old upload failed'));
  await upload;
  assert.equal($('save-book').disabled, true);
  assert.equal(context.uploading, true);
  assert.equal($('form-error').hidden, true);
});
test('wallpaper renders the queued latest revision and clears the connection warning', async () => {
  const source = await fs.readFile(new URL('../public/wallpaper/app.mjs', import.meta.url), 'utf8');
  const refresh = source.slice(
    source.indexOf('async function refresh()'),
    source.indexOf('\ndocument.querySelector', source.indexOf('async function refresh()')),
  );
  let resolveFirst,
    calls = 0;
  const connection = { hidden: false },
    rendered = [];
  const context = clientContext({
    api: {
      state: () =>
        ++calls === 1 ? new Promise((r) => (resolveFirst = r)) : Promise.resolve({ revision: 3 }),
    },
    document: { querySelector: () => connection },
    lightingClock: { sync() {} },
    render: () => rendered.push(vm.runInContext('state.revision', context)),
  });
  vm.runInContext('let state,loading=false,queued=false;' + refresh, context);
  const first = vm.runInContext('refresh()', context);
  await vm.runInContext('refresh()', context);
  resolveFirst({ revision: 2 });
  await first;
  assert.equal(calls, 2);
  assert.equal(vm.runInContext('state.revision', context), 3);
  assert.deepEqual(rendered, [2, 3]);
  assert.equal(connection.hidden, true);
});
test('editor does not silently overwrite another panel after SSE updates revision', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const fields = new Map();
  const $ = (id) => {
    if (!fields.has(id))
      fields.set(id, {
        value: '',
        hidden: true,
        disabled: false,
        textContent: '',
        append() {},
        replaceChildren() {},
        focus() {},
      });
    return fields.get(id);
  };
  let saved = applyCommand(createInitialState(), {
      type: 'addBook',
      draft: { title: 'Before', authors: ['Author'], shelfId: 'fantasy', status: 'to-read' },
    }),
    local = structuredClone(saved);
  const context = clientContext({
    $,
    layoutPanel: null,
    state: local,
    makeSpine,
    categoryNote: { textContent: '' },
    editing: null,
    coverId: null,
    palette: [],
    provider: null,
    providerId: null,
    shelfFilter: null,
    editorRevision: local.revision,
    reloadLatest: { hidden: true },
    uploading: false,
    validateBookForm,
    CATEGORY_PRESETS,
    resolveCategoryChoice,
    draftGuard: createDraftGuard(),
    editorFields: () => ({ readDate: $('read-date').value }),
    el: () => ({
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
      },
    }),
    updateCover() {},
    render() {},
    closeEditor() {},
    notice() {},
    refresh: async () => {
      context.state = structuredClone(saved);
    },
    api: {
      command: async (cmd, rev) => {
        if (rev !== saved.revision)
          throw Object.assign(new Error('conflict'), { code: 'CONFLICT' });
        saved = applyCommand(saved, cmd);
        return structuredClone(saved);
      },
    },
  });
  const populate = source.slice(
    source.indexOf('function populate('),
    source.indexOf('\nfunction showEditor'),
  );
  const command = source.slice(
    source.indexOf('async function command('),
    source.indexOf('\nfunction navigate'),
  );
  const submit = source.slice(
    source.indexOf("$('book-form').onsubmit ="),
    source.indexOf('\ntry {\n  const info ='),
  );
  context.updateSpineControls = () => {};
  const snapshot = topLevelStatement(source, 'const bookSnapshot =');
  vm.runInContext(snapshot + populate + command + submit, context);
  vm.runInContext('populate(state.books[0])', context);
  $('read-date').value = '2024-02-29';
  saved = applyCommand(saved, {
    type: 'updateBook',
    id: saved.books[0].id,
    patch: { title: 'Changed in other panel' },
  });
  context.state = structuredClone(saved);
  await $('book-form').onsubmit({ preventDefault() {} });
  assert.equal(saved.books[0].title, 'Changed in other panel');
  assert.equal(saved.books[0].status, 'read');
  assert.equal($('form-error').hidden, false);
  assert.match($('form-error').textContent, /zmieni/i);
});
test('AI-only updates can rebase an open editor but changes to book text preserve conflict detection', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const first = applyCommand(createInitialState(), {
      type: 'addBook',
      draft: { title: 'Solaris', authors: ['Lem'], shelfId: 'other', status: 'read' },
    }),
    id = first.books[0].id;
  let next = structuredClone(first);
  next.revision++;
  next.books[0].spineGeneration++;
  const context = clientContext({
    state: first,
    refreshSequence: 0,
    connectionSession: 'same',
    allowRecoveredRevision: false,
    shelfFilter: null,
    editing: id,
    editorRevision: first.revision,
    $: () => ({ hidden: false }),
    api: { state: async () => next },
    render() {},
    previewColor() {},
    updateSpineControls() {},
  });
  vm.runInContext(
    topLevelStatement(source, 'const bookSnapshot =') +
      'let editorSnapshot=bookSnapshot(state.books[0]);' +
      source.slice(
        source.indexOf('async function refresh()'),
        source.indexOf('\nasync function refreshAi'),
      ),
    context,
  );
  await vm.runInContext('refresh()', context);
  assert.equal(context.editorRevision, next.revision);
  next = structuredClone(next);
  next.revision++;
  next.books[0].title = 'Changed in other panel';
  await vm.runInContext('refresh()', context);
  assert.equal(context.editorRevision, next.revision - 1);
});
test('Escape in AI confirmation leaves the underlying editor draft open', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8'),
    keydown = topLevelStatement(source, "document.addEventListener('keydown', (e) =>");
  let handler,
    closed = 0,
    modal = true;
  const document = {
    addEventListener(_, fn) {
      handler = fn;
    },
    querySelector: () => (modal ? {} : null),
  };
  vm.runInNewContext(keydown, { document, closeEditor: () => closed++ });
  handler({ key: 'Escape' });
  assert.equal(closed, 0);
  modal = false;
  handler({ key: 'Escape' });
  assert.equal(closed, 1);
});
test('wallpaper tooltip shows a completion date without inventing one for legacy books', async () => {
  const source = await fs.readFile(new URL('../public/wallpaper/app.mjs', import.meta.url), 'utf8'),
    dates = await import('../public/shared/reading-date.mjs');
  const tooltip = {
    textContent: '',
    hidden: true,
    style: {},
    getBoundingClientRect: () => ({ width: 200, height: 80 }),
  };
  const context = clientContext({
    tooltip,
    motion: { isActive: () => false },
    hideTooltip: () => {
      tooltip.hidden = true;
    },
    innerWidth: 1920,
    innerHeight: 1080,
    readingDateLabel: dates.readingDateLabel,
    STATUS_LABELS: { read: 'Przeczytane', reading: 'Czytam' },
  });
  vm.runInContext(
    source.slice(source.indexOf('function showTooltip('), source.indexOf('\nfunction details(')),
    context,
  );
  const book = { title: 'Solaris', authors: ['Lem'], status: 'read', readDate: '2026-10-04' };
  context.book = book;
  vm.runInContext('showTooltip(book,{clientX:1900,clientY:1060})', context);
  assert.match(tooltip.textContent, /Przeczytano: 04\.10\.2026/);
  assert.match(tooltip.textContent, /Solaris/);
  assert.equal(tooltip.style.left, '1712px');
  assert.equal(tooltip.style.top, '992px');
  book.status = 'reading';
  vm.runInContext('showTooltip(book,{clientX:10,clientY:10})', context);
  assert.match(tooltip.textContent, /Przeczytano: 04\.10\.2026/);
  assert.doesNotMatch(tooltip.textContent, /Czytam|Do przeczytania/);
  delete book.readDate;
  vm.runInContext('showTooltip(book,{clientX:10,clientY:10})', context);
  assert.doesNotMatch(tooltip.textContent, /Przeczytano:|Ostatnio przeczytana:/);
  context.motion.isActive = () => true;
  tooltip.hidden = false;
  vm.runInContext('showTooltip(book,{clientX:10,clientY:10})', context);
  assert.equal(tooltip.hidden, true);
});
test('editor loads and saves the chosen completion date', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
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
  let saved = applyCommand(createInitialState(), {
    type: 'addBook',
    draft: {
      title: 'Solaris',
      authors: ['Lem'],
      shelfId: 'fantasy',
      status: 'read',
      readDate: '2024-02-29',
    },
  });
  const context = clientContext({
    $,
    layoutPanel: null,
    state: saved,
    makeSpine,
    categoryNote: { textContent: '' },
    editing: null,
    coverId: null,
    palette: [],
    provider: null,
    providerId: null,
    shelfFilter: null,
    editorRevision: saved.revision,
    currentSpineStyle: null,
    editorSnapshot: null,
    uploading: false,
    validateBookForm,
    CATEGORY_PRESETS,
    resolveCategoryChoice,
    draftGuard: createDraftGuard(),
    editorFields: () => ({ readDate: $('read-date').value }),
    el: () => ({
      children: [],
      append(...nodes) {
        this.children.push(...nodes);
      },
    }),
    updateCover() {},
    updateSpineControls() {},
    render() {},
    closeEditor() {},
    notice() {},
    api: {
      command: async (cmd, revision) => {
        assert.equal(revision, saved.revision);
        saved = applyCommand(saved, cmd);
        return saved;
      },
    },
  });
  vm.runInContext(
    topLevelStatement(source, 'const bookSnapshot =') +
      source.slice(source.indexOf('function populate('), source.indexOf('\nfunction showEditor')) +
      source.slice(
        source.indexOf('async function command('),
        source.indexOf('\nfunction navigate'),
      ) +
      source.slice(
        source.indexOf("$('book-form').onsubmit ="),
        source.indexOf('\ntry {\n  const info ='),
      ),
    context,
  );
  vm.runInContext('populate(state.books[0])', context);
  assert.equal($('read-date').value, '2024-02-29');
  $('read-date').value = '2026-10-04';
  await $('book-form').onsubmit({ preventDefault() {} });
  assert.equal(saved.books[0].readDate, '2026-10-04');
  assert.equal(saved.books[0].title, 'Solaris');
});

test('panel accepts recovered lower revision only after a confirmed session change', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  let next = { revision: 1, collectionId: 'same', books: [], shelves: [] },
    renders = 0;
  const context = clientContext({
    state: { revision: 2, collectionId: 'same', books: [], shelves: [] },
    editing: null,
    editorSnapshot: null,
    editorRevision: 2,
    refreshSequence: 0,
    connectionSession: 'recovered',
    allowRecoveredRevision: true,
    shelfFilter: null,
    $: () => ({ hidden: true }),
    api: { state: async () => next },
    render() {
      renders++;
    },
    previewColor() {},
    updateSpineControls() {},
  });
  vm.runInContext(
    source.slice(
      source.indexOf('async function refresh()'),
      source.indexOf('\nasync function refreshAi'),
    ),
    context,
  );
  await vm.runInContext('refresh()', context);
  assert.equal(context.state.revision, 1);
  assert.equal(renders, 1);
  context.allowRecoveredRevision = false;
  next = { revision: 0, collectionId: 'same', books: [], shelves: [] };
  await vm.runInContext('refresh()', context);
  assert.equal(context.state.revision, 1);
  assert.equal(renders, 1);
});

test('same-session equal revision refresh does not rebuild the visible collection', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  const saved = { revision: 4, collectionId: 'same', books: [], shelves: [] };
  let renders = 0;
  const context = clientContext({
    state: saved,
    refreshSequence: 0,
    connectionSession: 'same',
    allowRecoveredRevision: false,
    shelfFilter: null,
    editing: null,
    api: { state: async () => structuredClone(saved) },
    $: () => ({ hidden: true }),
    render() {
      renders++;
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf('async function refresh()'),
      source.indexOf('\nasync function refreshAi'),
    ),
    context,
  );
  await vm.runInContext('refresh()', context);
  assert.equal(renders, 0);
  context.allowRecoveredRevision = true;
  await vm.runInContext('refresh()', context);
  assert.equal(renders, 1);
});
test('a delayed accepted command response cannot replace a newer SSE state', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  let reply,
    renders = 0;
  const context = clientContext({
    state: { revision: 1, collectionId: 'same' },
    layoutPanel: null,
    api: { command: () => new Promise((resolve) => (reply = resolve)) },
    render() {
      renders++;
    },
  });
  vm.runInContext(
    source.slice(source.indexOf('async function command('), source.indexOf('\nfunction navigate')),
    context,
  );
  const pending = vm.runInContext("command({type:'updateSettings',patch:{theme:'dark'}})", context);
  context.state = { revision: 3, collectionId: 'same', settings: { theme: 'light' } };
  reply({ revision: 2, collectionId: 'same', settings: { theme: 'dark' } });
  await pending;
  assert.equal(context.state.revision, 3);
  assert.equal(context.state.settings.theme, 'light');
  assert.equal(renders, 0);
});

test('a response from a previous server session cannot overwrite recovered state', async () => {
  const source = await fs.readFile(new URL('../public/manager/app.mjs', import.meta.url), 'utf8');
  let reply,
    renders = 0;
  const context = clientContext({
    state: { revision: 9, collectionId: 'same' },
    layoutPanel: null,
    refresh: async () => {},
    api: { command: () => new Promise((resolve) => (reply = resolve)) },
    render() {
      renders++;
    },
  });
  vm.runInContext(
    source.slice(source.indexOf('async function command('), source.indexOf('\nfunction navigate')),
    context,
  );
  const pending = vm.runInContext("command({type:'updateSettings',patch:{theme:'dark'}})", context);
  context.revisionFeed.sessionChanged();
  context.state = { revision: 1, collectionId: 'same', settings: { theme: 'light' } };
  reply({ revision: 10, collectionId: 'same', settings: { theme: 'dark' } });
  await assert.rejects(pending, (error) => error.code === 'CONFLICT');
  assert.equal(context.state.revision, 1);
  assert.equal(context.state.settings.theme, 'light');
  assert.equal(renders, 0);
});
