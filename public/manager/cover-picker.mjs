import { t } from '../shared/i18n.mjs';
let pickerNumber = 0;
const languages = {
  pol: 'polski',
  pl: 'polski',
  eng: 'angielski',
  en: 'angielski',
  ger: 'niemiecki',
  deu: 'niemiecki',
  de: 'niemiecki',
  fre: 'francuski',
  fra: 'francuski',
  fr: 'francuski',
  spa: t('hiszpański'),
  es: t('hiszpański'),
};
const sources = { openlibrary: 'Open Library', inventaire: 'Inventaire' };

function snapshot(value) {
  if (!value?.book || value.identity == null) return null;
  const book = value.book;
  return {
    identity: value.identity,
    coverId: value.coverId ?? null,
    book: {
      title: book.title ?? '',
      authors: Array.isArray(book.authors) ? [...book.authors] : [],
      isbn: book.isbn ?? null,
      providerId: book.providerId ?? null,
      catalogCoverId: book.catalogCoverId ?? null,
    },
  };
}

const contextKey = (value) =>
  value ? JSON.stringify([value.identity, value.book, value.coverId]) : null;
const sameBook = (a, b) =>
  a && b && a.identity === b.identity && JSON.stringify(a.book) === JSON.stringify(b.book);
const expired = (error) =>
  error?.status === 404 || error?.status === 410 || /(?:EXPIRED|NOT_FOUND)/.test(error?.code ?? '');

/** Inline, draft-only cover selection. The caller owns the editor and final book save. */
export function createCoverPicker(
  root,
  { request, getContext, onApply, onBusy = () => {}, onError = () => {} },
) {
  const doc = root.ownerDocument ?? globalThis.document;
  const element = (tag, className = '', text = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const button = (className, text) => {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  };
  const container = element('section', 'cover-picker');
  const action = button('text-button cover-picker-action', t('Znajdź okładkę'));
  const status = element('p', 'cover-picker-status');
  const retry = button('text-button cover-picker-retry', t('Spróbuj ponownie'));
  const panel = element('div', 'cover-picker-panel');
  const note = element(
    'p',
    'cover-picker-note',
    t('Wybór grafiki zmienia tylko okładkę. Dane wydania pozostają bez zmian.'),
  );
  const grid = element('div', 'cover-picker-grid');
  const close = button('text-button cover-picker-close', t('Zwiń propozycje'));
  panel.id = 'cover-picker-' + ++pickerNumber;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('Propozycje okładek'));
  action.setAttribute('aria-controls', panel.id);
  action.setAttribute('aria-expanded', 'false');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  retry.hidden = true;
  panel.hidden = true;
  panel.append(note, grid, close);
  container.append(action, status, retry, panel);
  root.append(container);

  let generation = 0,
    searchController = null,
    selectController = null,
    busyOwner = null;
  let destroyed = false,
    gallery = null,
    automaticAttempt = null;
  let cards = [];
  const context = () => snapshot(getContext());
  const mounted = () => !destroyed && root.isConnected !== false && root.contains(container);
  const current = (ticket, original) =>
    mounted() && ticket === generation && contextKey(context()) === contextKey(original);
  function syncAction() {
    const value = context();
    action.textContent = value?.coverId ? t('Wybierz inną okładkę') : t('Znajdź okładkę');
    action.disabled = !value || destroyed;
  }
  function feedback(text = '', canRetry = false) {
    status.textContent = text;
    status.hidden = !text;
    retry.hidden = !canRetry;
  }
  function selectionFailed(error) {
    feedback(
      expired(error)
        ? t('Propozycja okładki wygasła. Wyszukaj ponownie lub dodaj plik albo link.')
        : t('Wybrana okładka jest chwilowo niedostępna. Spróbuj ponownie lub wybierz inną.'),
      true,
    );
    onError(error);
  }
  function setOpen(open, focus = false) {
    panel.hidden = !open;
    action.setAttribute('aria-expanded', String(open));
    if (!open && focus) action.focus({ preventScroll: true });
  }
  function finishBusy(ticket) {
    if (busyOwner !== ticket) return;
    busyOwner = null;
    onBusy(false);
  }
  function invalidate() {
    generation++;
    searchController?.abort();
    selectController?.abort();
    searchController = null;
    selectController = null;
    if (busyOwner !== null) finishBusy(busyOwner);
  }
  function cancel() {
    invalidate();
    gallery = null;
    cards = [];
    grid.replaceChildren();
    feedback();
    setOpen(false);
    syncAction();
  }
  function showResults(data, original) {
    const seenIds = new Set(),
      seenPreviews = new Set();
    cards = [];
    grid.replaceChildren();
    for (const candidate of Array.isArray(data.candidates) ? data.candidates : []) {
      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        seenIds.has(candidate.id)
      )
        continue;
      // Only the API's own opaque preview route may become an image source.
      const localPreview =
        '/api/cover-search/' +
        encodeURIComponent(data.searchId) +
        '/' +
        encodeURIComponent(candidate.id);
      if (candidate.previewUrl !== localPreview || seenPreviews.has(candidate.previewUrl)) continue;
      seenIds.add(candidate.id);
      seenPreviews.add(candidate.previewUrl);
      const choice = button('cover-picker-card', '');
      const image = element('img', 'cover-picker-image');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = 120;
      image.height = 180;
      const copy = element('span', 'cover-picker-copy');
      const title = element(
        'strong',
        'cover-picker-title',
        candidate.title || original.book.title || t('Okładka książki'),
      );
      const hasEdition = !!(
        candidate.isbn ||
        candidate.publisher ||
        candidate.publicationYear ||
        candidate.language
      );
      const match =
        candidate.match === 'edition'
          ? t('Wybrane wydanie')
          : hasEdition
            ? t('Inne wydanie tej książki')
            : t('Inna okładka tej książki · wydanie nieustalone');
      const edition = element('span', 'cover-picker-edition', match);
      const language = candidate.language
        ? t('Język: ') + (languages[candidate.language] ?? candidate.language)
        : t('Język nieustalony');
      const publication =
        [candidate.publisher, candidate.publicationYear].filter(Boolean).join(' · ') ||
        t('Wydawca i rok nieustalone');
      const metadata = element('span', 'cover-picker-metadata', language + ' · ' + publication);
      const source = element(
        'span',
        'cover-picker-source',
        candidate.source
          ? t('Źródło: ') + (sources[candidate.source] ?? candidate.source)
          : t('Źródło nieustalone'),
      );
      const unavailable = element('span', 'cover-picker-unavailable', t('Podgląd niedostępny'));
      unavailable.hidden = true;
      copy.append(title, edition, metadata, source, unavailable);
      choice.append(image, copy);
      const card = { candidate, button: choice, broken: false, importing: false };
      choice.onclick = () => select(card);
      image.onerror = () => {
        if (!mounted() || !cards.includes(card) || card.broken) return;
        card.broken = true;
        choice.disabled = true;
        choice.hidden = true;
        image.hidden = true;
        unavailable.hidden = false;
        const available = cards.filter((item) => !item.broken);
        feedback(
          available.length
            ? t('Niektóre podglądy są niedostępne. Pozostałe okładki nadal można wybrać.')
            : t('Nie udało się wczytać podglądów. Spróbuj ponownie lub dodaj plik albo link.'),
          true,
        );
        if (doc.activeElement === choice)
          (available[0]?.button ?? action).focus({ preventScroll: true });
      };
      image.src = localPreview;
      cards.push(card);
      grid.append(choice);
      if (cards.length === 12) break;
    }
    gallery = { searchId: data.searchId, context: original };
    const warnings = Array.isArray(data.warnings) && data.warnings.length > 0;
    if (warnings && cards.length)
      feedback(
        t('Część źródeł jest chwilowo niedostępna. Dostępne okładki nadal można wybrać.'),
        true,
      );
    else if (warnings)
      feedback(
        t('Źródła okładek są chwilowo niedostępne. Spróbuj ponownie lub dodaj plik albo link.'),
        true,
      );
    else if (!cards.length)
      feedback(t('Nie znaleziono okładek tej książki. Możesz dodać plik lub wkleić link.'), true);
    else feedback(t('Dostępne propozycje: ') + cards.length + t('. Wybierz okładkę poniżej.'));
  }
  async function select(card, { automatic = false, ticket: searchTicket } = {}) {
    if (!mounted() || !cards.includes(card) || card.importing || !gallery)
      return { status: 'stale' };
    if (card.broken) return { status: 'unavailable' };
    const original = context();
    if (!original || contextKey(original) !== contextKey(gallery.context))
      return { status: 'stale' };
    if (
      automatic &&
      (original.coverId || searchTicket !== generation || card.candidate.match !== 'edition')
    )
      return { status: 'stale' };
    if (!automatic) invalidate();
    const ticket = generation,
      controller = new AbortController();
    selectController = controller;
    card.importing = true;
    card.button.disabled = true;
    busyOwner = ticket;
    onBusy(true);
    feedback(t('Pobieram wybraną okładkę…'));
    try {
      const image = await request('/api/covers', {
        method: 'POST',
        body: { searchId: gallery.searchId, candidateId: card.candidate.id },
        signal: controller.signal,
      });
      if (!current(ticket, original) || controller.signal.aborted) return { status: 'stale' };
      if (!image?.coverId) throw new Error(t('Nie udało się pobrać wybranej okładki.'));
      await onApply(image, {
        ...original,
        isCurrent: () => current(ticket, original) && !controller.signal.aborted,
      });
      if (
        !mounted() ||
        generation !== ticket ||
        controller.signal.aborted ||
        !sameBook(context(), original)
      )
        return { status: 'stale' };
      gallery.context = context();
      syncAction();
      feedback(t('Okładka wybrana. Zapisz książkę, aby zachować zmianę.'));
      return { status: 'applied' };
    } catch (error) {
      if (!current(ticket, original) || controller.signal.aborted) return { status: 'stale' };
      if (!automatic) selectionFailed(error);
      return { status: expired(error) ? 'expired' : 'unavailable', error };
    } finally {
      card.importing = false;
      card.button.disabled = card.broken;
      if (selectController === controller) selectController = null;
      finishBusy(ticket);
    }
  }
  async function search({ automatic = false } = {}) {
    if (!mounted()) return;
    const original = context();
    syncAction();
    if (!original) return;
    const key = contextKey(original);
    if (automatic && (original.coverId || automaticAttempt === key)) return;
    if (automatic) automaticAttempt = key;
    invalidate();
    const ticket = generation;
    gallery = null;
    cards = [];
    grid.replaceChildren();
    if (!automatic) setOpen(true);
    if (
      !original.book.isbn &&
      !(original.book.title.trim() && original.book.authors.some((author) => author.trim()))
    ) {
      feedback(t('Podaj ISBN lub tytuł i autora, aby znaleźć okładkę.'));
      return;
    }
    const controller = new AbortController();
    searchController = controller;
    feedback(t('Szukam okładek…'));
    try {
      const data = await request('/api/cover-search', {
        method: 'POST',
        body: original.book,
        signal: controller.signal,
      });
      if (!current(ticket, original) || controller.signal.aborted) return;
      showResults(data, original);
      if (automatic && data.automaticId) {
        const exact = cards.find(
          (card) => card.candidate.id === data.automaticId && card.candidate.match === 'edition',
        );
        if (exact) {
          const attempts = [
            exact,
            ...cards.filter((card) => card !== exact && card.candidate.match === 'edition'),
          ];
          let failure;
          for (const card of attempts) {
            if (!current(ticket, original) || controller.signal.aborted) return;
            const outcome = await select(card, { automatic: true, ticket });
            if (outcome.status === 'applied' || outcome.status === 'stale') return;
            if (outcome.error) failure = outcome.error;
            if (outcome.status === 'expired') break;
          }
          if (failure && current(ticket, original) && !controller.signal.aborted)
            selectionFailed(failure);
        }
      }
    } catch (error) {
      if (!current(ticket, original) || controller.signal.aborted) return;
      feedback(
        t('Źródła okładek są chwilowo niedostępne. Spróbuj ponownie lub dodaj plik albo link.'),
        true,
      );
      onError(error);
    } finally {
      if (searchController === controller) searchController = null;
    }
  }
  action.onclick = () => {
    if (!mounted()) return;
    syncAction();
    if (!panel.hidden) {
      setOpen(false, true);
      return;
    }
    if (gallery && contextKey(context()) === contextKey(gallery.context)) {
      setOpen(true);
      return;
    }
    return search();
  };
  retry.onclick = () => search();
  close.onclick = () => setOpen(false, true);
  syncAction();
  return {
    search,
    cancel,
    reset() {
      cancel();
      automaticAttempt = null;
    },
    destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
      root.replaceChildren(...Array.from(root.children).filter((node) => node !== container));
    },
  };
}
