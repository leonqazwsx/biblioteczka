import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SPINE_CONFIG } from '../src/spine-provider.mjs';
const { openJobStore } = await import('../services/spine-service/job-store.mjs').catch(() => ({}));
import { png, variant } from './helpers/service-images.mjs';
async function setup(t, extra = {}) {
  assert.equal(typeof openJobStore, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-store-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir,
    config: SPINE_CONFIG,
    clock: () => new Date('2026-10-14T12:00:00Z'),
    ...extra,
  };
  const store = await openJobStore(options);
  t.after(() => store.close());
  return { store, options, dataDir };
}
function request(extra = {}) {
  return {
    installationId: 'one',
    requestId: randomUUID(),
    mime: 'image/png',
    bytes: png,
    priority: 'backfill',
    ...extra,
  };
}
test('concurrent identical covers share one work; UUID survives restart; foreign reads are hidden', async (t) => {
  const { store, options } = await setup(t),
    input = request();
  const [first, second] = await Promise.all([
    store.submit(input),
    store.submit(request({ installationId: 'two' })),
  ]);
  assert.equal(store.queued().length, 1);
  assert.equal(first.id, second.id);
  assert.equal((await store.submit(input)).id, first.id);
  assert.throws(() => store.get({ installationId: 'other', id: first.id }), { code: 'NOT_FOUND' });
  await assert.rejects(store.submit({ ...input, bytes: variant('different') }), {
    code: 'CONFLICT',
  });
  const queued = store.queued();
  await store.close();
  const reopened = await openJobStore(options);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.queued(), queued);
  assert.deepEqual(reopened.get({ installationId: 'one', id: first.id }), first);
});
test('invalid input never creates work, including unknown fields and oversized images', async (t) => {
  const { store } = await setup(t);
  for (const patch of [
    { extra: true },
    { requestId: '../bad' },
    { priority: 'urgent' },
    { mime: 'image/jpeg' },
    { bytes: Buffer.from('bad') },
  ])
    await assert.rejects(store.submit(request(patch)), { code: 'INVALID' });
  await assert.rejects(store.submit(request({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) })), {
    code: 'TOO_LARGE',
  });
  assert.equal(store.queued().length, 0);
});
test('ready result is verified, retained and reusable even with a full queue', async (t) => {
  const { store } = await setup(t, { maxQueued: 1 });
  const input = request(),
    first = await store.submit(input);
  await assert.rejects(store.submit(request({ bytes: variant('new') })), { code: 'QUEUE_FULL' });
  await store.beginAttempt({ workId: first.id, day: '2026-10-14' });
  await store.complete({ workId: first.id, bytes: png, mime: 'image/png' });
  await store.prune(new Date('2026-10-22T00:00:00Z'));
  assert.deepEqual((await store.readResult({ installationId: 'one', id: first.id })).bytes, png);
  assert.equal((await store.submit(request())).id, first.id);
  assert.equal((await store.submit(input)).state, 'ready');
  assert.equal(
    await fs.stat(store.work(first.id).coverPath).then(
      () => true,
      () => false,
    ),
    false,
  );
});
test('uncertain cover retained seven days; shared active cover is not removed', async (t) => {
  const { store } = await setup(t);
  const first = await store.submit(request());
  await store.transition(first.id, { state: 'uncertain' });
  await store.prune(new Date('2026-10-20T12:00:00Z'));
  assert.ok(await fs.stat(store.work(first.id).coverPath));
  await store.prune(new Date('2026-10-21T12:00:00Z'));
  await assert.rejects(fs.stat(store.work(first.id).coverPath), { code: 'ENOENT' });
  assert.equal(store.get({ installationId: 'one', id: first.id }).state, 'uncertain');
});
test('corrupt journal is preserved and second instance is rejected', async (t) => {
  const { store, options, dataDir } = await setup(t);
  await assert.rejects(openJobStore(options), { code: 'DATA_IN_USE' });
  await store.close();
  const target = path.join(dataDir, 'jobs.json');
  await fs.writeFile(target, 'corrupt');
  await assert.rejects(openJobStore(options), { code: 'CORRUPT_STORE' });
  assert.equal(await fs.readFile(target, 'utf8'), 'corrupt');
});
test('symlinked asset directory fails closed', async (t) => {
  const { store, options, dataDir } = await setup(t);
  await store.close();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'service-link-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.rm(path.join(dataDir, 'covers'), { recursive: true });
  await fs.symlink(outside, path.join(dataDir, 'covers'), 'junction');
  await assert.rejects(openJobStore(options), { code: 'UNSAFE_PATH' });
});
test('correct signatures cannot admit malformed input or publish malformed provider output', async (t) => {
  const { store } = await setup(t);
  const invalidImages = [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png'],
    [Buffer.from([255, 216, 255, 217]), 'image/jpeg'],
    [Buffer.from('RIFF0000WEBPx'), 'image/webp'],
  ];
  for (const [bytes, mime] of invalidImages)
    await assert.rejects(store.submit(request({ bytes, mime })), { code: 'INVALID' });
  assert.equal(store.queued().length, 0);
  const job = await store.submit(request());
  await store.beginAttempt({ workId: job.id, day: '2026-10-14', limit: 10 });
  await assert.rejects(
    store.complete({ workId: job.id, bytes: invalidImages[0][0], mime: 'image/png' }),
    { code: 'INVALID' },
  );
  assert.equal(store.work(job.id).state, 'generating');
  assert.equal(store.usage('2026-10-14').attempts, 1);
});
