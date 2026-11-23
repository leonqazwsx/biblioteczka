import { api, request, el } from '../shared/api.mjs';
import { collectionView } from './collection-view.mjs';
import { createRevisionFeed } from './revision-feed.mjs';
import { readRoute, routeHash, SETTINGS_GROUPS } from './navigation.mjs';
import { renderStorageSettings } from './storage-panel.mjs';
import { createDraftGuard } from './draft-guard.mjs';
import { makeSpine } from '../shared/spines.mjs';
import { createSpineElement } from '../shared/spine-art.mjs';
import { fitSpineTitles } from '../shared/spine-title-fit.mjs';
import { createSearchController } from './search.mjs';
import { catalogDraft } from './catalog-selection.mjs';
import { createEditorCoverPicker } from './cover-editor.mjs';
import { renderWindowsSettings } from './windows-settings.mjs';
import { createClientUpgrade } from './client-upgrade.mjs';
import { editorCategory, resolveCategoryChoice } from './editor-category.mjs';
import { CATEGORY_PRESETS } from '../shared/categories.mjs';
import { SORT_OPTIONS, sortBooks } from '../shared/book-order.mjs';
import { formatReadDate, localCalendarDate } from '../shared/calendar-date.mjs';
import { validateBookForm } from './forms.mjs';
import { createBookCard } from './book-card.mjs';
import { readCoverFile, localPalette } from './covers.mjs';
import {
  renderAiSettings,
  renderSpineControls,
  cancelSpineImageImport,
} from './spine-controls.mjs';
import { createImageUrlControl } from './image-url.mjs';
import { createSpineFrameEditor } from './spine-frame-editor.mjs';
import { ROOM_SCENES, DEFAULT_ROOM_ID, getRoomScene } from '../shared/room-scene.mjs';
import { LIGHTING_OPTIONS, roomPresentation } from '../shared/lighting.mjs';
import { watchLighting } from '../shared/lighting-clock.mjs';
import { createRoomLayoutPanel } from './room-layout-panel.mjs';
import { createGoodreadsImportPanel } from './goodreads-import-panel.mjs';
import {
  roomSelectionPatch,
  isMonthlyView,
  readingYearPatch,
  readingYearValue,
} from './annual-settings.mjs';
import { summarizeReadingYear } from '../shared/annual-reading.mjs';
const $ = (id) => document.getElementById(id);
let connectionSession = null,
  refreshSequence = 0,
  allowRecoveredRevision = false;
let collectionQuery = '',
  galleryPage = 0,
  collectionMode = 'gallery',
  settingsGroup = 'appearance',
  navigationReady = false;
const draftGuard = createDraftGuard();
let selectionMode = false;
const selectedBooks = new Set();
let bulkDraft = { shelfId: '', readDate: '' };
let state,
  view = 'books',
  shelfFilter = null,
  statusFilter = '',
  editing = null,
  coverId = null,
  palette = [],
  provider = null,
  providerId = null,
  operation = 0,
  uploading = false,
  editorRevision = 0,
  currentSpineStyle = null,
  bookSubjects = [],
  shelfTouched = false;
let aiStatus = { available: false, enabled: false, connection: 'unconfigured', jobs: [] },
  aiRequest = 0,
  editorSnapshot = null,
  editorSession = null;
const bookSnapshot = (b) =>
  b
    ? JSON.stringify({
        ...Object.fromEntries(
          Object.entries(b).filter(([k]) => !['spine', 'spineGeneration'].includes(k)),
        ),
        spineFrame: b.spine?.frame ?? null,
      })
    : null;
let frameEditor = null;
let coverUrlImport = null;
let coverPicker = null,
  catalogImageId = null;
let layoutPanel = null,
  importPanel = null;
const revisionFeed = createRevisionFeed({
  getState: () => state,
  onRefresh: () => refresh().catch((e) => notice(e.message, true)),
});
const clientUpgrade = createClientUpgrade({
  isEditing: () =>
    !$('editor').hidden || !!layoutPanel?.isDirty() || !!importPanel?.isDirty() || detailDirty(),
  reload: () => location.reload(),
  notice,
});
addEventListener('beforeunload', (event) => {
  if (
    layoutPanel?.isDirty() ||
    importPanel?.isDirty() ||
    (!$('editor').hidden && draftGuard.isDirty(editorFields())) ||
    detailDirty()
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function notice(message, error = false) {
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function button(text, fn, cls = 'secondary') {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = () => Promise.resolve(fn()).catch((e) => notice(e.message, true));
  return b;
}
function select(options, value) {
  const s = el('select');
  for (const [id, label] of options) {
    const o = el('option', '', label);
    o.value = id;
    s.append(o);
  }
  s.value = value;
  return s;
}
function receiveSessionMetadata(info) {
  const changed = connectionSession && info.sessionId && connectionSession !== info.sessionId;
  if (info.sessionId) connectionSession = info.sessionId;
  const banner = $('recovery-notice');
  banner.hidden = !info.recovery || info.recovery === 'none';
  banner.textContent =
    info.recovery === 'backup'
      ? 'Odczytano poprzednią kopię kolekcji. Sprawdź książki przed zapisaniem zmian.'
      : info.recovery === 'unrecoverable'
        ? 'Kolekcja wymaga przywrócenia z kopii. Zapis jest wstrzymany. Otwórz Ustawienia → Kolekcja.'
        : '';
  if (changed) {
    revisionFeed.sessionChanged();
    layoutPanel?.receive(state, { sessionChanged: true });
    allowRecoveredRevision = true;
    refresh().catch((e) => notice(e.message, true));
  }
}
async function refresh() {
  const current = ++refreshSequence,
    session = connectionSession,
    next = await api.state();
  if (current !== refreshSequence || session !== connectionSession) return;
  if (
    state &&
    next.collectionId === state.collectionId &&
    next.revision <= state.revision &&
    !allowRecoveredRevision
  )
    return;
  allowRecoveredRevision = false;
  state = next;
  if (shelfFilter && !state.shelves.some((s) => s.id === shelfFilter)) shelfFilter = null;
  const book = state.books.find((b) => b.id === editing);
  if (editing && bookSnapshot(book) === editorSnapshot) {
    editorRevision = state.revision;
    editorSession = connectionSession;
  }
  render();
  if (!$('editor').hidden) {
    previewColor();
    updateSpineControls();
  }
}

async function refreshAi() {
  const current = ++aiRequest;
  const next = await request('/api/ai/status');
  if (current !== aiRequest) return;
  aiStatus = next;
  const root = $('ai-settings');
  if (root) paintAiSettings(root);
  if (!$('editor').hidden) updateSpineControls();
}
function paintAiSettings(root) {
  renderAiSettings(root, { status: aiStatus });
}
async function requestImport(route, options) {
  if (!route.endsWith('/confirm')) return request(route, options);
  const mutation = revisionFeed.start(),
    collection = state.collectionId;
  try {
    const next = await request(route, options);
    if (!revisionFeed.isCurrent(mutation) || state.collectionId !== collection)
      throw Object.assign(
        new Error(
          'Sesja lub kolekcja zmieniła się podczas importu. Podgląd zachowano. Sprawdź kolekcję i wczytaj plik ponownie.',
        ),
        { code: 'CONFLICT' },
      );
    if (next.collectionId !== state.collectionId || next.revision > state.revision) state = next;
    return state;
  } finally {
    revisionFeed.finish(mutation);
  }
}

async function command(cmd, expectedRevision = state.revision, baseline = {}) {
  const requestedCollection = state.collectionId,
    mutation = revisionFeed.start();
  try {
    if (
      (baseline.session !== undefined && baseline.session !== connectionSession) ||
      (baseline.book !== undefined &&
        bookSnapshot(state.books.find((b) => b.id === cmd.id)) !== baseline.book)
    )
      throw Object.assign(new Error('Książka lub sesja zmieniła się. Wpisane dane zachowano.'), {
        code: 'CONFLICT',
      });
    const next = await api.command(cmd, expectedRevision);
    if (!revisionFeed.isCurrent(mutation))
      throw Object.assign(new Error('Sesja aplikacji zmieniła się podczas zapisu.'), {
        code: 'CONFLICT',
      });
    if (
      revisionFeed.isCurrent(mutation) &&
      state.collectionId === requestedCollection &&
      (next.collectionId !== state.collectionId || next.revision > state.revision)
    ) {
      state = next;
      layoutPanel?.receive(state, { local: true });
      render();
    } else layoutPanel?.receive(state, { local: true });
    return state;
  } catch (error) {
    if (error.code === 'CONFLICT') {
      await refresh();
      throw Object.assign(
        new Error(
          'Kolekcja zmieniła się w drugim oknie. Wpisane dane zachowano. Otwórz aktualną wersję przed ponowną edycją.',
        ),
        { code: 'CONFLICT' },
      );
    }
    throw error;
  } finally {
    revisionFeed.finish(mutation);
  }
}
function navigate(next, filter = null) {
  view = next;
  shelfFilter = filter;
  statusFilter = '';
  galleryPage = 0;
  syncRoute(false);
  render();
  window.scrollTo(0, 0);
  if (importPanel?.isDirty())
    notice('Podgląd importu zachowano. Wróć do Ustawień → Kolekcja, aby go dołączyć lub odrzucić.');
  else if (layoutPanel?.isDirty())
    notice('Szkic rozmieszczenia zachowano. Wróć do zakładki Tapeta, aby go zapisać lub cofnąć.');
}
function syncRoute(replace = true) {
  if (!navigationReady) return;
  const hash = routeHash({
    view,
    settingsGroup,
    shelfId: shelfFilter,
    query: collectionQuery,
    status: statusFilter,
    page: galleryPage,
    mode: collectionMode,
  });
  if (location.hash !== hash)
    history[replace ? 'replaceState' : 'pushState'](
      null,
      '',
      location.pathname + location.search + hash,
    );
}
function restoreRoute() {
  navigationReady = true;
  const route = readRoute(location.hash, state.shelves);
  view = route.view;
  settingsGroup = route.settingsGroup;
  shelfFilter = route.shelfId;
  collectionQuery = route.query;
  statusFilter = route.status;
  galleryPage = route.page;
  collectionMode = route.mode;
  render();
  window.scrollTo(0, 0);
}
addEventListener('popstate', () => {
  if (state) restoreRoute();
});
addEventListener('hashchange', () => {
  if (state) restoreRoute();
});

function render() {
  const savedFocus = captureManagerFocus();
  const existingIds = new Set(state.books.map((book) => book.id));
  for (const id of selectedBooks) if (!existingIds.has(id)) selectedBooks.delete(id);
  document.documentElement.dataset.theme = state.settings.theme;
  document.body.dataset.theme = state.settings.theme;
  $('total').textContent = state.books.length;
  for (const theme of ['light', 'dark']) {
    const choice = $('theme-' + theme);
    choice.disabled = false;
    choice.setAttribute('aria-pressed', state.settings.theme === theme);
  }
  $('shelf-nav').replaceChildren();
  const occupiedGenres = new Set(state.books.map((book) => book.shelfId));
  for (const s of [...state.shelves]
    .filter((s) => occupiedGenres.has(s.id))
    .sort((a, b) => a.order - b.order)) {
    const active = view === 'books' && shelfFilter === s.id;
    const b = button(s.name, () => navigate('books', s.id), 'category-button');
    b.dataset.shelfId = s.id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active);
    b.ondragover = (e) => e.preventDefault();
    b.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (state.settings.sort === 'manual' && state.books.some((x) => x.id === id))
        command({
          type: 'moveBook',
          id,
          shelfId: s.id,
          index: state.books.filter((x) => x.shelfId === s.id && x.id !== id).length,
        }).catch((e) => notice(e.message, true));
    };
    $('shelf-nav').append(b);
  }
  $('all-books').classList.toggle('active', view === 'books');
  $('all-books').setAttribute('aria-current', view === 'books' ? 'page' : 'false');
  $('all-shelves').classList.toggle('active', !shelfFilter);
  $('all-shelves').setAttribute('aria-pressed', !shelfFilter);
  for (const [id, target] of [
    ['settings-view', 'settings'],
    ['wallpaper-view', 'wallpaper'],
  ]) {
    $(id).classList.toggle('active', view === target);
    $(id).setAttribute('aria-current', view === target ? 'page' : 'false');
  }
  $('add-book').hidden = view !== 'books';
  $('collection-controls').hidden = view !== 'books';
  $('collection-tools').replaceChildren();
  layoutPanel?.receive(state);
  layoutPanel?.unmount();
  importPanel?.receive(state);
  importPanel?.unmount();
  const main = $('main-content');
  main.replaceChildren();
  if (view === 'books') renderBooks(main, $('collection-tools'));
  else if (view === 'shelves') {
    renderShelves(main);
    enableShelfDrag(main);
  } else if (view === 'settings') renderSettings(main);
  else renderWallpaper(main);
  lightingClock.sync();
  restoreManagerFocus(savedFocus);
  syncRoute(true);
}
function heading(title, description) {
  $('view-title').textContent = title;
  $('view-description').textContent = description;
}
function enableShelfDrag(main) {
  const ids = [...state.shelves].sort((a, b) => a.order - b.order).map((s) => s.id);
  [...main.querySelectorAll('.shelf-edit-row')].forEach((row, index) => {
    row.draggable = true;
    row.ondragstart = (e) => e.dataTransfer.setData('application/x-bookshelf-shelf', ids[index]);
    row.ondragover = (e) => e.preventDefault();
    row.ondrop = (e) => {
      e.preventDefault();
      const moving = e.dataTransfer.getData('application/x-bookshelf-shelf');
      if (!ids.includes(moving) || moving === ids[index]) return;
      const reordered = ids.filter((id) => id !== moving);
      reordered.splice(reordered.indexOf(ids[index]), 0, moving);
      command({ type: 'reorderShelves', ids: reordered }).catch((e) => notice(e.message, true));
    };
  });
}
function renderBooks(main, toolRoot = main) {
  const result = collectionView(state, {
    shelfId: shelfFilter,
    status: statusFilter,
    query: collectionQuery,
    page: galleryPage,
  });
  galleryPage = result.page;
  const countLabel = { one: 'książka', few: 'książki', many: 'książek', other: 'książki' }[
    new Intl.PluralRules('pl').select(result.total)
  ];
  heading(
    shelfFilter ? state.shelves.find((s) => s.id === shelfFilter)?.name : 'Moja biblioteczka',
    result.total + ' ' + countLabel,
  );
  const bar = el('div', 'collection-toolbar'),
    search = el('input', 'collection-search');
  search.id = 'collection-search';
  search.type = 'search';
  search.maxLength = 500;
  search.value = collectionQuery;
  search.placeholder = 'Tytuł, autor lub ISBN';
  search.setAttribute('aria-label', 'Szukaj w biblioteczce');
  search.oninput = () => {
    collectionQuery = search.value;
    galleryPage = 0;
    render();
  };
  const sorting = select(SORT_OPTIONS, state.settings.sort);
  sorting.id = 'book-sort';
  sorting.setAttribute('aria-label', 'Sortuj książki');
  sorting.onchange = () => {
    galleryPage = 0;
    return command({ type: 'updateSettings', patch: { sort: sorting.value } }).catch((e) =>
      notice(e.message, true),
    );
  };
  const mode = select(
    [
      ['gallery', 'Galeria'],
      ['list', 'Lista'],
    ],
    collectionMode,
  );
  mode.id = 'collection-mode';
  mode.setAttribute('aria-label', 'Widok kolekcji');
  mode.onchange = () => {
    collectionMode = mode.value;
    render();
  };
  bar.append(search, sorting, mode);
  toolRoot.append(bar);
  const selection = button(selectionMode ? 'Zakończ zaznaczanie' : 'Wybierz książki', () => {
    selectionMode = !selectionMode;
    if (!selectionMode) {
      selectedBooks.clear();
      bulkDraft = { shelfId: '', readDate: '' };
    }
    render();
  });
  selection.id = 'select-books';
  selection.setAttribute('aria-pressed', selectionMode);
  toolRoot.append(selection);
  if (selectionMode) renderBulkControls(toolRoot, result.books);

  if (!result.total) {
    const empty = el('div', 'empty-state');
    empty.append(
      el('h2', '', state.books.length ? 'Brak książek w tym widoku' : 'Dodaj pierwszą książkę'),
      el(
        'p',
        '',
        state.books.length
          ? 'Zmień wyszukiwanie lub filtr.'
          : 'Wyszukaj tytuł lub ISBN. Możesz też dodać książkę ręcznie.',
      ),
      button('Dodaj książkę', () => showEditor(), 'primary'),
    );
    main.append(empty);
    return;
  }
  const list = el(
    'div',
    'book-list' +
      (collectionMode === 'list' ? ' compact-list' : '') +
      (selectionMode ? ' selecting' : ''),
  );
  for (const b of result.books) {
    const position = result.positions.get(b.id) ?? { index: 0, count: 0 };
    const row = createBookCard(b, {
      shelfName: result.shelfNames.get(b.shelfId) ?? '',
      manual: state.settings.sort === 'manual' && !selectionMode,
      ...position,
      selecting: selectionMode,
      selected: selectedBooks.has(b.id),
      onSelect: (checked) => {
        if (checked) selectedBooks.add(b.id);
        else selectedBooks.delete(b.id);
        render();
      },
      onInspect: () => showBookDetails(b),
      onEdit: () => showEditor(b),
      onDelete: async () => {
        try {
          if (confirm('Usunąć „' + b.title + '” z biblioteczki?'))
            await command({ type: 'deleteBook', id: b.id });
        } catch (e) {
          notice(e.message, true);
        }
      },
      onMove: (target) =>
        command({ type: 'moveBook', id: b.id, shelfId: b.shelfId, index: target }).catch((e) =>
          notice(e.message, true),
        ),
      onDrop: (id) => {
        if (id === b.id || !state.books.some((x) => x.id === id)) return;
        const others = state.books
          .filter((x) => x.shelfId === b.shelfId && x.id !== id)
          .sort((a, b) => a.order - b.order);
        command({
          type: 'moveBook',
          id,
          shelfId: b.shelfId,
          index: others.findIndex((x) => x.id === b.id),
        }).catch((e) => notice(e.message, true));
      },
    });
    list.append(row);
  }
  main.append(list);
  if (result.pages > 1) {
    const paging = el('nav', 'collection-paging');
    paging.setAttribute('aria-label', 'Strony kolekcji');
    const previous = button('Poprzednia', () => {
      galleryPage--;
      render();
      window.scrollTo(0, 0);
    });
    previous.id = 'collection-previous';
    previous.disabled = result.page === 0;
    const next = button('Następna', () => {
      galleryPage++;
      render();
      window.scrollTo(0, 0);
    });
    next.id = 'collection-next';
    next.disabled = result.page === result.pages - 1;
    paging.append(
      previous,
      el('span', '', 'Strona ' + (result.page + 1) + ' / ' + result.pages),
      next,
    );
    main.append(paging);
  }
}

function renderBulkControls(root, books) {
  const form = el('form', 'bulk-controls'),
    count = el('strong', '', 'Zaznaczone: ' + selectedBooks.size);
  const shelf = select(
    [['', 'Półka: bez zmian'], ...state.shelves.map((s) => [s.id, s.name])],
    bulkDraft.shelfId,
  );
  shelf.id = 'bulk-shelf';
  shelf.setAttribute('aria-label', 'Półka zaznaczonych książek');
  shelf.onchange = () => {
    bulkDraft.shelfId = shelf.value;
  };
  const date = el('input');
  date.type = 'date';
  date.min = '0001-01-01';
  date.max = '9999-12-31';
  date.id = 'bulk-date';
  date.value = bulkDraft.readDate;
  date.setAttribute('aria-label', 'Data ostatniego przeczytania zaznaczonych książek');
  date.oninput = () => {
    bulkDraft.readDate = date.value;
  };
  const apply = el('button', 'primary', 'Zastosuj do zaznaczonych');
  apply.type = 'submit';
  apply.disabled = !selectedBooks.size;
  const all = button('Zaznacz tę stronę', () => {
    books.forEach((book) => selectedBooks.add(book.id));
    render();
  });
  all.id = 'select-page';
  const clear = button('Wyczyść zaznaczenie', () => {
    selectedBooks.clear();
    render();
  });
  clear.id = 'clear-selection';
  const note = el(
    'small',
    'muted',
    'Pusta data zachowa obecne daty. Zmiany obejmą zaznaczenie ze wszystkich stron.',
  );
  form.append(count, all, clear, shelf, date, note, apply);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const patch = {};
    if (shelf.value) patch.shelfId = shelf.value;
    if (date.value) patch.readDate = date.value;
    if (!Object.keys(patch).length) {
      notice('Wybierz gatunek lub datę do zmiany.', true);
      return;
    }
    apply.disabled = true;
    try {
      const count = selectedBooks.size;
      await command({ type: 'bulkUpdateBooks', ids: [...selectedBooks], patch });
      selectionMode = false;
      selectedBooks.clear();
      bulkDraft = { shelfId: '', readDate: '' };
      render();
      notice('Zapisano zmiany ' + count + ' książek.');
    } catch (error) {
      notice(error.message, true);
    } finally {
      if (apply.isConnected) apply.disabled = !selectedBooks.size;
    }
  };
  root.append(form);
}

function renderShelves(main) {
  heading(
    'Twoje półki',
    'Porządkuj przeczytane książki według gatunku. Możesz dodać własne nazwy.',
  );
  const available = CATEGORY_PRESETS.filter(
    (name) => resolveCategoryChoice('new:' + name, state.shelves)?.newShelfName,
  );
  if (available.length) {
    const form = el('form', 'category-presets'),
      label = el('label', '', 'Dodaj kategorię'),
      choice = select(
        [['', 'Wybierz z proponowanych kategorii'], ...available.map((name) => [name, name])],
        '',
      );
    choice.id = 'new-category-preset';
    choice.required = true;
    label.htmlFor = choice.id;
    const add = el('button', 'secondary', 'Dodaj kategorię');
    add.type = 'submit';
    form.append(label, choice, add);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const result = resolveCategoryChoice('new:' + choice.value, state.shelves);
        if (!result?.newShelfName) {
          notice('Ta kategoria jest już w biblioteczce.');
          return;
        }
        await command({ type: 'addShelf', name: result.newShelfName });
        notice('Kategoria dodana.');
      } catch (e) {
        notice(e.message, true);
      }
    };
    main.append(form);
  }
  const sorted = [...state.shelves].sort((a, b) => a.order - b.order);
  for (const [index, s] of sorted.entries()) {
    const row = el('div', 'shelf-edit-row'),
      name = el('input');
    name.value = s.name;
    name.maxLength = 100;
    name.setAttribute('aria-label', 'Nazwa półki ' + s.name);
    row.append(
      name,
      button('Zapisz', () => command({ type: 'renameShelf', id: s.id, name: name.value })),
    );
    const actions = el('div');
    for (const [text, delta] of [
      ['↑', -1],
      ['↓', 1],
    ]) {
      const move = button(
        text,
        () => {
          const ids = sorted.map((x) => x.id);
          [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
          return command({ type: 'reorderShelves', ids });
        },
        'secondary',
      );
      move.disabled = index + delta < 0 || index + delta >= sorted.length;
      actions.append(move);
    }
    const count = state.books.filter((b) => b.shelfId === s.id).length;
    let target;
    actions.append(
      button(
        'Usuń',
        async () => {
          if (count && !target?.value) throw new Error('Wybierz półkę docelową dla książek.');
          if (
            confirm(
              count
                ? `Usunąć półkę „${s.name}” i przenieść ${count} książek?`
                : `Usunąć pustą półkę „${s.name}”?`,
            )
          )
            await command({ type: 'deleteShelf', id: s.id, targetId: target?.value });
        },
        'secondary danger-button',
      ),
    );
    row.append(actions);
    if (count) {
      const dest = el('div', 'shelf-destination');
      target = select(
        [
          ['', 'Wybierz półkę docelową'],
          ...sorted.filter((x) => x.id !== s.id).map((x) => [x.id, x.name]),
        ],
        '',
      );
      target.setAttribute('aria-label', 'Półka docelowa');
      dest.append(el('span', '', `${count} książek · przy usuwaniu przenieś do:`), target);
      row.append(dest);
    }
    main.append(row);
  }
  const add = el('form', 'setting-line'),
    input = el('input');
  input.placeholder = 'Nazwa nowej półki';
  input.required = true;
  input.maxLength = 100;
  input.setAttribute('aria-label', 'Nowa półka');
  const submit = el('button', 'primary', 'Dodaj półkę');
  submit.type = 'submit';
  add.append(input, submit);
  add.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await command({ type: 'addShelf', name: input.value });
      notice('Półka dodana.');
    } catch (e) {
      notice(e.message, true);
    }
  };
  main.append(add);
}
function section(main, title, description) {
  const s = el('section', 'settings-section');
  s.append(el('h2', '', title), el('p', '', description));
  main.append(s);
  return s;
}
function renderAnnualSettings(main) {
  const scene = getRoomScene(state.settings.room ?? DEFAULT_ROOM_ID);
  if (!scene.annual) return;
  const annual = section(
    main,
    'Widok książek',
    'Miesiące układają książki według daty przeczytania, w 12 stałych wnękach. Widok gatunków pozwala też ustawić własne rozmieszczenie.',
  );
  const grouping = select(
    [
      ['months', 'Miesiące wybranego roku'],
      ['shelves', 'Gatunki'],
    ],
    isMonthlyView(state.settings, scene) ? 'months' : 'shelves',
  );
  grouping.id = 'settings-grouping';
  grouping.setAttribute('aria-label', 'Grupowanie książek na tapecie');
  grouping.onchange = () =>
    command({ type: 'updateSettings', patch: { grouping: grouping.value } }).catch((e) =>
      notice(e.message, true),
    );
  annual.append(grouping);
  const year = readingYearValue(state.settings),
    form = el('form', 'setting-line'),
    label = el('label', '', 'Rok przeczytania'),
    input = el('input'),
    save = el('button', 'primary', 'Zapisz rok');
  input.id = 'settings-reading-year';
  input.type = 'number';
  input.min = '1';
  input.max = '9999';
  input.step = '1';
  input.required = true;
  input.value = year;
  label.htmlFor = input.id;
  input.setAttribute('aria-describedby', 'annual-reading-summary');
  save.type = 'submit';
  form.append(label, input, save);
  annual.append(form);
  const summary = summarizeReadingYear(state.books, year),
    count = el(
      'p',
      'muted',
      `Rok ${year}: ${summary.total} książek · Bez daty: ${summary.undated} · Inne lata: ${summary.otherYears}`,
    );
  count.id = 'annual-reading-summary';
  count.setAttribute('role', 'status');
  annual.append(count);
  annual.append(
    el(
      'p',
      'muted',
      'Książki bez daty pozostają w kolekcji i widoku gatunków. Uzupełnij datę przeczytania w Książkach, aby pokazać je w odpowiednim miesiącu.',
    ),
    button('Otwórz książki', () => {
      collectionQuery = '';
      navigate('books');
    }),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await command({ type: 'updateSettings', patch: readingYearPatch(input.value) });
      notice('Rok przeczytania zapisany.');
    } catch (error) {
      notice(error.message, true);
    } finally {
      if (save.isConnected) save.disabled = false;
    }
  };
}
function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    a = el('a');
  a.href = url;
  a.download = 'biblioteczka-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderSettings(main) {
  heading('Ustawienia', 'Dopasuj biblioteczkę do swojego pulpitu.');
  const navigation = el('nav', 'settings-navigation');
  navigation.setAttribute('aria-label', 'Grupy ustawień');
  for (const [id, label] of SETTINGS_GROUPS) {
    const tab = button(label, () => {
      settingsGroup = id;
      syncRoute(false);
      render();
      window.scrollTo(0, 0);
    });
    tab.id = 'settings-group-' + id;
    tab.setAttribute('aria-pressed', settingsGroup === id);
    navigation.append(tab);
  }
  main.append(navigation);
  if (settingsGroup === 'appearance') {
    const rooms = section(
        main,
        'Pokój',
        'Wybierz miejsce dla swoich książek. Możesz je zmieniać w dowolnym momencie.',
      ),
      choices = el('div', 'room-options');
    rooms.classList.add('room-settings');
    for (const scene of ROOM_SCENES) {
      const chosen = (state.settings.room ?? DEFAULT_ROOM_ID) === scene.id,
        b = button(
          '',
          () => command({ type: 'updateSettings', patch: roomSelectionPatch(scene) }),
          'room-choice',
        );
      b.classList.toggle('active', chosen);
      b.setAttribute('aria-pressed', chosen);
      b.dataset.room = scene.id;
      const photo = el('img');
      photo.src = roomPresentation(scene, state.settings).asset;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.decoding = 'async';
      const copy = el('span', 'room-choice-copy');
      copy.append(el('strong', '', scene.name), el('small', '', scene.description));
      b.append(photo, copy, el('span', 'room-choice-selected', chosen ? 'Wybrany' : 'Wybierz'));
      choices.append(b);
    }
    rooms.append(choices);
    const themes = section(main, 'Motyw panelu', 'Jasny lub ciemny panel i elementy tapety.'),
      options = el('div', 'theme-options');
    for (const [theme, name] of [
      ['light', 'Jasny'],
      ['dark', 'Ciemny'],
    ]) {
      const b = button(
        '',
        () => command({ type: 'updateSettings', patch: { theme } }),
        'theme-choice',
      );
      b.classList.toggle('active', state.settings.theme === theme);
      b.setAttribute('aria-pressed', state.settings.theme === theme);
      b.append(el('div', 'theme-swatch ' + theme), el('strong', '', name));
      options.append(b);
    }
    themes.append(options);
    const light = section(
      main,
      'Światło w pokoju',
      'Wybierz porę dnia niezależnie od panelu. Automatycznie: dzień od 07:00 do 19:00 według zegara komputera, poza tym wieczór.',
    );
    const lightMode = select(LIGHTING_OPTIONS, state.settings.lighting ?? 'theme');
    lightMode.id = 'settings-lighting';
    lightMode.setAttribute('aria-label', 'Światło w pokoju');
    lightMode.onchange = () =>
      command({ type: 'updateSettings', patch: { lighting: lightMode.value } }).catch((e) =>
        notice(e.message, true),
      );
    light.append(lightMode);
  }
  if (settingsGroup === 'wallpaper') {
    const shortcut = section(
      main,
      'Podgląd i rozmieszczenie',
      'Ustaw własny układ książek na półkach.',
    );
    shortcut.append(button('Otwórz podgląd tapety', () => navigate('wallpaper')));
    renderAnnualSettings(main);
    const layout = section(
      main,
      'Układ tapety',
      'Pokój wypełnia ekran. Zarezerwuj po lewej obszar bez książek dla ikon.',
    );
    const slider = el('input');
    slider.id = 'settings-icon-space';
    slider.type = 'range';
    slider.min = 0;
    slider.max = 30;
    slider.value = Math.round(state.settings.iconSpace * 100);
    slider.setAttribute('aria-label', 'Miejsce na ikony');
    const caption = el('p', 'muted', slider.value + '% szerokości pulpitu');
    slider.oninput = () => (caption.textContent = slider.value + '% szerokości pulpitu');
    layout.append(
      el('label', '', 'Miejsce na ikony'),
      slider,
      caption,
      button(
        'Zapisz układ',
        () => command({ type: 'updateSettings', patch: { iconSpace: Number(slider.value) / 100 } }),
        'primary',
      ),
    );
    const sizing = section(
      main,
      'Rozmiar książek',
      'Proporcje dobrane do mebli. Regulacja jest zapamiętywana osobno dla każdego pokoju.',
    );
    const size = el('input');
    size.id = 'settings-book-scale';
    size.type = 'range';
    size.min = 60;
    size.max = 140;
    size.step = 5;
    size.value = Math.round((state.settings.bookScales?.[state.settings.room] ?? 1) * 100);
    size.setAttribute('aria-label', 'Rozmiar książek');
    const sizeCaption = el('p', 'muted', size.value + '% rozmiaru dopasowanego do pokoju');
    size.oninput = () =>
      (sizeCaption.textContent = size.value + '% rozmiaru dopasowanego do pokoju');
    const saveScale = (value) =>
      command({
        type: 'updateSettings',
        patch: { bookScales: { ...state.settings.bookScales, [state.settings.room]: value } },
      });
    sizing.append(
      size,
      sizeCaption,
      button('Zapisz rozmiar', () => saveScale(Number(size.value) / 100), 'primary'),
      button('Przywróć 100%', () => saveScale(1)),
    );
    const sorting = section(
      main,
      'Kolejność książek',
      isMonthlyView(state.settings, getRoomScene(state.settings.room ?? DEFAULT_ROOM_ID))
        ? 'Wszystkie książki w panelu sortujemy wspólnie. Tapeta zachowuje kolejność miesięcy i sortuje książki wewnątrz każdego miesiąca.'
        : 'Wszystkie książki w panelu sortujemy wspólnie. Tapeta układa książki według gatunku.',
    );
    const sort = select(SORT_OPTIONS, state.settings.sort);
    sort.id = 'settings-book-sort';
    sort.setAttribute('aria-label', 'Kolejność książek w panelu i na tapecie');
    sort.onchange = () =>
      command({ type: 'updateSettings', patch: { sort: sort.value } }).catch((e) =>
        notice(e.message, true),
      );
    sorting.append(sort);
  }
  if (settingsGroup === 'collection') {
    const csv = section(
      main,
      'Dołącz z Goodreads (CSV)',
      'Dołączenie zachowa obecną kolekcję. Duplikaty zostaną pominięte.',
    );
    csv.classList.add('goodreads-import');
    const importRoot = el('div');
    csv.append(importRoot);
    importPanel ??= createGoodreadsImportPanel({
      request: requestImport,
      onImported: (next) => {
        state = next;
        layoutPanel?.receive(state, { local: true });
        render();
      },
      onDirtyChange: (dirty) => {
        if (!dirty) clientUpgrade.editorClosed();
      },
      notice,
    });
    importPanel.mount(importRoot, state);
    const backup = section(
      main,
      'Kopia kolekcji',
      'Eksport zawiera książki, półki, ustawienia, lokalne okładki i ilustracje grzbietów. Import zastępuje obecną kolekcję po potwierdzeniu.',
    );
    backup.append(
      button('Eksportuj JSON', async () => {
        download(await request('/api/export'));
        notice('Kopia została pobrana.');
      }),
    );
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', 'Importuj kopię kolekcji');
    file.onchange = async () => {
      try {
        if (!file.files[0]) return;
        if (file.files[0].size > 64 * 1024 * 1024)
          throw new Error('Kopia może mieć maksymalnie 64 MB.');
        const preview = await request('/api/import/preview', {
          method: 'POST',
          body: JSON.parse(await file.files[0].text()),
        });
        if (
          confirm(
            `Zastąpić obecną kolekcję?\nKopia: ${preview.summary.books} książek, ${preview.summary.shelves} półek.\nPoprzedni stan zostanie zachowany w library.backup.json.`,
          )
        ) {
          state = await requestImport('/api/import/confirm', {
            method: 'POST',
            body: { importId: preview.importId, expectedRevision: state.revision },
          });
          render();
          notice('Kopia została przywrócona.');
        }
      } catch (e) {
        notice(e.message, true);
      } finally {
        file.value = '';
      }
    };
    backup.append(el('label', '', 'Importuj JSON'), file);
    const storage = section(main, 'Obrazy na dysku', '');
    storage.id = 'storage-settings';
    renderStorageSettings(storage, { request });
  }
  if (settingsGroup === 'advanced') {
    const ai = section(main, 'Ilustracje AI', '');
    ai.id = 'ai-settings';
    paintAiSettings(ai);
    const windows = section(
      main,
      'Windows',
      'Kolekcja jest zapisywana w folderze Dokumenty\\Biblioteczka. Ikona w zasobniku otwiera panel, przeładowuje tapetę i zamyka aplikację.',
    );
    renderWindowsSettings(windows);
  }
}

function renderWallpaper(main) {
  heading('Podgląd tapety', 'Ułóż książki na półkach; tapeta na pulpicie zmienia się od razu.');
  layoutPanel ??= createRoomLayoutPanel({
    state,
    onSave: command,
    onDirtyChange: (dirty) => {
      if (!dirty) clientUpgrade.editorClosed();
    },
    notice,
  });
  const panel = el('section', 'room-layout-editor');
  main.append(panel);
  layoutPanel.mount(panel, state);
  const s = section(
    main,
    'Tapeta na pulpicie',
    'Biblioteczka wyświetla tapetę na głównym monitorze, pod ikonami pulpitu. Jeśli jej nie widać, wybierz „Przeładuj tapetę” w menu ikony w zasobniku.',
  );
  const a = el('a', 'text-button', 'Otwórz podgląd tapety w przeglądarce ↗');
  a.href = location.origin + '/wallpaper';
  a.target = '_blank';
  a.rel = 'noopener';
  s.append(a);
}
function updateCover() {
  previewColor();
  $('cover-preview').hidden = !coverId;
  $('cover-placeholder').hidden = !!coverId;
  $('remove-cover').hidden = !coverId;
  if (coverId) $('cover-preview').src = '/covers/' + coverId;
}
function captureManagerFocus() {
  const active = document.activeElement;
  if (!active) return null;
  const key = active.id
    ? { id: active.id }
    : active.dataset?.focusKey
      ? { key: active.dataset.focusKey }
      : active.dataset?.shelfId
        ? { shelf: active.dataset.shelfId }
        : null;
  if (!key) return null;
  const row = active.closest?.('[data-book-id]'),
    menu = active.closest?.('.book-actions');
  return {
    ...key,
    bookId: row?.dataset.bookId,
    index: row ? [...document.querySelectorAll('.book-card')].indexOf(row) : -1,
    menuOpen: !!menu?.open,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}
function restoreManagerFocus(saved) {
  if (!saved) return;
  let target = saved.id
    ? $(saved.id)
    : document.querySelector(
        saved.key
          ? '[data-focus-key="' + CSS.escape(saved.key) + '"]'
          : '[data-shelf-id="' + CSS.escape(saved.shelf) + '"]',
      );
  if ((!target || target.disabled) && saved.bookId) {
    const rows = [...document.querySelectorAll('.book-card')],
      row =
        rows.find((n) => n.dataset.bookId === saved.bookId) ??
        rows[Math.min(Math.max(saved.index, 0), rows.length - 1)];
    target = target?.disabled
      ? row?.querySelector('summary')
      : row?.querySelector('.book-cover-button');
    target ??= $('collection-search');
  }
  const menu = target?.closest?.('.book-actions');
  if (menu && (saved.menuOpen || target.tagName !== 'SUMMARY')) menu.open = true;
  if (!target || target.disabled || !target.getClientRects().length) return;
  if (document.activeElement !== target) target.focus({ preventScroll: true });
  if (typeof saved.start === 'number' && target.setSelectionRange)
    try {
      target.setSelectionRange(saved.start, saved.end);
    } catch {}
}

function editorFields() {
  return {
    values: [
      'title',
      'authors',
      'shelf',
      'read-date',
      'isbn',
      'page-count',
      'publisher',
      'publication-year',
      'language',
      'spine-color',
    ].map((id) => [id, $(id).value]),
    coverId,
    palette,
    provider,
    providerId,
    bookSubjects,
    currentSpineStyle,
    spineFrame: frameEditor?.dirtySnapshot() ?? null,
  };
}
let detailBookId = null;
const detailsGuard = createDraftGuard();
function detailFields() {
  return { readDate: $('detail-date')?.value };
}
function detailDirty() {
  return !!$('book-details')?.open && detailsGuard.isDirty(detailFields());
}
function closeBookDetails() {
  if (detailsGuard.canClose(detailFields(), confirm)) $('book-details').close();
}
function showBookDetails(book) {
  const dialog = $('book-details');
  detailBookId = book.id;
  dialog.replaceChildren();
  const header = el('header', 'detail-header'),
    title = el('h2', '', book.title);
  title.id = 'detail-title';
  header.append(title, button('Zamknij', closeBookDetails));
  dialog.append(header);
  dialog.append(
    el('p', '', book.authors.join(', ')),
    el('p', 'muted', state.shelves.find((s) => s.id === book.shelfId)?.name ?? ''),
  );
  const form = el('form', 'detail-form');
  const date = el('input');
  date.id = 'detail-date';
  date.type = 'date';
  date.min = '0001-01-01';
  date.max = '9999-12-31';
  date.value = book.readDate ?? '';
  const dateLabel = el('label', '', 'Data ostatniego przeczytania');
  dateLabel.htmlFor = date.id;
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const submit = el('button', 'primary', 'Zapisz datę');
  submit.type = 'submit';
  const actions = el('div', 'detail-actions');
  const save = async (patch) => {
    submit.disabled = true;
    error.hidden = true;
    try {
      await command({ type: 'updateBook', id: book.id, patch }, detailRevision, {
        session: detailSession,
        book: detailSnapshot,
      });
      detailsGuard.saved(detailFields());
      dialog.close();
      notice('Data przeczytania zapisana.');
    } catch (e) {
      error.hidden = false;
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  const detailRevision = state.revision,
    detailSession = connectionSession,
    detailSnapshot = bookSnapshot(book);
  form.onsubmit = (e) => {
    e.preventDefault();
    save({ readDate: date.value || null });
  };
  actions.append(
    submit,
    button('Edytuj wszystkie dane', () => {
      if (!detailsGuard.canClose(detailFields(), confirm)) return;
      detailsGuard.reset();
      dialog.close();
      showEditor(state.books.find((b) => b.id === book.id) ?? book);
    }),
  );
  form.append(dateLabel, date, error, actions);
  dialog.append(form);
  detailsGuard.start(detailFields());
  dialog.showModal();
  date.focus();
}
$('book-details').addEventListener('cancel', (event) => {
  if (!detailsGuard.canClose(detailFields(), confirm)) event.preventDefault();
});
$('book-details').addEventListener('close', () => {
  detailsGuard.reset();
  const target = document.querySelector(
    '[data-book-id="' + CSS.escape(detailBookId ?? '') + '"] .book-cover-button',
  );
  target?.focus({ preventScroll: true });
  clientUpgrade.editorClosed();
});
function populate(draft = {}, manualShelfId = null) {
  coverPicker?.cancel();
  catalogImageId = null;
  coverUrlImport?.reset();
  coverUrlImport?.setDisabled(false);
  cancelSpineImageImport(spineControls);
  $('cover-file').value = '';
  $('cover-file').disabled = false;
  frameEditor?.reset(draft.spine);
  bookSubjects = draft.subjects ?? [];
  editorSnapshot = bookSnapshot(draft.id ? draft : null);
  currentSpineStyle = draft.spineStyle ?? null;
  editorRevision = state.revision;
  editorSession = connectionSession;
  editing = draft.id ?? null;
  coverId = typeof draft.coverId === 'string' ? draft.coverId : null;
  palette = draft.palette ?? [];
  provider = draft.provider ?? null;
  providerId = draft.providerId ?? null;
  for (const id of ['title', 'isbn', 'publisher', 'publication-year', 'language', 'page-count'])
    $(id).value =
      draft[{ 'publication-year': 'publicationYear', 'page-count': 'pageCount' }[id] ?? id] ?? '';
  $('read-date').value = draft.readDate ?? (editing ? '' : localCalendarDate());
  $('authors').value = (draft.authors ?? []).join('; ');
  $('shelf').replaceChildren();
  for (const shelf of state.shelves) {
    const option = el('option', '', shelf.name);
    option.value = shelf.id;
    $('shelf').append(option);
  }
  const presets = el('optgroup');
  presets.label = 'Nowa kategoria — dodana przy zapisie';
  for (const name of [...CATEGORY_PRESETS, 'Pozostałe']) {
    const choice = resolveCategoryChoice('new:' + name, state.shelves);
    if (!choice?.newShelfName) continue;
    const option = el('option', '', name + ' (nowa półka)');
    option.value = choice.value;
    presets.append(option);
  }
  if (presets.children.length) $('shelf').append(presets);
  let category = null;
  if (!draft.id && ['openlibrary', 'bn'].includes(draft.provider))
    category = editorCategory(bookSubjects, state.shelves, { manualShelfId });
  $('shelf').value =
    draft.shelfId ??
    category?.value ??
    shelfFilter ??
    state.shelves.find((s) => s.name === 'Pozostałe')?.id ??
    state.shelves[0]?.id ??
    'new:Pozostałe';
  categoryNote.textContent =
    category?.message ??
    (draft.id
      ? 'Półka wybrana dla tej książki. Możesz ją zmienić.'
      : 'Wybierz półkę lub nową kategorię. Katalog może zaproponować gatunek.');
  $('spine-color').value = makeSpine({
    ...draft,
    title: draft.title ?? '',
    authors: draft.authors ?? [],
  }).palette[0];
  $('editor-title').textContent = editing ? 'Edytuj książkę' : 'Dodaj książkę';
  $('search-area').hidden = !!editing;
  $('save-book').textContent = editing ? 'Zapisz zmiany' : 'Dodaj do biblioteczki';
  $('form-error').hidden = true;
  $('form-error').textContent = '';
  $('edit-duplicate').hidden = true;
  $('cover-note').textContent = 'JPEG, PNG lub WebP · do 10 MB';
  updateCover();
  updateSpineControls();
  coverPicker?.reset();
}

async function findMissingCover(book) {
  if (coverId || book?.spine?.assetId) return;
  return coverPicker?.search({ automatic: true });
}
function showEditor(book) {
  if (!$('editor').hidden && !draftGuard.canClose(editorFields(), confirm)) return;
  suggestions.input('');
  uploading = false;
  $('save-book').disabled = false;
  reloadLatest.hidden = true;
  operation++;
  shelfTouched = false;
  populate(book);
  draftGuard.start(editorFields());
  $('query').value = '';
  $('search-results').replaceChildren();
  $('search-feedback').textContent = '';
  $('editor').hidden = false;
  coverPicker?.reset();
  fitSpineTitles(spinePreview);
  document.querySelector('.app-shell').inert = true;
  (book ? $('title') : $('query')).focus();
  if (
    book?.id &&
    !book.coverId &&
    !book.spine?.assetId &&
    (book.isbn || (book.title && book.authors?.length))
  )
    void findMissingCover(book);
}
function cancelEditorWork() {
  coverPicker?.cancel();
  operation++;
  coverUrlImport?.cancel();
  coverUrlImport?.setDisabled(false);
  $('cover-file').disabled = false;
  cancelSpineImageImport(spineControls);
  uploading = false;
  $('save-book').disabled = false;
  updateSpineControls();
}
function closeEditor() {
  if ($('editor').hidden) return;
  if (!draftGuard.canClose(editorFields(), confirm)) return;
  draftGuard.reset();
  suggestions.cancel();
  cancelEditorWork();
  $('editor').hidden = true;
  document.querySelector('.app-shell').inert = false;
  $('add-book').focus();
  clientUpgrade.editorClosed();
}
const categoryNote = el('p', 'category-note');
categoryNote.id = 'category-note';
categoryNote.setAttribute('role', 'status');
$('shelf').setAttribute('aria-describedby', 'category-note');
$('shelf').after(categoryNote);
$('shelf').onchange = () => {
  shelfTouched = true;
  categoryNote.textContent = 'Wybrana przez Ciebie półka. Możesz ją zmienić.';
};
const reloadLatest = button(
  'Otwórz aktualną wersję',
  () => {
    const current = state.books.find((b) => b.id === editing);
    if (!current) {
      notice('Ta książka została usunięta w drugim oknie.', true);
      return;
    }
    if (confirm('Otworzyć aktualną wersję? Niezapisane zmiany formularza zostaną zastąpione.')) {
      cancelEditorWork();
      populate(current);
      draftGuard.start(editorFields());
      reloadLatest.hidden = true;
    }
  },
  'text-button',
);
reloadLatest.hidden = true;
$('form-error').after(reloadLatest);
const spinePanel = el('section', 'spine-preview-panel'),
  spinePreview = el('div', 'spine-preview-stage'),
  spineCopy = el('div', 'spine-preview-copy');
spineCopy.append(
  el('h3', '', 'Twój grzbiet'),
  el('p', '', 'Ten sam grzbiet zobaczysz na tapecie.'),
  el('small', '', 'Kolor oprawy możesz zmienić w danych wydania.'),
);
spinePanel.append(spinePreview, spineCopy);
$('book-form').querySelector('details').append(spinePanel);
$('book-form')
  .querySelector('details')
  .addEventListener('toggle', () => fitSpineTitles(spinePreview));
const spineControls = el('section', 'spine-controls');
spinePanel.after(spineControls);
const frameRoot = el('section', 'spine-frame-controls');
spinePanel.after(frameRoot);
frameEditor = createSpineFrameEditor(frameRoot, {
  onChange: previewColor,
  onConflict: () => {
    reloadLatest.hidden = false;
  },
});
function updateSpineControls() {
  const book = state.books.find((b) => b.id === editing),
    selectedOperation = operation;
  renderSpineControls(spineControls, {
    book,
    status: aiStatus,
    onUpload: async (id, image) => {
      if (selectedOperation !== operation || editing !== id || $('editor').hidden) return;
      const saved = state.books.find((b) => b.id === id);
      if (!saved || saved.coverId !== coverId)
        throw new Error('Zapisz zmianę okładki przed wgraniem grzbietu.');
      await request('/api/spines/upload', {
        method: 'POST',
        body: { bookId: id, expectedRevision: state.revision, ...image },
      });
      await refresh();
      await refreshAi();
    },
  });
}
spinePreview.addEventListener('spine-image-error', () => {
  const message = el(
    'p',
    'ai-error',
    'Nie udało się odczytać ilustracji. Wyświetlam lokalny grzbiet. Możesz wgrać obraz ponownie.',
  );
  message.setAttribute('role', 'alert');
  spineControls.append(message);
});
function spineDraft() {
  const saved = state.books.find((b) => b.id === editing),
    image = saved?.coverId === coverId ? saved?.spine : null;
  return {
    coverId,
    spine: image ? { ...image, frame: frameEditor.value(image) } : null,
    title: $('title').value.trim() || 'Tytuł książki',
    authors: $('authors')
      .value.split(';')
      .map((a) => a.trim())
      .filter(Boolean),
    isbn: $('isbn').value,
    pageCount: Number($('page-count').value) || null,
    publisher: $('publisher').value,
    spineStyle: currentSpineStyle ?? undefined,
    palette: [$('spine-color').value, ...palette.filter((c) => c !== $('spine-color').value)].slice(
      0,
      5,
    ),
  };
}
function previewColor() {
  const saved = state.books.find((b) => b.id === editing),
    sameCover = saved?.coverId === coverId;
  frameEditor.setVisible(!!sameCover);
  if (sameCover) frameEditor.receive(saved?.spine);
  const draft = spineDraft();
  spinePreview.replaceChildren(createSpineElement(draft));
  fitSpineTitles(spinePreview);
}
for (const id of ['title', 'authors', 'isbn', 'page-count', 'publisher', 'spine-color'])
  $(id).addEventListener('input', previewColor);
$('editor').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const controls = [...$('editor').querySelectorAll('button,input,select,summary')].filter(
    (x) => !x.disabled && x.getClientRects().length,
  );
  const first = controls[0],
    last = controls.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
$('all-books').onclick = () => navigate('books');
$('all-shelves').onclick = () => navigate('books');
for (const theme of ['light', 'dark'])
  $('theme-' + theme).onclick = () =>
    command({ type: 'updateSettings', patch: { theme } }).catch((e) => notice(e.message, true));
$('manage-shelves').onclick = () => navigate('shelves');
$('settings-view').onclick = () => navigate('settings');
$('wallpaper-view').onclick = () => navigate('wallpaper');
$('add-book').onclick = () => showEditor();
$('close-editor').onclick = closeEditor;
$('cancel-book').onclick = closeEditor;
$('manual-button').onclick = () => {
  suggestions.cancel();
  cancelEditorWork();
  $('search-area').hidden = true;
  $('title').focus();
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('.ai-confirm[open]')) closeEditor();
});
$('remove-cover').onclick = () => {
  cancelEditorWork();
  coverId = null;
  palette = [];
  updateCover();
  coverPicker?.reset();
};
function beginCoverImport() {
  coverPicker?.cancel();
  suggestions.cancel();
  cancelSpineImageImport(spineControls);
  const current = ++operation;
  uploading = true;
  $('save-book').disabled = true;
  return current;
}
function finishCoverImport(current) {
  if (current === operation) {
    uploading = false;
    $('save-book').disabled = false;
    updateSpineControls();
    coverPicker?.reset();
  }
}
async function applyCoverFile(file, current) {
  const image = await readCoverFile(file);
  if (current !== operation) return;
  const saved = await request('/api/covers', {
    method: 'POST',
    body: { mime: image.mime, base64: image.base64 },
  });
  if (current !== operation) return;
  coverId = saved.coverId;
  palette = image.palette;
  $('spine-color').value = palette[0];
  updateCover();
  $('cover-note').textContent = 'Okładka zapisana lokalnie.';
}
$('cover-file').onchange = async () => {
  const file = $('cover-file').files[0];
  if (!file) return;
  coverUrlImport.cancel();
  coverUrlImport.setDisabled(true);
  const current = beginCoverImport();
  try {
    await applyCoverFile(file, current);
  } catch (e) {
    if (current === operation) {
      $('form-error').hidden = false;
      $('form-error').textContent = e.message;
    }
  } finally {
    if (current === operation) {
      coverUrlImport.setDisabled(false);
      finishCoverImport(current);
      $('cover-file').value = '';
    }
  }
};
const coverUrlRoot = el('div');
$('cover-file').after(coverUrlRoot);
coverUrlImport = createImageUrlControl(coverUrlRoot, {
  label: 'Link do okładki',
  onStart: () => {
    const current = beginCoverImport();
    $('cover-file').disabled = true;
    return current;
  },
  onFinish: (current) => {
    $('cover-file').disabled = false;
    finishCoverImport(current);
  },
  onImport: (image, current) => {
    const bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0));
    return applyCoverFile(new Blob([bytes], { type: image.mime }), current);
  },
});
const coverPickerRoot = el('div');
$('book-form').querySelector('.form-top').after(coverPickerRoot);
coverPicker = createEditorCoverPicker(coverPickerRoot, {
  request,
  localPalette,
  getContext: () => {
    if ($('editor').hidden) return null;
    return {
      identity: JSON.stringify([connectionSession, editorSession, operation, editing]),
      coverId,
      book: {
        title: $('title').value.trim(),
        authors: $('authors')
          .value.split(';')
          .map((a) => a.trim())
          .filter(Boolean),
        isbn: $('isbn').value.trim() || null,
        providerId,
        catalogCoverId: catalogImageId,
      },
    };
  },
  applyCover: (saved, colors) => {
    coverId = saved.coverId;
    palette = colors;
    $('spine-color').value = colors[0] ?? $('spine-color').value;
    updateCover();
    updateSpineControls();
    $('cover-note').textContent =
      'Okładka z ' +
      (saved.source === 'inventaire' ? 'Inventaire' : 'Open Library') +
      '. Grzbiet gotowy; zapisz książkę, aby zachować zmianę.';
  },
  setBusy: (busy) => {
    uploading = busy;
    $('save-book').disabled = busy;
    updateSpineControls();
  },
  onError: () => {},
});
for (const id of ['title', 'authors', 'isbn'])
  $(id).addEventListener('input', () => {
    catalogImageId = null;
    coverPicker.reset();
  });
async function chooseCatalogBook(item) {
  coverPicker?.cancel();
  suggestions.cancel();
  const selected = ++operation;
  uploading = true;
  $('save-book').disabled = true;
  $('search-feedback').textContent = 'Pobieram dane książki…';
  try {
    let edition = null,
      warning = '';
    if (item.editionId && item.provider !== 'bn')
      try {
        edition = await request('/api/edition?id=' + encodeURIComponent(item.editionId));
        if (!edition) warning = 'Brak pełnych danych wydania. Sprawdź dostępne informacje.';
      } catch {
        warning = 'Pełne dane wydania są niedostępne. Sprawdź dostępne informacje.';
      }
    if (selected !== operation) return;
    const manualShelfId = shelfTouched ? $('shelf').value : null;
    const draft = { ...catalogDraft(item, edition), readDate: $('read-date').value };
    populate(draft, manualShelfId);
    $('search-area').hidden = true;
    $('title').focus();
    const remoteCover = edition?.coverId ?? item.coverId;
    catalogImageId = Number.isInteger(remoteCover) && remoteCover > 0 ? remoteCover : null;
    $('cover-note').textContent = [warning, 'Okładkę możesz wybrać z propozycji, pliku lub linku.']
      .filter(Boolean)
      .join(' ');
    coverPicker?.reset();
    void coverPicker?.search({ automatic: true });
  } catch (e) {
    if (selected === operation) {
      $('form-error').hidden = false;
      $('form-error').textContent = e.message;
    }
  } finally {
    if (selected === operation) {
      uploading = false;
      $('save-book').disabled = false;
    }
  }
}
function showSuggestions(result) {
  $('search-results').replaceChildren();
  $('search-results').setAttribute(
    'aria-busy',
    String(['loading', 'loading-more'].includes(result.status)),
  );
  const messages = {
    idle: 'Wpisz co najmniej 2 znaki tytułu, autora lub ISBN.',
    waiting: 'Czekam, aż skończysz pisać…',
    loading: 'Szukam książek…',
    error: (result.message ?? 'Katalog jest niedostępny.') + ' Możesz wpisać dane ręcznie.',
  };
  const ready = ['ready', 'loading-more'].includes(result.status);
  const feedback = ready
    ? result.items.length
      ? result.items.length + ' wyników. Wybierz książkę, aby uzupełnić dane.'
      : result.warnings?.length
        ? 'Brak wyników w dostępnej części katalogu. Spróbuj ponownie.'
        : 'Brak wyników. Spróbuj autora, innego tytułu lub ISBN.'
    : messages[result.status];
  $('search-feedback').textContent = [
    feedback,
    ...(result.warnings ?? []),
    result.message && ready ? result.message + ' Spróbuj ponownie przyciskiem poniżej.' : null,
  ]
    .filter(Boolean)
    .join(' ');
  loadMore.hidden = !result.nextCursor;
  loadMore.disabled = result.status === 'loading-more';
  loadMore.textContent = result.status === 'loading-more' ? 'Wczytuję…' : 'Pokaż więcej wyników';
  for (const item of result.items) {
    const b = button('', () => chooseCatalogBook(item), 'search-result');
    const thumbnail = el('div', 'search-cover');
    thumbnail.setAttribute('aria-hidden', 'true');
    if (Number.isInteger(item.coverId) && item.coverId > 0) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = 'https://covers.openlibrary.org/b/id/' + item.coverId + '-S.jpg?default=false';
      img.onerror = () => {
        img.remove();
        thumbnail.textContent = '▥';
      };
      thumbnail.append(img);
    } else thumbnail.textContent = '▥';
    const info = el('div', 'search-result-info');
    info.append(
      el('strong', '', item.title),
      el('small', '', item.authors?.join(', ') || 'Autor nieznany'),
      el(
        'small',
        '',
        [
          item.provider === 'bn' ? 'Biblioteka Narodowa' : 'Open Library',
          item.language === 'pol' ? 'Polskie wydanie' : item.language,
          item.publicationYear
            ? (item.provider === 'bn' ? 'Rok wydania: ' : 'Pierwsze wydanie: ') +
              item.publicationYear
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    b.append(thumbnail, info);
    $('search-results').append(b);
  }
}
const loadMore = button('Pokaż więcej wyników', () => suggestions.more(), 'secondary');
loadMore.hidden = true;
$('search-results').after(loadMore);
const suggestions = createSearchController({
  search: (query, signal, cursor) =>
    request(
      '/api/search?paged=1&q=' +
        encodeURIComponent(query) +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      { signal },
    ),
  onState: showSuggestions,
});
const lightingClock = watchLighting({
  getSettings: () => state?.settings ?? { theme: 'light' },
  onChange: () => {
    const date = new Date();
    for (const scene of ROOM_SCENES) {
      const photo = document.querySelector(`.room-choice[data-room="${scene.id}"] img`);
      if (photo) photo.src = roomPresentation(scene, state.settings, date).asset;
    }
  },
});
addEventListener('pagehide', (event) => {
  if (!event.persisted) lightingClock.dispose();
});
$('query').addEventListener('input', () => {
  cancelEditorWork();
  suggestions.input($('query').value);
});
$('search-form').onsubmit = (e) => {
  e.preventDefault();
  cancelEditorWork();
  suggestions.submit($('query').value);
};
$('book-form').onsubmit = async (e) => {
  e.preventDefault();
  if (uploading) return;
  coverPicker?.cancel();
  $('save-book').disabled = true;
  try {
    const shelfValue = $('shelf').value,
      newShelfName = shelfValue.startsWith('new:') ? shelfValue.slice(4) : null;
    const draft = validateBookForm({
      subjects: bookSubjects,
      title: $('title').value,
      authors: $('authors').value,
      isbn: $('isbn').value,
      pageCount: $('page-count').value,
      publisher: $('publisher').value,
      publicationYear: $('publication-year').value,
      language: $('language').value,
      shelfId: newShelfName ? null : shelfValue,
      status: 'read',
      readDate: $('read-date').value,
      coverId,
      palette: [
        $('spine-color').value,
        ...palette.filter((c) => c !== $('spine-color').value),
      ].slice(0, 5),
      provider,
      providerId,
      spineStyle: makeSpine({
        title: $('title').value.trim(),
        authors: $('authors')
          .value.split(';')
          .map((a) => a.trim())
          .filter(Boolean),
        isbn: $('isbn').value,
        spineStyle: currentSpineStyle ?? undefined,
      }).spineStyle,
    });
    if (editing && state.books.find((b) => b.id === editing)?.coverId === coverId) {
      const crop = frameEditor.patch();
      if (crop) draft.spineFrame = crop;
    }
    await command(
      editing
        ? { type: 'updateBook', id: editing, patch: draft, newShelfName }
        : { type: 'addBook', draft, newShelfName },
      editorRevision,
      { session: editorSession, ...(editing ? { book: editorSnapshot } : {}) },
    );
    draftGuard.saved(editorFields());
    closeEditor();
    notice('Książka zapisana. Tapeta zaktualizuje się automatycznie.');
  } catch (e) {
    $('form-error').hidden = false;
    $('form-error').textContent = e.message;
    if (e.code === 'CONFLICT') {
      if (editing) reloadLatest.hidden = false;
      else {
        editorRevision = state.revision;
        editorSession = connectionSession;
      }
    }
    if (e.code === 'DUPLICATE') {
      $('edit-duplicate').hidden = false;
      $('edit-duplicate').onclick = () =>
        showEditor(state.books.find((b) => b.id === e.details.id));
    }
  } finally {
    $('save-book').disabled = false;
  }
};
try {
  const info = await api.bootstrap();
  receiveSessionMetadata(info);
  await refresh();
  restoreRoute();
  await refreshAi();
  if (info.recovery !== 'none' && info.recovery !== undefined)
    notice(
      info.recovery === 'backup'
        ? 'Odczytano poprzednią kopię. Sprawdź kolekcję przed zapisaniem.'
        : 'Kolekcja wymaga przywrócenia. Zaimportuj kopię w Ustawieniach.',
      true,
    );
  api.events(
    (revision) => revisionFeed.receive(revision),
    (connected) => {
      if (connected && $('notice').textContent.startsWith('Brak połączenia')) notice('');
      if (!connected)
        notice(
          'Brak połączenia z aplikacją. Uruchom Biblioteczkę ponownie, aby zapisywać zmiany.',
          true,
        );
    },
    () => refreshAi().catch((e) => notice(e.message, true)),
    () => clientUpgrade.available(),
    receiveSessionMetadata,
  );
} catch (e) {
  notice(e.message, true);
  $('add-book').disabled = true;
}
