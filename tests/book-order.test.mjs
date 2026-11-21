import test from 'node:test';
import assert from 'node:assert/strict';
const { sortBooks } = await import('../public/shared/book-order.mjs').catch(() => ({}));
const books = [
  { id: '1', title: 'Żaba', order: 0, readDate: null },
  { id: '2', title: 'Łódź', order: 1, readDate: '2024-02-29' },
  { id: '3', title: 'Zima', order: 2, readDate: '2026-10-05' },
  { id: '4', title: 'Lato', order: 3, readDate: '2026-10-05' },
];
test('title sorting respects Polish letters and preserves manual order', () => {
  assert.equal(typeof sortBooks, 'function');
  const before = structuredClone(books);
  assert.deepEqual(
    sortBooks(books, 'title-asc').map((b) => b.title),
    ['Lato', 'Łódź', 'Zima', 'Żaba'],
  );
  assert.deepEqual(
    sortBooks(books, 'title-desc').map((b) => b.title),
    ['Żaba', 'Zima', 'Łódź', 'Lato'],
  );
  assert.deepEqual(
    sortBooks(books, 'manual').map((b) => b.id),
    ['1', '2', '3', '4'],
  );
  assert.deepEqual(books, before);
});
test('missing read dates always follow dated books in either direction', () => {
  assert.equal(typeof sortBooks, 'function');
  assert.deepEqual(
    sortBooks(books, 'read-newest').map((b) => b.id),
    ['4', '3', '2', '1'],
  );
  assert.deepEqual(
    sortBooks(books, 'read-oldest').map((b) => b.id),
    ['2', '4', '3', '1'],
  );
});
test('title numbers and tied labels have deterministic manual tie breaks', () => {
  assert.equal(typeof sortBooks, 'function');
  const input = [
    { id: 'b', title: 'Tom 10', order: 0 },
    { id: 'c', title: 'Tom 2', order: 2 },
    { id: 'a', title: 'tom 2', order: 1 },
  ];
  assert.deepEqual(
    sortBooks(input, 'title-asc').map((b) => b.id),
    ['a', 'c', 'b'],
  );
  assert.notEqual(sortBooks(input), input);
});
