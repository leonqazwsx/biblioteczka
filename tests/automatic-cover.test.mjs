import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openStore} from '../src/store.mjs';
const {resolveBookCover, bookIdentityFingerprint} = await import('../src/cover-resolver.mjs').catch(() => ({}));
const book = (patch = {}) => ({title: 'Matylda', authors: ['Roald Dahl'], isbn: null, providerId: null, ...patch});
test('canonical ISBN10/13, exact normalized identity and ambiguity guard', async () => {
  assert.equal(typeof resolveBookCover, 'function');
  const edition = book({id: '/books/OL1M', editionId: '/books/OL1M', isbn: '0140328726', coverId: 42});
  const catalog = {search: async () => [edition], resolveEdition: async () => edition};
  assert.deepEqual(await resolveBookCover({book: book({isbn: '0140328726'}), catalog}), {catalogCoverId: 42});
  assert.deepEqual(await resolveBookCover({book: book({isbn: '9780140328721'}), catalog}), {catalogCoverId: 42});
  assert.deepEqual(await resolveBookCover({book: book({title: '  ＭＡＴＹＬＤＡ ', authors: ['ROALD   DAHL']}), catalog}), {catalogCoverId: 42});
  for (const patch of [{title: 'Matilda'}, {authors: ['Inny Autor']}, {authors: []}, {isbn: '9780553386790'}])
    assert.equal(await resolveBookCover({book: book(patch), catalog}), null);
  const ambiguous = {search: async () => [edition, {...edition, id: '/books/OL2M', editionId: '/books/OL2M', coverId: 43}]};
  assert.equal(await resolveBookCover({book: book(), catalog: ambiguous}), null);
  assert.equal(bookIdentityFingerprint(book({isbn: '0140328726'})), bookIdentityFingerprint(book({isbn: '9780140328721'})));
});
test('missing cover can resolve a uniquely matching edition; network failure is not a permanent miss', async () => {
  const candidate = book({id: '/works/OL1W', editionId: '/books/OL1M', coverId: null});
  assert.deepEqual(await resolveBookCover({book: book(), catalog: {search: async () => [candidate], resolveEdition: async () => ({...candidate, coverId: 42})}}), {catalogCoverId: 42});
  await assert.rejects(resolveBookCover({book: book(), catalog: {search: async () => {throw Object.assign(new Error('network'), {code: 'CATALOG_UNAVAILABLE'});}}}), {code: 'CATALOG_UNAVAILABLE'});
});
test('atomic cover attachment preserves metadata and rejects every stale/manual/collection case', async t => {
  assert.equal(typeof bookIdentityFingerprint, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-cover-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const store = await openStore(dataDir); assert.equal(typeof store.attachCoverIfCurrent, 'function');
  await store.commit({type: 'addBook', draft: {...book(), shelfId: 'other', status: 'read', readDate: '2026-10-01'}}, 0);
  const before = store.read(), b = before.books[0], ticket = {collectionId: before.collectionId, bookId: b.id, identity: bookIdentityFingerprint(b)};
  const attached = await store.attachCoverIfCurrent(ticket, 'a'.repeat(64)); assert.equal(attached.books[0].coverId, 'a'.repeat(64)); assert.equal(attached.books[0].readDate, '2026-10-01');
  assert.equal(await store.attachCoverIfCurrent(ticket, 'b'.repeat(64)), null);
  await store.commit({type: 'updateBook', id: b.id, patch: {coverId: null, title: 'Nowy tytuł'}}, store.read().revision);
  assert.equal(await store.attachCoverIfCurrent(ticket, 'c'.repeat(64)), null);
  const current = store.read(), fresh = {...ticket, identity: bookIdentityFingerprint(current.books[0])};
  await store.commit({type: 'setBookSpine', id: b.id, spine: {assetId: 'd'.repeat(64), kind: 'manual', sourceCoverId: null, model: null, promptVersion: null, frame: {x: 0.2, y: 0.5, zoom: 1.2}}}, current.revision);
  assert.equal(await store.attachCoverIfCurrent(fresh, 'a'.repeat(64)), null);
  const preserved = store.read().books[0]; await store.replace(store.read(), store.read().revision); assert.equal(await store.attachCoverIfCurrent(fresh, 'a'.repeat(64)), null); assert.deepEqual(store.read().books[0].spine, preserved.spine);
  await store.commit({type: 'deleteBook', id: b.id}, store.read().revision); assert.equal(await store.attachCoverIfCurrent(fresh, 'a'.repeat(64)), null);
});
