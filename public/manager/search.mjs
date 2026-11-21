import { canonicalIsbn } from '../shared/book-identity.mjs';
// Owns only suggestions. Selecting a book and saving the editor remain independent.
export function createSearchController({
  search,
  onState,
  delay = 450,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer,
    revision = 0,
    controller,
    activeQuery = '',
    currentState = { status: 'idle', items: [], nextCursor: null, warnings: [] },
    busy = false;
  const publish = (state) => {
    currentState = state;
    onState(state);
  };
  function cancel() {
    revision++;
    clearTimer(timer);
    controller?.abort();
    controller = null;
  }
  async function run(query, current, cursor = null) {
    controller = new AbortController();
    const signal = controller.signal;
    const previous = cursor ? currentState : { items: [], warnings: [], nextCursor: null };
    busy = true;
    publish({ ...previous, status: cursor ? 'loading-more' : 'loading', message: null });
    try {
      const response = await search(query, signal, cursor);
      if (current !== revision) return;
      const page = Array.isArray(response)
        ? { items: response, nextCursor: null, warnings: [] }
        : response;
      const items = [],
        seen = new Set();
      for (const item of [...previous.items, ...page.items]) {
        const key =
          canonicalIsbn(item.isbn) ?? item.id ?? JSON.stringify([item.title, item.authors]);
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
      publish({
        status: 'ready',
        items,
        nextCursor: page.nextCursor ?? null,
        warnings: [...new Set([...previous.warnings, ...(page.warnings ?? [])])],
        message: null,
      });
    } catch (e) {
      if (current === revision && !signal.aborted)
        publish(
          cursor
            ? { ...previous, status: 'ready', message: e.message }
            : { status: 'error', items: [], nextCursor: null, warnings: [], message: e.message },
        );
    } finally {
      if (current === revision) busy = false;
    }
  }
  function schedule(value, immediate) {
    cancel();
    busy = false;
    const query = value.trim(),
      current = revision;
    activeQuery = query;
    if (query.length < 2) {
      publish({ status: 'idle', items: [], nextCursor: null, warnings: [] });
      return;
    }
    if (immediate) return run(query, current);
    publish({ status: 'waiting', items: [], nextCursor: null, warnings: [] });
    timer = setTimer(() => run(query, current), delay);
  }
  return {
    input: (value) => schedule(value, false),
    submit: (value) => schedule(value, true),
    cancel,
    more: () => {
      if (!busy && currentState.nextCursor)
        return run(activeQuery, revision, currentState.nextCursor);
    },
  };
}
