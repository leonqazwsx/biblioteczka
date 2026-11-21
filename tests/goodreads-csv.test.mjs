import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseGoodreadsCsv, proposeGoodreadsCategory } from '../src/goodreads-csv.mjs';
const bytes = (s) => Buffer.from(s, 'utf8');
const file = (name) => fs.readFile(new URL('./fixtures/goodreads/' + name, import.meta.url));
test('literal BOM/CRLF export retains authors, calendar date, ISBN and string ID but no private fields', async () => {
  const source = await file('quoted.csv');
  assert.ok(source.subarray(0, 3).equals(Buffer.from([239, 187, 191])));
  assert.ok(source.includes(Buffer.from('\r\n')));
  const parsed = parseGoodreadsCsv(source);
  const b = parsed.records[0].candidate;
  assert.equal(b.title, 'Podróż, "daleko"\r\ndo domu');
  assert.deepEqual(b.authors, ['Kowalski, Jan']);
  assert.equal(b.readDate, '2024-02-29');
  assert.equal(b.isbn, '9780140328721');
  assert.equal(b.goodreadsId, '12345678901234567890123456789012');
  assert.equal(b.pageCount, 240);
  assert.equal(b.publicationYear, '2024');
  assert.deepEqual(b.subjects, ['fantasy']);
  assert.equal(parsed.records[1].candidate.title, '=SUM(1+1)');
  assert.equal(parsed.records[1].candidate.readDate, null);
  for (const marker of ['PRIVATE_MARKER', 'REVIEW_MARKER', 'SECRET_UNUSED', 'Date Added'])
    assert.ok(!JSON.stringify(parsed).includes(marker));
});
test('mixed records isolate semantic errors and warn about status/authors/secondary ISBN', async () => {
  const { records, notices } = parseGoodreadsCsv(await file('mixed.csv'));
  assert.equal(records.length, 12);
  assert.deepEqual(
    records.filter((r) => r.candidate === null).map((r) => r.recordNumber),
    [7, 8, 9, 12],
  );
  assert.deepEqual(
    records.slice(0, 3).map((r) => r.candidate.status),
    ['read', 'reading', 'to-read'],
  );
  assert.equal(records[3].candidate.status, 'to-read');
  assert.ok(records[3].warnings.some((w) => /oznaczenie przeczytania/i.test(w)));
  assert.ok(records[4].warnings.some((w) => /oznaczenie przeczytania/i.test(w)));
  assert.equal(records[5].candidate.readDate, null);
  assert.deepEqual(records[9].candidate.authors, ['Autor', 'Kowalski, Jan, Nowak, Anna']);
  assert.deepEqual(records[9].candidate.subjects, ['biography']);
  assert.ok(records[9].warnings.some((w) => /autor/i.test(w)));
  assert.equal(records[10].candidate.isbn, '9780140328721');
  assert.ok(records[10].warnings.some((w) => /ISBN/.test(w)));
  assert.deepEqual(notices, []);
});
test('headers are case insensitive, required fields and unsupported format reject file', async () => {
  assert.equal(parseGoodreadsCsv(bytes(' title , AUTHOR \nA,B')).records[0].candidate.title, 'A');
  assert.deepEqual(parseGoodreadsCsv(bytes('Title,Author\nA,B')).notices, [
    'Brak oznaczenia przeczytania w pliku. Książki bez niego zostaną pominięte.',
    'Brak kolumny Date Read; daty pozostaną puste.',
  ]);
  for (const text of ['Title\nA', 'Author\nB', 'Title,Author, title\nA,B,C'])
    assert.throws(() => parseGoodreadsCsv(bytes(text)), { code: 'INVALID_CSV' });
  assert.throws(() => parseGoodreadsCsv(Buffer.from([0xff])), { code: 'INVALID_CSV' });
  const broken = await file('broken-quotes.csv');
  assert.throws(() => parseGoodreadsCsv(broken), { code: 'INVALID_CSV' });
});
test('optional fields validate without inventing or truncating data', () => {
  const row = (field, value) =>
    parseGoodreadsCsv(
      bytes('Title,Author,' + field + '\nA,B,"' + value.replaceAll('"', '""') + '"'),
    ).records[0];
  for (const [field, values] of [
    ['Book Id', ['x', '1'.repeat(33)]],
    ['Date Read', ['2024/2/29', '2024-04-31', '0000-01-01']],
    ['Year Published', ['0', '10000', '2024x']],
    ['Number of Pages', ['1.5', '-1', '100001']],
    ['Publisher', ['x'.repeat(501)]],
    ['Additional Authors', ['x'.repeat(201)]],
    ['Bookshelves', ['x'.repeat(161), Array.from({ length: 81 }, (_, i) => 'tag' + i).join(',')]],
    ['ISBN', ['123', '9780140328722']],
  ])
    for (const value of values) {
      const result = row(field, value);
      assert.equal(result.candidate, null, field + ': ' + value.slice(0, 30));
      assert.ok(result.errors.length);
    }
  assert.equal(row('ISBN', '=""').candidate.isbn, null);
  assert.equal(row('ISBN', '978-0-140-32872-1').candidate.isbn, '9780140328721');
  assert.equal(row('Year Published', '0001').candidate.publicationYear, '1');
  for (const field of ['Title', 'Author']) {
    const result = parseGoodreadsCsv(
      bytes(
        'Title,Author\n' + (field === 'Title' ? '' : 'A') + ',' + (field === 'Author' ? '' : 'B'),
      ),
    ).records[0];
    assert.equal(result.candidate, null);
  }
});
test('category proposes exact existing tags first, known genres next and Other for conflicts/personal tags', () => {
  const shelves = [
    { id: 'f', name: 'Fantastyka' },
    { id: 'c', name: 'Kryminał' },
    { id: 'o', name: 'Pozostałe' },
    { id: 'personal', name: 'Ulubione' },
  ];
  assert.deepEqual(proposeGoodreadsCategory(['ulubione', 'fantasy'], shelves), {
    shelfId: 'personal',
    newShelfName: null,
  });
  assert.deepEqual(proposeGoodreadsCategory(['fantasy'], shelves), {
    shelfId: 'f',
    newShelfName: null,
  });
  assert.deepEqual(proposeGoodreadsCategory(['fantasy', 'mystery'], shelves), {
    shelfId: 'o',
    newShelfName: null,
  });
  assert.deepEqual(proposeGoodreadsCategory(['Fantastyka', 'Kryminał'], shelves), {
    shelfId: 'o',
    newShelfName: null,
  });
  assert.deepEqual(proposeGoodreadsCategory(['biography'], shelves), {
    shelfId: null,
    newShelfName: 'Biografie',
  });
  assert.deepEqual(proposeGoodreadsCategory(['personal-tag'], []), {
    shelfId: null,
    newShelfName: 'Pozostałe',
  });
});
test('file, record, column and cell limits accept boundaries and reject one beyond', () => {
  const limit = 10 * 1024 * 1024;
  assert.throws(() => parseGoodreadsCsv(Buffer.alloc(limit + 1)), { code: 'TOO_LARGE' });
  const header = 'Title,Author,Ignored\n',
    line = 'A,B,' + 'x'.repeat(1160) + '\n';
  const count = 8999,
    remaining = limit - Buffer.byteLength(header) - Buffer.byteLength(line) * count - 5;
  assert.ok(remaining > 0 && remaining < 100000);
  const exact = bytes(header + line.repeat(count) + 'A,B,' + 'x'.repeat(remaining) + '\n');
  assert.equal(exact.length, limit);
  assert.equal(parseGoodreadsCsv(exact).records.length, 9000);
  assert.equal(
    parseGoodreadsCsv(bytes('Title,Author\n' + 'A,B\n'.repeat(10000))).records.length,
    10000,
  );
  assert.throws(() => parseGoodreadsCsv(bytes('Title,Author\n' + 'A,B\n'.repeat(10001))), {
    code: 'TOO_LARGE',
  });
  const columns = Array.from({ length: 98 }, (_, i) => 'Unused' + i);
  assert.equal(
    parseGoodreadsCsv(
      bytes(['Title', 'Author', ...columns].join(',') + '\n' + ['A', 'B', ...columns].join(',')),
    ).records.length,
    1,
  );
  assert.throws(
    () => parseGoodreadsCsv(bytes(['Title', 'Author', ...columns, 'Extra'].join(','))),
    { code: 'TOO_LARGE' },
  );
  assert.ok(
    parseGoodreadsCsv(bytes('Title,Author,Ignored\nA,B,' + 'x'.repeat(100000))).records[0]
      .candidate,
  );
  assert.throws(() => parseGoodreadsCsv(bytes('Title,Author,Ignored\nA,B,' + 'x'.repeat(100001))), {
    code: 'TOO_LARGE',
  });
});
