import { getRoomScene } from '../shared/room-scene.mjs';
import { normalizeRoomLayouts } from '../shared/room-layout.mjs';
const empty = () => ({ enabled: false, cavities: {}, placements: {} });
const conflict = () =>
  Object.assign(
    new Error(
      'Kolekcja lub sesja zmieniła się. Szkic zachowano. Cofnij zmiany, aby wczytać aktualną wersję.',
    ),
    { code: 'CONFLICT' },
  );
export function createRoomLayoutController(initial) {
  let saved,
    latest,
    roomId,
    revision,
    baseline,
    draft,
    selected,
    saving = false,
    invalidated = false;
  const load = (state) => {
    saved = structuredClone(state);
    latest = saved;
    roomId = saved.settings.room;
    revision = saved.revision;
    baseline = structuredClone(saved.settings.roomLayouts?.[roomId] ?? empty());
    draft = structuredClone(baseline);
    selected = getRoomScene(roomId).slots[0].id;
    invalidated = false;
  };
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(baseline);
  const stale = () =>
    invalidated ||
    latest.collectionId !== saved.collectionId ||
    latest.revision !== revision ||
    JSON.stringify(latest.settings.roomLayouts?.[roomId] ?? empty()) !== JSON.stringify(baseline);
  const mutate = (fn) => {
    if (saving) throw new Error('Poczekaj na zakończenie zapisu.');
    const next = structuredClone(draft);
    fn(next);
    draft = normalizeRoomLayouts({ [roomId]: next }, saved)[roomId];
  };
  const entries = (slot) =>
    Object.entries(draft.placements)
      .filter(([, p]) => p.slotId === slot)
      .sort(([a, x], [b, y]) => x.order - y.order || a.localeCompare(b));
  load(initial);
  return {
    get roomId() {
      return roomId;
    },
    get revision() {
      return revision;
    },
    get slots() {
      return getRoomScene(roomId).slots;
    },
    get selectedSlot() {
      return selected;
    },
    get layout() {
      return structuredClone(draft);
    },
    get state() {
      return structuredClone(saved);
    },
    get dirty() {
      return dirty();
    },
    get stale() {
      return stale();
    },
    get saving() {
      return saving;
    },
    select(id) {
      if (!getRoomScene(roomId).slots.some((s) => s.id === id)) throw new Error('Nieznana wnęka.');
      selected = id;
    },
    setEnabled(enabled) {
      mutate((d) => (d.enabled = enabled));
    },
    setCavity(patch) {
      mutate(
        (d) =>
          (d.cavities[selected] = {
            source: null,
            decoration: null,
            ...d.cavities[selected],
            ...patch,
          }),
      );
    },
    place(id) {
      mutate((d) => {
        const orders = entries(selected)
          .filter(([bookId]) => bookId !== id)
          .map(([, p]) => p.order);
        d.placements[id] = { slotId: selected, order: orders.length ? Math.max(...orders) + 1 : 0 };
      });
    },
    remove(id) {
      mutate((d) => delete d.placements[id]);
    },
    shift(id, delta) {
      const placement = draft.placements[id];
      if (!placement) return;
      const items = entries(placement.slotId),
        index = items.findIndex(([bookId]) => bookId === id),
        target = index + delta;
      if (target < 0 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      mutate((d) => items.forEach(([bookId], order) => (d.placements[bookId].order = order)));
    },
    booksInSlot() {
      return entries(selected).map(([id]) => saved.books.find((b) => b.id === id));
    },
    preview() {
      const s = structuredClone(saved);
      s.settings.roomLayouts = { ...s.settings.roomLayouts, [roomId]: structuredClone(draft) };
      return s;
    },
    receive(next, { local = false, sessionChanged = false } = {}) {
      if (!dirty() && !saving) {
        load(next);
        return;
      }
      if (
        sessionChanged ||
        next.collectionId !== saved.collectionId ||
        next.revision < latest.revision
      )
        invalidated = true;
      latest = structuredClone(next);
      if (
        local &&
        !saving &&
        !invalidated &&
        next.collectionId === saved.collectionId &&
        JSON.stringify(next.settings.roomLayouts?.[roomId] ?? empty()) === JSON.stringify(baseline)
      ) {
        try {
          normalizeRoomLayouts({ [roomId]: draft }, next);
        } catch {
          return;
        }
        saved = structuredClone(next);
        saved.settings.room = roomId;
        revision = next.revision;
      }
    },
    discard() {
      if (saving) return;
      load(latest);
    },
    reset() {
      mutate((d) => {
        d.enabled = false;
        d.cavities = {};
        d.placements = {};
      });
    },
    async save(send) {
      if (saving) throw new Error('Trwa zapis.');
      if (stale()) throw conflict();
      saving = true;
      try {
        const result = await send(
          { type: 'setRoomLayout', roomId, layout: structuredClone(draft) },
          revision,
        );
        if (invalidated) throw conflict();
        load(latest.revision > result.revision ? latest : result);
        return result;
      } finally {
        saving = false;
      }
    },
  };
}
