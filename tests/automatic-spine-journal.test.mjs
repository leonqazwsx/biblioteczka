import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
const { openAutomaticSpineJournal } = await import('../src/automatic-spine-journal.mjs').catch(
  () => ({}),
);
test('atomic local bindings survive restart and isolate collections with the same book ID', async (t) => {
  assert.equal(typeof openAutomaticSpineJournal, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = await openAutomaticSpineJournal({ dataDir });
  t.after(() => journal.close());
  const entry = {
    collectionId: randomUUID(),
    bookId: randomUUID(),
    requestId: randomUUID(),
    coverId: 'a'.repeat(64),
    expectedGeneration: 0,
    ticket: null,
    remoteJobId: null,
    origin: 'http://127.0.0.1:47842',
    phase: 'prepared',
    retryAt: null,
  };
  await journal.put(entry);
  await journal.put({ ...entry, collectionId: randomUUID(), requestId: randomUUID() });
  const saved = journal.read();
  assert.equal(saved.length, 2);
  await assert.rejects(journal.put({ ...entry, token: 'secret' }), { code: 'INVALID_JOURNAL' });
  await journal.close();
  const reopened = await openAutomaticSpineJournal({ dataDir });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.read(), saved);
  await reopened.remove(entry.collectionId + ':' + entry.bookId);
  assert.equal(reopened.read().length, 1);
  await reopened.close();
  const target = path.join(dataDir, 'automatic-spines.json');
  await fs.writeFile(target, 'broken');
  await assert.rejects(openAutomaticSpineJournal({ dataDir }), { code: 'INVALID_JOURNAL' });
  assert.equal(await fs.readFile(target, 'utf8'), 'broken');
});

test('optional provider error code persists without invalidating old journal entries', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-quota-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let journal = await openAutomaticSpineJournal({ dataDir });
  t.after(() => journal.close());
  const entry = {
    collectionId: randomUUID(),
    bookId: randomUUID(),
    requestId: randomUUID(),
    coverId: 'a'.repeat(64),
    expectedGeneration: 0,
    ticket: null,
    remoteJobId: null,
    origin: 'http://127.0.0.1:47842',
    phase: 'prepared',
    retryAt: null,
  };
  await journal.put(entry);
  await journal.put({ ...entry, errorCode: 'PROVIDER_QUOTA' });
  await journal.close();
  journal = await openAutomaticSpineJournal({ dataDir });
  assert.equal(journal.read()[0].errorCode, 'PROVIDER_QUOTA');
  for (const errorCode of ['private text', {}, 'a'.repeat(100), 1])
    await assert.rejects(journal.put({ ...entry, errorCode }), { code: 'INVALID_JOURNAL' });
  await journal.put({ ...entry, errorCode: null });
  assert.equal(journal.read()[0].errorCode, null);
});
