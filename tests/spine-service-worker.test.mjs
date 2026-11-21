import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {openJobStore} from '../services/spine-service/job-store.mjs';
import {SPINE_CONFIG} from '../src/spine-provider.mjs';
const {createWorker} = await import('../services/spine-service/worker.mjs').catch(() => ({}));
const {resolveUncertain} = await import('../services/spine-service/admin.mjs').catch(() => ({}));
import {png,variant} from './helpers/service-images.mjs';
async function setup(t, generate, extra = {}) {
  assert.equal(typeof createWorker, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-worker-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  let date = new Date('2026-10-14T12:00:00Z');
  const options = {dataDir, config: SPINE_CONFIG, clock: () => date, ...extra};
  const store = await openJobStore(options), worker = createWorker({store, provider: {config: SPINE_CONFIG, generate}, clock: options.clock});
  t.after(async () => {await worker.close(); await store.close();});
  const submit = (n, priority = 'backfill') => store.submit({installationId: 'one', requestId: randomUUID(), mime: 'image/png', bytes: variant(n), priority});
  return {store, worker, options, dataDir, submit, date: value => date = new Date(value)};
}
test('ten UTC attempts, serial provider calls, interactive priority and free cache', async t => {
  let calls = 0, active = 0, max = 0; const order = [];
  const a = await setup(t, async ({coverBytes}) => {calls++; active++; max = Math.max(max, active); order.push(coverBytes.toString().match(/Fixture\x00(\d+)/)[1]); await new Promise(r => setTimeout(r, 2)); active--; return {bytes: png, mime: 'image/png'};});
  const jobs = []; for (let n = 0; n < 11; n++) jobs.push(await a.submit(n, n === 9 ? 'interactive' : 'backfill'));
  a.worker.wake(); await a.worker.idle();
  assert.equal(calls, 10); assert.equal(max, 1); assert.equal(order[0], '9');
  assert.equal(a.store.usage('2026-10-14').attempts, 10); assert.equal(a.store.get({installationId: 'one', id: jobs[10].id}).state, 'queued');
  await a.submit(0); a.worker.wake(); await a.worker.idle(); assert.equal(calls, 10);
  a.date('2026-10-15T12:00:00Z'); a.worker.wake(); await a.worker.idle(); assert.equal(calls, 11);
  await a.submit(12); a.date('2026-10-13T12:00:00Z'); a.worker.wake(); await a.worker.idle(); assert.equal(calls, 11);
});
test('interrupted attempt reopens uncertain and is never redispatched; admin requires stopped service', async t => {
  let calls = 0; const a = await setup(t, async () => {calls++; throw Object.assign(new Error('timeout'), {code: 'AI_TIMEOUT'});});
  const job = await a.submit(1); a.worker.wake(); await a.worker.idle();
  assert.equal(a.store.get({installationId: 'one', id: job.id}).state, 'uncertain'); assert.equal(calls, 1);
  await assert.rejects(resolveUncertain({dataDir: a.dataDir, workId: job.id, resolution: 'failed'}), {code: 'DATA_IN_USE'});
  await a.worker.close(); await a.store.close();
  const reopened = await openJobStore(a.options); assert.equal(reopened.get({installationId: 'one', id: job.id}).state, 'uncertain'); await reopened.close();
  await resolveUncertain({dataDir: a.dataDir, workId: job.id, resolution: 'failed'});
  const final = await openJobStore(a.options); t.after(() => final.close()); assert.equal(final.work(job.id).state, 'failed'); assert.equal(final.usage('2026-10-14').attempts, 1);
});
test('crash after reservation is uncertain before startup worker can call provider', async t => {
  const a = await setup(t, async () => ({bytes: png, mime: 'image/png'})); const job = await a.submit(1);
  assert.equal(await a.store.beginAttempt({workId: job.id, day: '2026-10-14', limit: 10}), true);
  await a.worker.close(); await a.store.close(); const reopened = await openJobStore(a.options); t.after(() => reopened.close());
  assert.equal(reopened.work(job.id).state, 'uncertain'); assert.equal(reopened.usage('2026-10-14').attempts, 1);
});
test('disk failure after successful reply cannot retry, including after restart', async t => {
  let fail = false, calls = 0;
  const adapter = {...fs, rename: async (from, to) => {if (fail && to.endsWith('jobs.json')) throw Object.assign(new Error('disk'), {code: 'ENOSPC'}); return fs.rename(from, to);}};
  const a = await setup(t, async () => {calls++; fail = true; return {bytes: png, mime: 'image/png'};}, {fsAdapter: adapter});
  const job = await a.submit(1); a.worker.wake(); await a.worker.idle(); a.worker.wake(); await a.worker.idle(); assert.equal(calls, 1);
  await a.worker.close(); await a.store.close(); fail = false; const reopened = await openJobStore(a.options); t.after(() => reopened.close()); assert.equal(reopened.work(job.id).state, 'uncertain');
});
test('known rejection is terminal, corrupt attempt counter blocks startup, close bounds an ignoring provider', async t => {
  const a = await setup(t, async () => {throw Object.assign(new Error('rejected'), {code: 'AI_REJECTED'});});
  const job = await a.submit(1); a.worker.wake(); await a.worker.idle(); assert.equal(a.store.work(job.id).state, 'failed');
  await a.worker.close(); await a.store.close(); const target = path.join(a.dataDir, 'jobs.json'), snapshot = JSON.parse(await fs.readFile(target)); snapshot.days['2026-10-14'].attempts = -1; await fs.writeFile(target, JSON.stringify(snapshot));
  await assert.rejects(openJobStore(a.options), {code: 'CORRUPT_STORE'});
  let started; const start = new Promise(r => started = r); const b = await setup(t, async () => {started(); return new Promise(() => {});});
  const pending = await b.submit(1); b.worker.wake(); await start;
  await Promise.race([b.worker.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('close hung')), 500))]);
  assert.equal(b.store.work(pending.id).state, 'uncertain');
});
