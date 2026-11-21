const failure = (message) => {
  throw new Error(message);
};
export function createGoodreadsImportController({
  request,
  onImported = () => {},
  onDirtyChange = () => {},
  now = Date.now,
}) {
  let preview = null,
    byId = new Map(),
    selected = new Set(),
    overrides = new Map(),
    page = 0,
    loading = false,
    saving = false,
    stale = false,
    latest = null,
    message = '',
    error = false,
    wasDirty = false;
  const dirty = () => loading || preview !== null;
  const expired = () => preview !== null && preview.expiresAt <= now();
  const isStale = () => stale || expired();
  function notify() {
    const next = dirty();
    if (next !== wasDirty) {
      wasDirty = next;
      onDirtyChange(next);
    }
  }
  function idle() {
    if (loading || saving) failure('Poczekaj na zakończenie odczytu lub zapisu.');
  }
  function row(id) {
    const result = byId.get(id);
    if (!result?.selectable) failure('Ta pozycja nie może być wybrana.');
    return result;
  }
  function receive(state) {
    latest = state;
    if (
      preview &&
      (state.collectionId !== preview.collectionId || state.revision !== preview.revision)
    )
      stale = true;
  }
  return {
    async load(base64) {
      idle();
      loading = true;
      message = '';
      error = false;
      notify();
      try {
        const next = await request('/api/goodreads/preview', { method: 'POST', body: { base64 } });
        preview = next;
        byId = new Map(next.rows.map((r) => [r.rowId, r]));
        selected = new Set(next.rows.filter((r) => r.selectable).map((r) => r.rowId));
        overrides = new Map();
        page = 0;
        stale = false;
        if (latest) receive(latest);
        return next;
      } catch (e) {
        message = e.message;
        error = true;
        throw e;
      } finally {
        loading = false;
        notify();
      }
    },
    receive,
    select(id, value) {
      idle();
      row(id);
      if (typeof value !== 'boolean') failure('Nieprawidłowy wybór.');
      if (value) selected.add(id);
      else selected.delete(id);
    },
    selectAll(value) {
      idle();
      if (typeof value !== 'boolean') failure('Nieprawidłowy wybór.');
      selected = new Set(
        value ? (preview?.rows ?? []).filter((r) => r.selectable).map((r) => r.rowId) : [],
      );
    },
    override(id, patch) {
      idle();
      const current = row(id);
      if (
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch) ||
        Object.keys(patch).some((k) => !['status', 'shelfId', 'newShelfName'].includes(k))
      )
        failure('Nieprawidłowa zmiana pozycji.');
      const next = {
        status: current.candidate.status,
        shelfId: current.candidate.shelfId,
        newShelfName: current.candidate.newShelfName,
        ...overrides.get(id),
        ...patch,
      };
      if (next.status !== 'read' || !!next.shelfId === !!next.newShelfName)
        failure('Wybierz gatunek przeczytanej książki.');
      overrides.set(id, next);
    },
    setPage(value) {
      idle();
      const count = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 50));
      if (!Number.isSafeInteger(value) || value < 0 || value >= count)
        failure('Nieprawidłowa strona podglądu.');
      page = value;
    },
    async confirm() {
      idle();
      if (!preview || !selected.size) failure('Wybierz książki do dołączenia.');
      if (isStale()) failure('Podgląd wygasł lub kolekcja zmieniła się. Wczytaj CSV ponownie.');
      saving = true;
      message = '';
      error = false;
      const body = {
        importId: preview.importId,
        expectedRevision: preview.revision,
        selectedRowIds: [...selected],
        overrides: Object.fromEntries([...overrides].filter(([id]) => selected.has(id))),
      };
      try {
        const result = await request('/api/goodreads/confirm', { method: 'POST', body });
        await onImported(result);
        message = `Dołączono ${selected.size} książek. Pominięto ${preview.summary.duplicates} duplikatów i ${preview.summary.invalid} błędnych pozycji.`;
        preview = null;
        byId = new Map();
        selected = new Set();
        overrides = new Map();
        page = 0;
        stale = false;
        return result;
      } catch (e) {
        if (e.code === 'CONFLICT' || (e.code === 'INVALID' && /wygas/.test(e.message)))
          stale = true;
        message =
          !e.code ||
          ![
            'CONFLICT',
            'INVALID',
            'DUPLICATE',
            'TOO_LARGE',
            'FORBIDDEN',
            'RECOVERY_REQUIRED',
          ].includes(e.code)
            ? 'Nie otrzymano potwierdzenia zapisu. Zapis mógł się udać. Sprawdź kolekcję i wczytaj CSV ponownie; duplikaty zostaną pominięte.'
            : e.message;
        error = true;
        throw e;
      } finally {
        saving = false;
        notify();
      }
    },
    discard() {
      idle();
      preview = null;
      byId = new Map();
      selected = new Set();
      overrides = new Map();
      page = 0;
      stale = false;
      message = 'Podgląd odrzucono. Kolekcja pozostała bez zmian.';
      error = false;
      notify();
    },
    get snapshot() {
      return {
        preview,
        rows: preview?.rows.slice(page * 50, page * 50 + 50) ?? [],
        selectedRowIds: [...selected],
        overrides: Object.fromEntries(overrides),
        page,
        pageCount: Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 50)),
        loading,
        saving,
        stale: isStale(),
        message,
        error,
      };
    },
    get isDirty() {
      return dirty();
    },
    get saving() {
      return loading || saving;
    },
    get stale() {
      return isStale();
    },
  };
}
