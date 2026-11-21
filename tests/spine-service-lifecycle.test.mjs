import {SPINE_CONFIG} from '../src/spine-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';import {png} from './helpers/service-images.mjs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openJobStore} from '../services/spine-service/job-store.mjs';
const {runService} = await import('../services/spine-service/main.mjs').catch(() => ({}));
const {serviceConfig, localSpineServiceConfig} = await import('../services/spine-service/config.mjs').catch(() => ({}));
test('service starts on loopback, closes, releases data lock and restarts', async t => {
  assert.equal(typeof runService, 'function'); const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-lifecycle-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const options = {dataDir, port: 0, credentials: new Map([['fixture_service_token_1234567890', 'fixture']]), provider: {config: SPINE_CONFIG, generate: async () => {throw new Error('no work');}}};
  const service = await runService(options); assert.match(service.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  await assert.rejects(runService(options), {code: 'DATA_IN_USE'}); await service.close(); await service.close();
  const reopened = await runService(options); await reopened.close();
});
test('operator configuration validates ports, credentials and HTTPS without revealing secrets', () => {
  assert.equal(typeof serviceConfig, 'function'); assert.deepEqual(localSpineServiceConfig({}), null);
  assert.throws(() => localSpineServiceConfig({BOOKSHELF_SPINE_SERVICE_URL: 'http://example.com', BOOKSHELF_SPINE_SERVICE_TOKEN: 'private'}), {code: 'SERVICE_CONFIG'});
  assert.throws(() => localSpineServiceConfig({BOOKSHELF_SPINE_SERVICE_TOKEN: 'private'}), {code: 'SERVICE_CONFIG'});
  const valid = localSpineServiceConfig({BOOKSHELF_SPINE_SERVICE_URL: 'http://127.0.0.1:47842', BOOKSHELF_SPINE_SERVICE_TOKEN: 'fixture_service_token_1234567890'}); assert.equal(valid.url, 'http://127.0.0.1:47842');
  assert.throws(() => serviceConfig({BOOKSHELF_SPINE_CREDENTIALS: 'secret broken json'}), error => error.code === 'SERVICE_CONFIG' && !error.message.includes('secret'));
});
test('idle service removes an unresolved input after seven days without any provider call', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-retention-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  let date = new Date('2026-10-14T12:00:00Z'), calls = 0;
  const store = await openJobStore({dataDir, clock: () => date}), bytes = png;
  const job = await store.submit({installationId: 'fixture', requestId: randomUUID(), bytes, mime: 'image/png', priority: 'backfill'});
  await store.beginAttempt({workId: job.id, day: '2026-10-14', limit: 10}); await store.transition(job.id, {state: 'uncertain'}); const coverPath = store.work(job.id).coverPath; await store.close();
  const service = await runService({dataDir, port: 0, clock: () => date, maintenanceIntervalMs: 10, credentials: new Map([['fixture_service_token_1234567890', 'fixture']]), provider: {config: SPINE_CONFIG, generate: async () => {calls++;}}});
  t.after(() => service.close()); date = new Date('2026-10-23T12:00:00Z');
  for (let n = 0; n < 30; n++) {if (!await fs.stat(coverPath).then(() => true, () => false)) break; await delay(10);}
  await assert.rejects(fs.stat(coverPath), {code: 'ENOENT'}); assert.equal(calls, 0);
});
