import test from 'node:test';
import assert from 'node:assert/strict';
const { createSearchController } = await import('../public/manager/search.mjs').catch(() => ({}));
function scheduler() {
  let n = 0;
  const timers = new Map();
  return {
    setTimer: (fn) => {
      timers.set(++n, fn);
      return n;
    },
    clearTimer: (id) => timers.delete(id),
    fire: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
test('typing searches only the last query after a pause and clears short input', async () => {
  assert.equal(typeof createSearchController, 'function');
  const timer = scheduler(),
    states = [],
    queries = [];
  const c = createSearchController({
    ...timer,
    search: async (q) => {
      queries.push(q);
      return [{ title: q }];
    },
    onState: (s) => states.push(s),
  });
  c.input('So');
  c.input('Solaris');
  timer.fire();
  await flush();
  assert.deepEqual(queries, ['Solaris']);
  assert.equal(states.at(-1).items[0].title, 'Solaris');
  c.input('S');
  timer.fire();
  await flush();
  assert.deepEqual(queries, ['Solaris']);
  assert.equal(states.at(-1).status, 'idle');
  assert.deepEqual(states.at(-1).items, []);
});
test('a slow response never replaces suggestions for a newer query', async () => {
  assert.equal(typeof createSearchController, 'function');
  const timer = scheduler(),
    states = [];
  let oldResolve;
  const c = createSearchController({
    ...timer,
    search: (q) =>
      q === 'Lem' ? new Promise((r) => (oldResolve = r)) : Promise.resolve([{ title: 'Lalka' }]),
    onState: (s) => states.push(s),
  });
  c.input('Lem');
  timer.fire();
  c.input('Prus');
  timer.fire();
  await flush();
  oldResolve([{ title: 'Solaris' }]);
  await flush();
  assert.equal(states.at(-1).items[0].title, 'Lalka');
});
test('closing or selecting cancels pending work and does not publish late errors', async () => {
  assert.equal(typeof createSearchController, 'function');
  const timer = scheduler(),
    states = [];
  let reject;
  const c = createSearchController({
    ...timer,
    search: () => new Promise((_, r) => (reject = r)),
    onState: (s) => states.push(s),
  });
  c.input('Lem');
  timer.fire();
  c.cancel();
  const count = states.length;
  reject(new Error('offline'));
  await flush();
  assert.equal(states.length, count);
  c.input('Prus');
  c.cancel();
  timer.fire();
  assert.equal(states.length, count + 1);
});
test('explicit search runs immediately and exposes a catalog error', async () => {
  assert.equal(typeof createSearchController, 'function');
  const timer = scheduler(),
    states = [];
  const c = createSearchController({
    ...timer,
    search: async () => {
      throw new Error('Offline');
    },
    onState: (s) => states.push(s),
  });
  c.input('Solaris');
  c.submit('Solaris');
  await flush();
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).message, 'Offline');
});

test('load more appends unique results, retains partial warnings, and passes the opaque cursor', async () => {
  const states = [],
    calls = [];
  const c = createSearchController({
    onState: (s) => states.push(s),
    search: async (q, signal, cursor) => {
      calls.push({ q, cursor });
      return cursor
        ? {
            items: [
              { id: 'bn:1', title: 'One' },
              { id: 'bn:2', title: 'Two' },
            ],
            nextCursor: null,
            warnings: ['Partial'],
          }
        : { items: [{ id: 'bn:1', title: 'One' }], nextCursor: 'next', warnings: [] };
    },
  });
  await c.submit('Uketsu');
  assert.equal(states.at(-1).nextCursor, 'next');
  await c.more();
  assert.deepEqual(
    states.at(-1).items.map((x) => x.title),
    ['One', 'Two'],
  );
  assert.deepEqual(calls, [
    { q: 'Uketsu', cursor: null },
    { q: 'Uketsu', cursor: 'next' },
  ]);
  assert.deepEqual(states.at(-1).warnings, ['Partial']);
});
test('failed later page keeps prior results and permits retry; a new search cancels late pages', async () => {
  const states = [];
  let release,
    attempts = 0;
  const c = createSearchController({
    onState: (s) => states.push(s),
    search: async (q, signal, cursor) => {
      if (q === 'Other') return { items: [{ id: 'other', title: 'Other' }], nextCursor: null };
      if (!cursor) return { items: [{ id: 'one', title: 'One' }], nextCursor: 'next' };
      if (++attempts === 1) throw Error('Offline');
      return new Promise((r) => (release = r));
    },
  });
  await c.submit('Uketsu');
  await c.more();
  assert.equal(states.at(-1).items[0].title, 'One');
  assert.equal(states.at(-1).nextCursor, 'next');
  assert.match(states.at(-1).message, /Offline/);
  const pending = c.more();
  await c.submit('Other');
  release({ items: [{ id: 'late', title: 'Late' }], nextCursor: null });
  await pending;
  assert.equal(states.at(-1).items[0].title, 'Other');
});
