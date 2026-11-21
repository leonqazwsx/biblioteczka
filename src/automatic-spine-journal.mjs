import * as fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './domain.mjs';
import {
  atomicWrite,
  ensureDirectory,
  assertSafePath,
  exactKeys,
  isUuid,
  isHash,
  isIso,
} from './durable-files.mjs';
import { normalizeServiceUrl } from './spine-service-config.mjs';
import { validateSpineResult } from './spine-service-client.mjs';

const required = [
  'collectionId',
  'bookId',
  'requestId',
  'coverId',
  'expectedGeneration',
  'ticket',
  'remoteJobId',
  'origin',
  'phase',
  'retryAt',
];
const optional = ['failures', 'state', 'identity', 'localAssetId', 'result', 'errorCode'];
export const automaticSpineKey = (entry) => entry.collectionId + ':' + entry.bookId;
function validEntry(entry) {
  const invalid = () => {
    throw problem('INVALID_JOURNAL', 'Dziennik ilustracji wymaga sprawdzenia.');
  };
  if (
    !entry ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    required.some((key) => !Object.hasOwn(entry, key)) ||
    Object.keys(entry).some((key) => !required.includes(key) && !optional.includes(key)) ||
    !isUuid(entry.collectionId) ||
    typeof entry.bookId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(entry.bookId) ||
    !isUuid(entry.requestId) ||
    (entry.coverId !== null && !isHash(entry.coverId)) ||
    (entry.coverId === null && !isHash(entry.identity)) ||
    !Number.isSafeInteger(entry.expectedGeneration) ||
    entry.expectedGeneration < 0 ||
    !['prepared', 'submitted', 'downloaded', 'terminal'].includes(entry.phase) ||
    (entry.remoteJobId !== null && !isUuid(entry.remoteJobId)) ||
    (entry.retryAt !== null && !isIso(entry.retryAt))
  )
    invalid();
  try {
    if (normalizeServiceUrl(entry.origin) !== entry.origin) invalid();
  } catch {
    invalid();
  }
  if (
    entry.ticket !== null &&
    (!exactKeys(entry.ticket, ['collectionId', 'bookId', 'coverId', 'generation']) ||
      entry.ticket.collectionId !== entry.collectionId ||
      entry.ticket.bookId !== entry.bookId ||
      entry.ticket.coverId !== entry.coverId ||
      entry.ticket.generation !== entry.expectedGeneration + 1)
  )
    invalid();
  if (
    entry.failures !== undefined &&
    (!Number.isSafeInteger(entry.failures) || entry.failures < 0 || entry.failures > 100000)
  )
    invalid();
  if (
    entry.state !== undefined &&
    !['queued', 'generating', 'ready', 'failed', 'uncertain'].includes(entry.state)
  )
    invalid();
  if (
    entry.errorCode !== undefined &&
    entry.errorCode !== null &&
    !(typeof entry.errorCode === 'string' && /^[A-Z_]{1,64}$/.test(entry.errorCode))
  )
    invalid();
  if (entry.identity !== undefined && !isHash(entry.identity)) invalid();
  if (entry.localAssetId !== undefined && !isHash(entry.localAssetId)) invalid();
  if (entry.result !== undefined) {
    validateSpineResult(entry.result);
    if (entry.localAssetId && entry.result.assetId !== entry.localAssetId) invalid();
  }
  return entry;
}
function validate(value) {
  if (
    !exactKeys(value, ['version', 'entries']) ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  )
    throw problem('INVALID_JOURNAL', 'Dziennik ilustracji wymaga sprawdzenia.');
  const keys = new Set();
  for (const entry of value.entries) {
    validEntry(entry);
    const key = automaticSpineKey(entry);
    if (keys.has(key)) throw problem('INVALID_JOURNAL', 'Powtórzone powiązanie ilustracji.');
    keys.add(key);
  }
  return value;
}
export async function openAutomaticSpineJournal({ dataDir, fsAdapter = fs }) {
  const f = fsAdapter;
  await ensureDirectory(dataDir, f);
  const file = path.join(dataDir, 'automatic-spines.json');
  const stat = await assertSafePath(file, { missing: true, f });
  let snapshot = { version: 1, entries: [] };
  if (stat) {
    if (stat.size > 32 * 1024 * 1024)
      throw problem('INVALID_JOURNAL', 'Dziennik ilustracji jest zbyt duży.');
    try {
      snapshot = validate(JSON.parse(await f.readFile(file, 'utf8')));
    } catch {
      throw problem('INVALID_JOURNAL', 'Dziennik ilustracji wymaga sprawdzenia.');
    }
  }
  let queue = Promise.resolve(),
    closed = false;
  function mutate(action) {
    if (closed) return Promise.reject(problem('CLOSED', 'Dziennik jest zamknięty.'));
    const operation = queue.then(async () => {
      const next = structuredClone(snapshot);
      action(next);
      validate(next);
      await atomicWrite(file, JSON.stringify(next), f);
      snapshot = next;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    read() {
      return structuredClone(snapshot.entries);
    },
    put(entry) {
      return mutate((next) => {
        validEntry(entry);
        const key = automaticSpineKey(entry);
        next.entries = next.entries.filter((other) => automaticSpineKey(other) !== key);
        next.entries.push(structuredClone(entry));
      });
    },
    remove(key) {
      return mutate((next) => {
        next.entries = next.entries.filter((entry) => automaticSpineKey(entry) !== key);
      });
    },
    async close() {
      closed = true;
      await queue;
    },
  };
}
