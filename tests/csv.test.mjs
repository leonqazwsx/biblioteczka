import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';
test('CSV preserves quoted commas, quotes and CRLF inside fields', () => {
  const parsed = parseCsv('\uFEFF Title ,Author\r\n"A, ""B""\r\nC","Kowalski, Jan"\r\nD,E');
  assert.deepEqual(parsed.headers, ['Title', 'Author']);
  assert.deepEqual(parsed.records, [
    { recordNumber: 1, cells: ['A, "B"\r\nC', 'Kowalski, Jan'] },
    { recordNumber: 2, cells: ['D', 'E'] },
  ]);
});
test('CSV ignores blank records but retains original data record numbers', () => {
  const result = parseCsv('Title,Author\n\n,\nA,B\n \nC,D\n');
  assert.deepEqual(
    result.records.map((r) => r.recordNumber),
    [3, 5],
  );
  assert.equal(result.records.length, 2);
});
test('CSV rejects empty/repeated headers and inconsistent columns', () => {
  for (const text of [
    '',
    ',Author\nA,B',
    'Title, title\nA,B',
    'Title,Author\nA',
    'Title,Author\nA,B,C',
  ])
    assert.throws(() => parseCsv(text), { code: 'INVALID_CSV' });
});
test('CSV rejects malformed quoting before returning any record', () => {
  for (const text of [
    'Title,Author\nA,B\n"bad,B',
    'Title,Author\nA"B,C',
    'Title,Author\n"A"x,B',
    'Title,Author\n"A" "B",C',
  ])
    assert.throws(() => parseCsv(text), { code: 'INVALID_CSV' });
});
test('CSV checks record, column and decoded-cell boundaries', () => {
  assert.equal(
    parseCsv('A,B\nx,y\nz,w', { maxRecords: 2, maxColumns: 2, maxCellLength: 1 }).records.length,
    2,
  );
  assert.throws(() => parseCsv('A,B\nx,y\nz,w', { maxRecords: 1 }), { code: 'TOO_LARGE' });
  assert.throws(() => parseCsv('A,B\nx,y', { maxColumns: 1 }), { code: 'TOO_LARGE' });
  assert.throws(() => parseCsv('A\nxx', { maxCellLength: 1 }), { code: 'TOO_LARGE' });
  assert.equal(parseCsv('A\n""""', { maxCellLength: 1 }).records[0].cells[0], '"');
  assert.throws(() => parseCsv('A\n""""""', { maxCellLength: 1 }), { code: 'TOO_LARGE' });
});
