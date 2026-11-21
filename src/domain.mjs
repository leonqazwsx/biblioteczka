import { localCalendarDate, normalizeReadDate } from '../public/shared/calendar-date.mjs';
import { DEFAULT_ROOM_ID, ROOM_SCENES } from '../public/shared/room-scene.mjs';
import { SORT_OPTIONS } from '../public/shared/book-order.mjs';
import { LIGHTING_OPTIONS } from '../public/shared/lighting.mjs';
import { normalizeRoomLayouts, cleanRoomLayouts } from '../public/shared/room-layout.mjs';
import { canonicalIsbn, createBookIdentityIndex } from '../public/shared/book-identity.mjs';
import { normalizeSpineFrame } from '../public/shared/spine-frame.mjs';
export function problem(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}
const invalid = (message) => {
  throw problem('INVALID', message);
};
const text = (v, label, max = 500) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    invalid(`Nieprawidłowe pole: ${label}.`);
  return v.trim();
};
const id = (v) => {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v))
    invalid('Nieprawidłowy identyfikator.');
  return v;
};
const optional = (v) => (v == null || v === '' ? null : text(v, 'dane wydania'));
const editionIsbn = (b) => canonicalIsbn(typeof b.isbn === 'string' ? b.isbn.trim() : b.isbn);
const statuses = ['to-read', 'reading', 'read'];
function integer(v, min = 0, max = 100000) {
  if (!Number.isSafeInteger(v) || v < min || v > max) invalid('Nieprawidłowa liczba.');
  return v;
}
function settings(v, books, shelves) {
  if (
    !v ||
    !['light', 'dark'].includes(v.theme) ||
    !['shelves', 'status', 'months'].includes(v.grouping) ||
    !Number.isFinite(v.iconSpace) ||
    v.iconSpace < 0 ||
    v.iconSpace > 0.3 ||
    typeof v.aiEnabled !== 'boolean' ||
    !ROOM_SCENES.some((s) => s.id === (v.room ?? DEFAULT_ROOM_ID)) ||
    !SORT_OPTIONS.some(([id]) => id === (v.sort ?? 'manual'))
  )
    invalid('Nieprawidłowe ustawienia.');
  const scales = v.bookScales === undefined ? {} : v.bookScales;
  if (
    !scales ||
    typeof scales !== 'object' ||
    Array.isArray(scales) ||
    Object.entries(scales).some(
      ([key, value]) =>
        !ROOM_SCENES.some((s) => s.id === key) ||
        !Number.isFinite(value) ||
        value < 0.6 ||
        value > 1.4,
    )
  )
    invalid('Nieprawidłowy rozmiar książek.');
  if (!LIGHTING_OPTIONS.some(([key]) => key === (v.lighting === undefined ? 'theme' : v.lighting)))
    invalid('Nieprawidłowe oświetlenie pokoju.');
  return {
    theme: v.theme,
    room: v.room ?? DEFAULT_ROOM_ID,
    grouping: v.grouping === 'months' ? 'months' : 'shelves',
    readingYear:
      v.readingYear === undefined ? new Date().getFullYear() : integer(v.readingYear, 1, 9999),
    iconSpace: v.iconSpace,
    aiEnabled: v.aiEnabled,
    sort: v.sort ?? 'manual',
    bookScales: { ...scales },
    lighting: v.lighting ?? 'theme',
    roomLayouts: normalizeRoomLayouts(v.roomLayouts, { books, shelves }),
  };
}
function hash(v) {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid('Nieprawidłowy obraz grzbietu.');
  return v;
}
function frame(v) {
  try {
    return normalizeSpineFrame(v);
  } catch (e) {
    invalid(e.message);
  }
}
function spine(v) {
  if (v == null) return null;
  if (!['ai', 'manual'].includes(v.kind)) invalid('Nieprawidłowe pochodzenie ilustracji.');
  const saved = {
      assetId: hash(v.assetId),
      kind: v.kind,
      sourceCoverId: v.sourceCoverId == null ? null : hash(v.sourceCoverId),
      model: v.kind === 'ai' ? text(v.model, 'model AI', 100) : null,
      promptVersion: v.kind === 'ai' ? text(v.promptVersion, 'wersja ilustracji', 100) : null,
    },
    crop = frame(v.frame);
  if (crop) saved.frame = crop;
  return saved;
}
function book(v, shelves) {
  if (!v || !Array.isArray(v.authors) || !v.authors.length || v.authors.length > 20)
    invalid('Podaj autora książki.');
  if (!shelves.some((s) => s.id === v.shelfId)) invalid('Wybierz istniejącą półkę.');
  if (!statuses.includes(v.status)) invalid('Nieprawidłowy status książki.');
  const isbn = optional(v.isbn);
  if (isbn) {
    if (!/^([0-9]{13}|[0-9]{9}[0-9X])$/.test(isbn)) invalid('Nieprawidłowy ISBN.');
    if (!canonicalIsbn(isbn)) invalid('Nieprawidłowa suma kontrolna ISBN.');
  }
  const palette = v.palette ?? [];
  if (
    !Array.isArray(palette) ||
    palette.length > 5 ||
    palette.some((c) => typeof c !== 'string' || !/^#[\da-fA-F]{6}$/.test(c))
  )
    invalid('Nieprawidłowe kolory.');
  const coverId = optional(v.coverId);
  if (coverId && !/^[a-f0-9]{64}$/.test(coverId)) invalid('Nieprawidłowa okładka.');
  const provider = v.provider ?? null;
  if (provider !== null && !['openlibrary', 'bn'].includes(provider))
    invalid('Nieprawidłowy katalog.');
  const goodreadsId = v.goodreadsId ?? null;
  if (goodreadsId !== null && (typeof goodreadsId !== 'string' || !/^\d{1,32}$/.test(goodreadsId)))
    invalid('Nieprawidłowy identyfikator Goodreads.');
  const subjects = v.subjects ?? [];
  if (!Array.isArray(subjects) || subjects.length > 80) invalid('Nieprawidłowe tematy książki.');
  return {
    id: id(v.id),
    title: text(v.title, 'tytuł'),
    authors: v.authors.map((a) => text(a, 'autor', 200)),
    isbn,
    goodreadsId,
    provider,
    providerId: optional(v.providerId),
    publisher: optional(v.publisher),
    publicationYear: optional(v.publicationYear),
    language: optional(v.language),
    pageCount: v.pageCount == null ? null : integer(v.pageCount, 1),
    subjects: subjects.map((s) => text(s, 'temat książki', 160)),
    shelfId: v.shelfId,
    status: 'read',
    readDate: normalizeReadDate(v.readDate),
    order: integer(v.order),
    coverId,
    palette: [...palette],
    spineStyle: integer(v.spineStyle ?? 0, 0, 5),
    spine: spine(v.spine),
    spineGeneration: integer(v.spineGeneration ?? 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
export function createInitialState() {
  return {
    schemaVersion: 2,
    collectionId: crypto.randomUUID(),
    revision: 0,
    books: [],
    shelves: ['Fantastyka', 'Kryminał', 'Pozostałe'].map((name, order) => ({
      id: ['fantasy', 'crime', 'other'][order],
      name,
      order,
    })),
    settings: {
      theme: 'light',
      room: DEFAULT_ROOM_ID,
      grouping: 'shelves',
      readingYear: new Date().getFullYear(),
      iconSpace: 0.2,
      aiEnabled: false,
      sort: 'manual',
      bookScales: {},
      lighting: 'theme',
      roomLayouts: {},
    },
  };
}
export function validateState(v) {
  if (
    !v ||
    v.schemaVersion !== 2 ||
    !Array.isArray(v.books) ||
    !Array.isArray(v.shelves) ||
    v.books.length > 10000 ||
    v.shelves.length > 200
  )
    invalid('Nieobsługiwany lub uszkodzony format kolekcji.');
  const shelves = v.shelves.map((s) => ({
    id: id(s.id),
    name: text(s.name, 'nazwa półki', 100),
    order: integer(s.order),
  }));
  if (new Set(shelves.map((s) => s.id)).size !== shelves.length)
    invalid('Powtórzone identyfikatory półek.');
  const books = v.books.map((b) => book(b, shelves));
  if (new Set(books.map((b) => b.id)).size !== books.length)
    invalid('Powtórzone identyfikatory książek.');
  for (const key of ['isbn', 'providerId', 'goodreadsId']) {
    const values = books.map((b) => b[key]).filter(Boolean);
    if (new Set(values).size !== values.length) invalid('Powtórzone wydania w kolekcji.');
  }
  return {
    schemaVersion: 2,
    collectionId: id(v.collectionId),
    revision: integer(v.revision, 0, Number.MAX_SAFE_INTEGER),
    books,
    shelves,
    settings: settings(v.settings, books, shelves),
  };
}
function find(items, wanted) {
  const item = items.find((x) => x.id === wanted);
  if (!item) throw problem('NOT_FOUND', 'Nie znaleziono wpisu.');
  return item;
}
function reindex(items) {
  items.forEach((x, i) => (x.order = i));
}
function requestedShelf(s, name, fallback) {
  if (name == null) return fallback;
  const cleaned = text(name, 'nazwa półki', 100),
    key = cleaned.toLocaleLowerCase('pl');
  let shelf = s.shelves.find((x) => x.name.toLocaleLowerCase('pl') === key);
  if (!shelf) {
    shelf = { id: crypto.randomUUID(), name: cleaned, order: s.shelves.length };
    s.shelves.push(shelf);
  }
  return shelf.id;
}
export function applyCommand(previous, cmd) {
  const s = validateState(previous);
  if (!cmd || typeof cmd.type !== 'string') invalid('Nieprawidłowe polecenie.');
  const previousIsbns = new Map(s.books.map((b) => [b.id, editionIsbn(b)]));
  switch (cmd.type) {
    case 'addBook': {
      const shelfId = requestedShelf(s, cmd.newShelfName, cmd.draft?.shelfId);
      const readDate = cmd.draft?.readDate === undefined ? localCalendarDate() : cmd.draft.readDate;
      s.books.push({
        ...cmd.draft,
        readDate,
        shelfId,
        id: crypto.randomUUID(),
        order: s.books.filter((b) => b.shelfId === shelfId).length,
        spine: null,
        spineGeneration: 0,
      });
      break;
    }
    case 'updateBook': {
      const b = find(s.books, cmd.id),
        source = b.shelfId,
        oldCover = b.coverId,
        patch = cmd.patch ?? {};
      const allowed = [
        'title',
        'authors',
        'isbn',
        'provider',
        'providerId',
        'publisher',
        'publicationYear',
        'language',
        'pageCount',
        'subjects',
        'shelfId',
        'status',
        'readDate',
        'coverId',
        'palette',
        'spineStyle',
        'spineFrame',
      ];
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.includes(key)) invalid('Nieprawidłowe pole książki.');
        if (key !== 'spineFrame') b[key] = value;
      }
      b.shelfId = requestedShelf(s, cmd.newShelfName, b.shelfId);
      if (b.coverId !== oldCover) {
        b.spine = null;
        b.spineGeneration++;
      }
      if (Object.hasOwn(patch, 'spineFrame')) {
        const requested = patch.spineFrame;
        if (
          !requested ||
          typeof requested !== 'object' ||
          Array.isArray(requested) ||
          Object.keys(requested).length !== 2 ||
          !Object.hasOwn(requested, 'frame') ||
          Object.keys(requested).some((k) => !['assetId', 'frame'].includes(k))
        )
          invalid('Nieprawidłowy kadr ilustracji.');
        const expectedAsset = hash(requested.assetId);
        if (!b.spine || b.spine.assetId !== expectedAsset)
          throw problem(
            'CONFLICT',
            'Ilustracja zmieniła się. Otwórz aktualną wersję książki przed zapisaniem kadru.',
          );
        const crop = frame(requested.frame);
        if (crop) b.spine.frame = crop;
        else delete b.spine.frame;
      }
      if (b.shelfId !== source) {
        find(s.shelves, b.shelfId);
        const dest = s.books
          .filter((x) => x.id !== b.id && x.shelfId === b.shelfId)
          .sort((a, b) => a.order - b.order);
        dest.push(b);
        reindex(dest);
        reindex(s.books.filter((x) => x.shelfId === source).sort((a, b) => a.order - b.order));
      }
      break;
    }
    case 'bulkUpdateBooks': {
      if (
        !Array.isArray(cmd.ids) ||
        !cmd.ids.length ||
        cmd.ids.length > 10000 ||
        new Set(cmd.ids).size !== cmd.ids.length
      )
        invalid('Wybierz książki bez powtórzeń.');
      const patch = cmd.patch ? { ...cmd.patch } : cmd.patch;
      if (
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch) ||
        !Object.keys(patch).length ||
        Object.keys(patch).some((key) => !['shelfId', 'status', 'readDate'].includes(key))
      )
        invalid('Nieprawidłowa zmiana zbiorcza.');
      const indexed = new Map(s.books.map((book) => [book.id, book]));
      const selected = cmd.ids.map((wanted) => {
        id(wanted);
        const b = indexed.get(wanted);
        if (!b) throw problem('NOT_FOUND', 'Wybrana książka została usunięta.');
        return b;
      });
      if ('shelfId' in patch) find(s.shelves, patch.shelfId);
      if ('status' in patch && !statuses.includes(patch.status))
        invalid('Nieprawidłowy status książki.');
      if ('readDate' in patch) patch.readDate = normalizeReadDate(patch.readDate);
      const moved = 'shelfId' in patch ? selected.filter((b) => b.shelfId !== patch.shelfId) : [];
      const sourceIds = new Set(moved.map((b) => b.shelfId));
      const destination =
        'shelfId' in patch
          ? s.books.filter((b) => b.shelfId === patch.shelfId).sort((a, b) => a.order - b.order)
          : [];
      for (const b of selected) Object.assign(b, patch);
      for (const source of sourceIds)
        reindex(s.books.filter((b) => b.shelfId === source).sort((a, b) => a.order - b.order));
      if (moved.length) reindex([...destination, ...moved]);
      break;
    }
    case 'setBookSpine': {
      const b = find(s.books, cmd.id);
      b.spine = spine(cmd.spine);
      b.spineGeneration++;
      break;
    }
    case 'deleteBook': {
      const b = find(s.books, cmd.id);
      s.books = s.books.filter((b) => b.id !== cmd.id);
      s.settings.roomLayouts = cleanRoomLayouts(s.settings.roomLayouts, {
        removedBookIds: [cmd.id],
      });
      reindex(s.books.filter((x) => x.shelfId === b.shelfId).sort((a, b) => a.order - b.order));
      break;
    }
    case 'addShelf':
      s.shelves.push({ id: crypto.randomUUID(), name: cmd.name, order: s.shelves.length });
      break;
    case 'renameShelf':
      find(s.shelves, cmd.id).name = cmd.name;
      break;
    case 'deleteShelf': {
      find(s.shelves, cmd.id);
      const affected = s.books.filter((b) => b.shelfId === cmd.id);
      if (affected.length) {
        if (cmd.targetId === cmd.id || !s.shelves.some((x) => x.id === cmd.targetId))
          invalid('Wybierz półkę docelową dla książek.');
        let order = s.books.filter((b) => b.shelfId === cmd.targetId).length;
        affected.forEach((b) => {
          b.shelfId = cmd.targetId;
          b.order = order++;
        });
      }
      s.shelves = s.shelves.filter((x) => x.id !== cmd.id);
      s.settings.roomLayouts = cleanRoomLayouts(s.settings.roomLayouts, {
        removedShelfIds: [cmd.id],
      });
      reindex(s.shelves);
      break;
    }
    case 'reorderShelves': {
      if (
        !Array.isArray(cmd.ids) ||
        cmd.ids.length !== s.shelves.length ||
        new Set(cmd.ids).size !== s.shelves.length
      )
        invalid('Nieprawidłowa kolejność półek.');
      s.shelves = cmd.ids.map((x) => find(s.shelves, x));
      reindex(s.shelves);
      break;
    }
    case 'moveBook': {
      const b = find(s.books, cmd.id);
      find(s.shelves, cmd.shelfId);
      const source = b.shelfId;
      const others = s.books
        .filter((x) => x.id !== b.id && x.shelfId === cmd.shelfId)
        .sort((a, b) => a.order - b.order);
      const index = integer(cmd.index, 0, others.length);
      b.shelfId = cmd.shelfId;
      others.splice(index, 0, b);
      reindex(others);
      if (source !== cmd.shelfId)
        reindex(s.books.filter((x) => x.shelfId === source).sort((a, b) => a.order - b.order));
      break;
    }
    case 'updateSettings': {
      const p = cmd.patch ?? {};
      if (
        Object.keys(p).some(
          (k) =>
            ![
              'theme',
              'room',
              'grouping',
              'readingYear',
              'iconSpace',
              'aiEnabled',
              'sort',
              'bookScales',
              'lighting',
            ].includes(k),
        )
      )
        invalid('Nieprawidłowe ustawienie.');
      s.settings = { ...s.settings, ...p };
      break;
    }
    case 'setRoomLayout': {
      if (typeof cmd.roomId !== 'string') invalid('Nieprawidłowy pokój.');
      s.settings.roomLayouts = normalizeRoomLayouts(
        { ...s.settings.roomLayouts, [cmd.roomId]: cmd.layout },
        { books: s.books, shelves: s.shelves },
      );
      break;
    }
    default:
      invalid('Nieznane polecenie.');
  }
  // Keep historical ISBN10/13 pairs editable; only newly introduced identities conflict.
  for (const b of s.books) {
    const isbn = editionIsbn(b);
    if (!isbn || previousIsbns.get(b.id) === isbn) continue;
    const duplicate = s.books.find((other) => other.id !== b.id && editionIsbn(other) === isbn);
    if (duplicate)
      throw problem('DUPLICATE', 'To wydanie jest już w biblioteczce.', {
        id: duplicate.id,
        reason: 'isbn',
      });
  }
  for (const key of ['isbn', 'providerId', 'goodreadsId']) {
    const seen = new Map();
    for (const b of s.books) {
      if (b[key] && seen.has(b[key]))
        throw problem('DUPLICATE', 'To wydanie jest już w biblioteczce.', { id: seen.get(b[key]) });
      if (b[key]) seen.set(b[key], b.id);
    }
  }
  s.revision++;
  return validateState(s);
}
export function appendImportedBooks(previous, drafts) {
  if (!Array.isArray(drafts) || !drafts.length) invalid('Wybierz książki do dołączenia.');
  const s = validateState(previous);
  if (s.books.length + drafts.length > 10000)
    throw problem('TOO_LARGE', 'Kolekcja może zawierać maksymalnie 10000 książek.');
  const identities = createBookIdentityIndex(s.books),
    orders = new Map();
  for (const b of s.books) orders.set(b.shelfId, Math.max(orders.get(b.shelfId) ?? 0, b.order + 1));
  const allowed = new Set([
    'title',
    'authors',
    'isbn',
    'goodreadsId',
    'publisher',
    'publicationYear',
    'pageCount',
    'status',
    'readDate',
    'subjects',
    'provider',
    'providerId',
    'language',
    'coverId',
    'palette',
    'spineStyle',
    'spine',
    'spineGeneration',
    'shelfId',
    'newShelfName',
  ]);
  for (const draft of drafts) {
    if (
      !draft ||
      typeof draft !== 'object' ||
      Array.isArray(draft) ||
      Object.keys(draft).some((k) => !allowed.has(k))
    )
      invalid('Nieprawidłowe dane importu.');
    for (const k of ['provider', 'providerId', 'language', 'coverId', 'spine'])
      if (draft[k] != null) invalid('Import CSV nie dołącza katalogu ani obrazów.');
    if (
      (draft.palette !== undefined && (!Array.isArray(draft.palette) || draft.palette.length)) ||
      (draft.spineGeneration != null && draft.spineGeneration !== 0) ||
      (draft.spineStyle != null && draft.spineStyle !== 0)
    )
      invalid('Nieprawidłowe dane grzbietu importu.');
    const hasShelf = typeof draft.shelfId === 'string' && !!draft.shelfId,
      hasNew = typeof draft.newShelfName === 'string' && !!draft.newShelfName.trim();
    if (
      hasShelf === hasNew ||
      (draft.shelfId != null && !hasShelf) ||
      (draft.newShelfName != null && !hasNew)
    )
      invalid('Wybierz jedną półkę dla książki.');
    const shelfId = requestedShelf(s, hasNew ? draft.newShelfName : null, draft.shelfId);
    if (s.shelves.length > 200)
      throw problem('TOO_LARGE', 'Kolekcja może zawierać maksymalnie 200 półek.');
    const candidate = book(
      {
        ...draft,
        id: crypto.randomUUID(),
        shelfId,
        order: orders.get(shelfId) ?? 0,
        coverId: null,
        palette: [],
        spine: null,
        spineGeneration: 0,
      },
      s.shelves,
    );
    const duplicate = identities.find(candidate);
    if (duplicate)
      throw problem('DUPLICATE', 'Ta książka jest już w biblioteczce.', {
        id: duplicate.id,
        reason: duplicate.reason,
      });
    s.books.push(candidate);
    identities.add(candidate);
    orders.set(shelfId, candidate.order + 1);
  }
  s.revision++;
  return validateState(s);
}
