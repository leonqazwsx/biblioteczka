import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBookForm } from '../public/manager/forms.mjs';
test('manual form requires author and title and preserves shelf/status/text', () => {
  assert.throws(() =>
    validateBookForm({ title: 'Lalka', authors: '', shelfId: 'other', status: 'read' }),
  );
  assert.throws(() => validateBookForm({ title: '', authors: 'Prus' }));
  const b = validateBookForm({
    title: '<Lalka>',
    authors: 'Bolesław Prus',
    isbn: '',
    pageCount: '',
    shelfId: 'other',
    status: 'read',
  });
  assert.equal(b.title, '<Lalka>');
  assert.equal(b.isbn, null);
  assert.equal(b.pageCount, null);
  assert.equal(b.status, 'read');
  assert.equal(b.shelfId, 'other');
});
test('form rejects bad ISBN, negative pages and missing catalog author', () => {
  assert.throws(() =>
    validateBookForm({ title: 'Solaris', authors: 'Lem', isbn: '9780140328722' }),
  );
  assert.throws(() => validateBookForm({ title: 'Lalka', authors: 'Prus', pageCount: '-1' }));
  assert.throws(() => validateBookForm({ title: 'Unknown', authors: '' }));
});
test('form rejects malformed palette and whitespace-only author arrays', () => {
  assert.throws(() => validateBookForm({ title: 'A', authors: [' '] }));
  assert.throws(() => validateBookForm({ title: 'A', authors: ['B'], palette: ['red'] }));
});
test('form retains an optional completion date and rejects an impossible date', () => {
  const draft = { title: 'Solaris', authors: 'Lem', status: 'read', shelfId: 'fantasy' };
  assert.equal(validateBookForm({ ...draft, readDate: '2024-02-29' }).readDate, '2024-02-29');
  assert.equal(validateBookForm({ ...draft, readDate: '' }).readDate, null);
  assert.throws(() => validateBookForm({ ...draft, readDate: '2026-02-29' }), /dat/i);
});
test('form retains catalog topics while category stays manually chosen', () => {
  const b = validateBookForm({
    title: 'Solaris',
    authors: 'Lem',
    shelfId: 'crime',
    subjects: ['Science fiction'],
  });
  assert.deepEqual(b.subjects, ['Science fiction']);
  assert.equal(b.shelfId, 'crime');
});
