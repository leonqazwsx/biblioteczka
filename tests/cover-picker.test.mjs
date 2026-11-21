import test from 'node:test';
import assert from 'node:assert/strict';
import {importDom} from './helpers/import-dom.mjs';

const {createCoverPicker} = await import('../public/manager/cover-picker.mjs').catch(() => ({}));
const book = {title: 'Reacher', authors: ['Lee Child'], isbn: '9780593440643', providerId: '/books/OL36615004M', catalogCoverId: 14425283};
const context = patch => ({identity: 'editor-session-1', coverId: null, book: {...book, authors: [...book.authors]}, ...patch});
const saved = {coverId: 'local-cover', mime: 'image/jpeg', source: 'openlibrary'};
const candidate = (id, patch = {}) => ({id, title: 'Reacher', isbn: book.isbn, language: 'eng', publisher: 'Jove', publicationYear: '2021', source: 'openlibrary', match: 'edition', previewUrl: '/api/cover-search/search-1/' + id, sourceUrl: 'https://openlibrary.org/books/OL36615004M', ...patch});
const result = (candidates = [candidate('exact')], patch = {}) => ({searchId: 'search-1', candidates, automaticId: 'exact', warnings: [], ...patch});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(t, {initial = context(), request = async path => path === '/api/cover-search' ? result() : saved, onApply} = {}) {
  assert.equal(typeof createCoverPicker, 'function');
  const {root, doc} = importDom();
  root.ownerDocument = doc;
  let current = initial;
  const calls = [], applied = [], busy = [], errors = [];
  const control = createCoverPicker(root, {
    request: async (path, options) => {calls.push({path, ...options}); return request(path, options);},
    getContext: () => current,
    onApply: async (image, original) => {applied.push({image, original}); if (onApply) await onApply(image, original); else current = {...current, coverId: image.coverId};},
    onBusy: value => busy.push(value),
    onError: error => errors.push(error)
  });
  const byClass = name => root.querySelectorAll('button,div,p,section').find(node => node.className.split(' ').includes(name));
  return {root, doc, control, calls, applied, busy, errors, byClass, setContext(value) {current = value;}, getContext: () => current,
    action: () => byClass('cover-picker-action'), retry: () => byClass('cover-picker-retry'),
    cards: () => root.querySelectorAll('button').filter(node => node.className.split(' ').includes('cover-picker-card'))};
}

test('automatic search applies only the exact candidate and does not force the gallery open', async t => {
  const a = setup(t);
  await a.control.search({automatic: true});
  assert.deepEqual(a.calls.map(call => [call.path, call.method, call.body]), [
    ['/api/cover-search', 'POST', book], ['/api/covers', 'POST', {searchId: 'search-1', candidateId: 'exact'}]
  ]);
  assert.ok(a.calls.every(call => call.signal instanceof AbortSignal));
  assert.equal(a.applied.length, 1);
  assert.equal(a.applied[0].image.coverId, 'local-cover');
  assert.equal(a.action().getAttribute('aria-expanded'), 'false');
  assert.equal(a.byClass('cover-picker-panel').hidden, true);
  assert.deepEqual(a.busy, [true, false]);
  assert.equal(a.action().textContent, 'Wybierz inną okładkę');
});

test('automatic search never replaces an existing cover or applies a work alternative', async t => {
  const existing = setup(t, {initial: context({coverId: 'original'})});
  await existing.control.search({automatic: true});
  assert.equal(existing.calls.length, 0);
  const other = setup(t, {request: async () => result([candidate('other', {match: 'work'})], {automaticId: 'other'})});
  await other.control.search({automatic: true});
  assert.equal(other.applied.length, 0);
  assert.deepEqual(other.busy, []);
});

test('an automatic attempt runs once for an unchanged editor context', async t => {
  const a = setup(t, {request: async () => result([], {automaticId: null})});
  await a.control.search({automatic: true});
  await a.control.search({automatic: true});
  assert.equal(a.calls.length, 1);
});

test('manual selection imports another edition into the draft without changing book metadata', async t => {
  const initial = context({coverId: 'original'}), a = setup(t, {initial, request: async path => path === '/api/cover-search' ? result([candidate('other', {title: 'Killing Floor', match: 'work', language: 'pol', publisher: 'Albatros'})], {automaticId: null}) : saved});
  await a.action().onclick();
  assert.equal(a.action().getAttribute('aria-expanded'), 'true');
  assert.equal(a.cards()[0].type, 'button');
  await a.cards()[0].onclick();
  assert.deepEqual(a.calls[1].body, {searchId: 'search-1', candidateId: 'other'});
  assert.deepEqual(a.getContext().book, book);
  assert.equal(initial.coverId, 'original');
  assert.equal(a.getContext().coverId, 'local-cover');
  assert.equal(a.applied[0].original.coverId, 'original');
  assert.deepEqual(a.busy, [true, false]);
});

test('metadata search leaves saving available and does not report import busy', async t => {
  const pending = deferred(), a = setup(t, {request: () => pending.promise});
  const work = a.control.search();
  assert.deepEqual(a.busy, []);
  assert.match(a.root.textContent, /Szukam/);
  pending.resolve(result([], {automaticId: null}));
  await work;
  assert.deepEqual(a.busy, []);
  assert.equal(a.applied.length, 0);
});

test('missing metadata is labelled honestly and remote or duplicate previews are not choices', async t => {
  const a = setup(t, {request: async () => result([
    candidate('unknown', {title: '', isbn: null, language: null, publisher: null, publicationYear: null, source: null, match: 'work'}),
    candidate('unknown'),
    candidate('remote', {previewUrl: 'https://remote.example/cover.jpg'}),
    candidate('duplicate', {previewUrl: '/api/cover-search/search-1/unknown'})
  ], {automaticId: null})});
  await a.control.search();
  assert.equal(a.cards().length, 1);
  assert.match(a.cards()[0].textContent, /wydanie nieustalone/i);
  assert.match(a.cards()[0].textContent, /język nieustalony/i);
  assert.match(a.cards()[0].textContent, /źródło nieustalone/i);
  assert.equal(a.root.querySelectorAll('img')[0].src, '/api/cover-search/search-1/unknown');
});

test('a broken thumbnail removes its failed choice and leaves another choice usable', async t => {
  const a = setup(t, {request: async path => path === '/api/cover-search' ? result([candidate('exact'), candidate('other', {match: 'work'})]) : saved});
  await a.control.search();
  a.cards()[0].focus();
  a.root.querySelectorAll('img')[0].onerror();
  assert.equal(a.cards()[0].disabled, true);
  assert.equal(a.cards()[0].hidden, true);
  assert.match(a.cards()[0].textContent, /Podgląd niedostępny/);
  assert.equal(a.cards()[1].disabled, false);
  assert.equal(a.doc.activeElement, a.cards()[1]);
  await a.cards()[0].onclick();
  assert.equal(a.applied.length, 0);
  await a.cards()[1].onclick();
  assert.equal(a.applied.length, 1);
});

test('empty, partial and unavailable searches offer distinct status and retry', async t => {
  const empty = setup(t, {request: async () => result([], {automaticId: null})});
  await empty.control.search();
  assert.match(empty.root.textContent, /Nie znaleziono okładek/);
  assert.equal(empty.retry().hidden, false);
  const partial = setup(t, {request: async () => result([candidate('exact')], {warnings: [{source: 'inventaire', code: 'COVER_UNAVAILABLE', message: 'timeout'}]})});
  await partial.control.search();
  assert.equal(partial.cards().length, 1);
  assert.match(partial.root.textContent, /Część źródeł/);
  assert.equal(partial.retry().hidden, false);
  const unavailable = setup(t, {request: async () => {throw Error('offline');}});
  await unavailable.control.search();
  assert.match(unavailable.root.textContent, /chwilowo niedostępne/i);
  assert.equal(unavailable.retry().hidden, false);
  assert.equal(unavailable.errors.length, 1);
  assert.equal(unavailable.byClass('cover-picker-status').getAttribute('role'), 'status');
});

test('manual collapse returns focus to the gallery action', async t => {
  const a = setup(t);
  await a.action().onclick();
  a.cards()[0].focus();
  const close = a.byClass('cover-picker-close');
  assert.equal(close.type, 'button');
  close.onclick();
  assert.equal(a.action().getAttribute('aria-expanded'), 'false');
  assert.equal(a.byClass('cover-picker-panel').hidden, true);
  assert.equal(a.doc.activeElement, a.action());
});

for (const reason of ['reset', 'cancel', 'closed', 'identity', 'isbn', 'title', 'authors', 'providerId', 'catalogCoverId', 'coverId']) {
  test(`${reason} invalidates an automatic result even when the transport ignores abort`, async t => {
    const pending = deferred(), a = setup(t, {request: () => pending.promise});
    const work = a.control.search({automatic: true});
    const old = a.getContext();
    if (reason === 'reset' || reason === 'cancel') a.control[reason]();
    else if (reason === 'closed') a.setContext(null);
    else if (reason === 'identity') a.setContext({...old, identity: 'editor-session-2'});
    else if (reason === 'coverId') a.setContext({...old, coverId: 'manual-cover'});
    else a.setContext({...old, book: {...old.book, [reason]: reason === 'authors' ? ['Another Author'] : 'changed'}});
    pending.resolve(result());
    await work;
    assert.equal(a.applied.length, 0);
    assert.equal(a.calls.filter(call => call.path === '/api/covers').length, 0);
    assert.deepEqual(a.busy, []);
    if (reason === 'reset' || reason === 'cancel') assert.equal(a.calls[0].signal.aborted, true);
  });
}

test('a manual alternative wins over a pending automatic image import', async t => {
  const pending = deferred(), a = setup(t, {request: async (path, options) => path === '/api/cover-search' ? result([candidate('exact'), candidate('other', {match: 'work'})]) : options.body.candidateId === 'exact' ? pending.promise : {...saved, coverId: 'manual-alternative'}});
  const automatic = a.control.search({automatic: true});
  await tick();
  await a.cards()[1].onclick();
  pending.resolve(saved);
  await automatic;
  assert.deepEqual(a.applied.map(value => value.image.coverId), ['manual-alternative']);
  assert.equal(a.calls[1].signal.aborted, true);
  assert.deepEqual(a.busy, [true, false, true, false]);
});

test('cancel releases import busy once and a stale finally cannot release a newer import', async t => {
  const first = deferred(), second = deferred();
  let imports = 0;
  const a = setup(t, {request: path => path === '/api/cover-search' ? result() : ++imports === 1 ? first.promise : second.promise});
  await a.control.search();
  const old = a.cards()[0].onclick();
  assert.deepEqual(a.busy, [true]);
  a.control.cancel();
  assert.deepEqual(a.busy, [true, false]);
  await a.control.search();
  const current = a.cards()[0].onclick();
  first.resolve(saved);
  await old;
  assert.deepEqual(a.busy, [true, false, true]);
  second.resolve(saved);
  await current;
  assert.deepEqual(a.busy, [true, false, true, false]);
  assert.equal(a.applied.length, 1);
});

for (const invalidation of ['cancel', 'closed', 'identity', 'cover']) {
  test(`${invalidation} also prevents a pending manual image import from applying`, async t => {
    const pending = deferred(), a = setup(t, {request: path => path === '/api/cover-search' ? result() : pending.promise});
    await a.control.search();
    const work = a.cards()[0].onclick();
    if (invalidation === 'cancel') a.control.cancel();
    else if (invalidation === 'closed') a.setContext(null);
    else a.setContext({...a.getContext(), [invalidation === 'identity' ? 'identity' : 'coverId']: 'replacement'});
    pending.resolve(saved);
    await work;
    assert.equal(a.applied.length, 0);
    assert.deepEqual(a.busy, [true, false]);
  });
}

test('the apply context exposes a generation guard during asynchronous palette work', async t => {
  const palette = deferred();
  let applied = false, applyContext;
  const a = setup(t, {onApply: async (_image, original) => {applyContext = original; await palette.promise; if (original.isCurrent()) applied = true;}});
  await a.control.search();
  const work = a.cards()[0].onclick();
  await tick();
  assert.equal(applyContext.isCurrent(), true);
  a.control.cancel();
  assert.equal(applyContext.isCurrent(), false);
  palette.resolve();
  await work;
  assert.equal(applied, false);
  assert.deepEqual(a.busy, [true, false]);
});

test('an expired candidate preserves the current cover and retry starts a fresh search', async t => {
  let searches = 0;
  const a = setup(t, {initial: context({coverId: 'original'}), request: async path => {
    if (path === '/api/cover-search') {searches++; return result();}
    throw Object.assign(Error('expired'), {code: 'COVER_SEARCH_EXPIRED', status: 410});
  }});
  await a.control.search();
  await a.cards()[0].onclick();
  assert.equal(a.getContext().coverId, 'original');
  assert.equal(a.applied.length, 0);
  assert.match(a.root.textContent, /wygasła/i);
  assert.equal(a.retry().hidden, false);
  await a.retry().onclick();
  assert.equal(searches, 2);
});

test('destroy aborts pending work and removes only the picker markup', async t => {
  const pending = deferred(), a = setup(t, {request: () => pending.promise});
  const other = a.doc.createElement('p'); other.textContent = 'unrelated'; a.root.append(other);
  const work = a.control.search({automatic: true});
  a.control.destroy();
  pending.resolve(result());
  await work;
  assert.equal(a.calls[0].signal.aborted, true);
  assert.equal(a.applied.length, 0);
  assert.equal(a.root.textContent, 'unrelated');
  await a.control.search();
  assert.equal(a.calls.length, 1);
});

test('a card from a replaced gallery cannot select against the newer search', async t => {
  let searches = 0;
  const a = setup(t, {request: path => path === '/api/cover-search' ? ++searches === 1 ? result() : result([candidate('new', {previewUrl: '/api/cover-search/search-2/new'})], {searchId: 'search-2', automaticId: null}) : saved});
  await a.control.search();
  const old = a.cards()[0];
  await a.control.search();
  await old.onclick();
  assert.equal(a.calls.filter(call => call.path === '/api/covers').length, 0);
  await a.cards()[0].onclick();
  assert.deepEqual(a.calls.at(-1).body, {searchId: 'search-2', candidateId: 'new'});
  assert.equal(a.applied.length, 1);
});

test('no identity and insufficient book data cannot start a cover search', async t => {
  const a = setup(t, {initial: null});
  await a.control.search();
  assert.equal(a.action().disabled, true);
  a.setContext(context({book: {title: 'Reacher', authors: [], isbn: null}}));
  await a.control.search();
  assert.equal(a.calls.length, 0);
  assert.match(a.root.textContent, /Podaj ISBN lub tytuł i autora/);
});

test('the inline gallery bounds rendered choices to twelve', async t => {
  const a = setup(t, {request: async () => result(Array.from({length: 15}, (_, index) => candidate('cover-' + index)), {automaticId: null})});
  await a.control.search();
  assert.equal(a.cards().length, 12);
});

test('an unmounted picker cannot apply a late search result', async t => {
  const pending = deferred(), a = setup(t, {request: () => pending.promise});
  const work = a.control.search({automatic: true});
  a.root.connected = false;
  pending.resolve(result());
  await work;
  assert.equal(a.applied.length, 0);
  assert.equal(a.calls.length, 1);
});

test('a failed preferred cover falls back to another exact edition source without selecting a work cover', async t => {
  const a = setup(t, {request: async (path, options) => {
    if (path === '/api/cover-search') return result([
      candidate('other-work-cover', {match: 'work'}),
      candidate('inventaire-exact', {source: 'inventaire'}),
      candidate('preferred-ol')
    ], {automaticId: 'preferred-ol'});
    if (options.body.candidateId === 'preferred-ol') throw Object.assign(Error('source unavailable'), {code: 'COVER_UNAVAILABLE', status: 502});
    return {...saved, coverId: 'inventaire-cover', source: 'inventaire'};
  }});
  await a.control.search({automatic: true});
  assert.deepEqual(a.calls.filter(call => call.path === '/api/covers').map(call => call.body), [
    {searchId: 'search-1', candidateId: 'preferred-ol'},
    {searchId: 'search-1', candidateId: 'inventaire-exact'}
  ]);
  assert.deepEqual(a.applied.map(value => value.image.source), ['inventaire']);
  assert.equal(a.getContext().coverId, 'inventaire-cover');
  assert.equal(a.errors.length, 0);
  assert.deepEqual(a.busy, [true, false, true, false]);
  assert.equal(a.action().getAttribute('aria-expanded'), 'false');
});

test('automatic fallback is bounded to exact candidates and reports a terminal failure once', async t => {
  const a = setup(t, {request: async path => {
    if (path === '/api/cover-search') return result([candidate('exact'), candidate('other', {match: 'work'}), candidate('exact-backup')]);
    throw Object.assign(Error('source unavailable'), {code: 'COVER_UNAVAILABLE', status: 502});
  }});
  await a.control.search({automatic: true});
  await a.control.search({automatic: true});
  assert.deepEqual(a.calls.filter(call => call.path === '/api/covers').map(call => call.body.candidateId), ['exact', 'exact-backup']);
  assert.equal(a.calls.filter(call => call.path === '/api/cover-search').length, 1);
  assert.equal(a.applied.length, 0);
  assert.equal(a.errors.length, 1);
  assert.equal(a.retry().hidden, false);
  assert.deepEqual(a.busy, [true, false, true, false]);
});

test('cancellation of a pending preferred cover prevents automatic fallback', async t => {
  const primary = deferred(), a = setup(t, {request: path => path === '/api/cover-search' ? result([candidate('exact'), candidate('backup')]) : primary.promise});
  const work = a.control.search({automatic: true});
  await tick();
  a.control.cancel();
  primary.reject(Object.assign(Error('late source failure'), {code: 'COVER_UNAVAILABLE', status: 502}));
  await work;
  assert.deepEqual(a.calls.filter(call => call.path === '/api/covers').map(call => call.body.candidateId), ['exact']);
  assert.equal(a.applied.length, 0);
  assert.equal(a.errors.length, 0);
  assert.deepEqual(a.busy, [true, false]);
});

test('a manual alternative stops fallback after a late preferred-cover failure', async t => {
  const primary = deferred(), a = setup(t, {request: (path, options) => {
    if (path === '/api/cover-search') return result([candidate('exact'), candidate('backup'), candidate('manual', {match: 'work'})]);
    return options.body.candidateId === 'exact' ? primary.promise : {...saved, coverId: 'manual-cover'};
  }});
  const work = a.control.search({automatic: true});
  await tick();
  await a.cards()[2].onclick();
  primary.reject(Object.assign(Error('late source failure'), {code: 'COVER_UNAVAILABLE', status: 502}));
  await work;
  assert.deepEqual(a.calls.filter(call => call.path === '/api/covers').map(call => call.body.candidateId), ['exact', 'manual']);
  assert.deepEqual(a.applied.map(value => value.image.coverId), ['manual-cover']);
  assert.equal(a.errors.length, 0);
  assert.deepEqual(a.busy, [true, false, true, false]);
});

test('an expired automatic search stops fallback and waits for an explicit retry', async t => {
  const a = setup(t, {request: async path => {
    if (path === '/api/cover-search') return result([candidate('exact'), candidate('backup')]);
    throw Object.assign(Error('expired'), {code: 'COVER_SEARCH_EXPIRED', status: 410});
  }});
  await a.control.search({automatic: true});
  assert.deepEqual(a.calls.map(call => call.path), ['/api/cover-search', '/api/covers']);
  assert.equal(a.applied.length, 0);
  assert.match(a.root.textContent, /wygasła/i);
  assert.equal(a.retry().hidden, false);
});
