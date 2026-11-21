import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createCloudflareProvider } from '../services/spine-service/cloudflare-provider.mjs';
import { cloudflareProfile } from '../services/spine-service/cloudflare-profiles.mjs';
import { readQualityCover } from '../services/spine-service/quality-cover.mjs';
import { openJobStore } from '../services/spine-service/job-store.mjs';
import { runQualityProbe } from '../services/spine-service/quality-probe.mjs';
import { png, variant } from './helpers/service-images.mjs';
const appRoot = path.resolve(import.meta.dirname, '..'),
  hash = (b) => createHash('sha256').update(b).digest('hex'),
  clock = () => new Date('2026-10-19T12:00:00Z');
const options = {
  accountId: '0123456789abcdef0123456789abcdef',
  apiToken: 'synthetic-framed-quality-token',
  freeConfirmed: true,
};
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-framed-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('bookshelf-framed-'));
    return fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 });
  });
  return root;
}

test('framed request changes composition prompt while keeping the exact automatic reference, model and dimensions', async () => {
  const sent = [],
    source = await readQualityCover({ appRoot, autoCleaned: true });
  for (const profile of ['smooth-v4-9b', 'framed-v5-9b'])
    await createCloudflareProvider({
      ...options,
      profile,
      fetchImpl: async (url, request) => {
        sent.push({ url, body: request.body });
        return Response.json({
          success: true,
          errors: [],
          result: { image: png.toString('base64') },
        });
      },
    }).generate(source);
  assert.equal(sent[1].url, sent[0].url);
  assert.equal(sent[1].body.get('width'), '320');
  assert.equal(sent[1].body.get('height'), '1600');
  assert.deepEqual([...sent[1].body.keys()], ['prompt', 'width', 'height', 'input_image_0']);
  assert.notEqual(sent[1].body.get('prompt'), sent[0].body.get('prompt'));
  assert.deepEqual(
    Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),
    Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()),
  );
});

test('framed result is cached separately without replacing the previous artwork or resetting its shared attempt count', async (t) => {
  const root = await temporary(t),
    dataDir = path.join(root, 'service'),
    config = cloudflareProfile('smooth-v4-9b').config;
  const store = await openJobStore({ dataDir, config, clock });
  await store.close();
  let calls = 0;
  const base = {
    dataDir,
    outputDir: path.join(root, 'old'),
    coverBytes: png,
    coverMime: 'image/png',
    expectedCoverHash: hash(png),
    clock,
    provider: {
      config,
      async generate() {
        return { bytes: png, mime: 'image/png' };
      },
    },
  };
  const before = await runQualityProbe(base),
    oldBytes = await fs.readFile(path.join(base.outputDir, before.file));
  const next = {
    ...base,
    outputDir: path.join(root, 'framed'),
    provider: {
      config: cloudflareProfile('framed-v5-9b').config,
      async generate() {
        calls++;
        return { bytes: variant(19), mime: 'image/png' };
      },
    },
  };
  const result = await runQualityProbe(next);
  assert.equal(result.state, 'ready');
  assert.equal(result.dayAttempts, 2);
  assert.notEqual(result.requestId, before.requestId);
  assert.equal(result.file, 'assets/diuna-cloudflare-9b-framed.png');
  assert.equal(result.result.promptVersion, 'cover-motif-cf-framed-v5');
  assert.deepEqual(await fs.readFile(path.join(base.outputDir, before.file)), oldBytes);
  assert.equal((await runQualityProbe(next)).requestsStarted, 0);
  assert.equal(calls, 1);
});

test('framed uncertain request is never automatically repeated', async (t) => {
  const root = await temporary(t),
    dataDir = path.join(root, 'service'),
    config = cloudflareProfile('framed-v5-9b').config;
  const store = await openJobStore({ dataDir, config, clock });
  await store.close();
  let calls = 0;
  const options = {
    dataDir,
    outputDir: path.join(root, 'out'),
    coverBytes: png,
    coverMime: 'image/png',
    expectedCoverHash: hash(png),
    clock,
    provider: {
      config,
      async generate() {
        calls++;
        throw Object.assign(Error('uncertain'), { code: 'PROVIDER_UNCERTAIN' });
      },
    },
  };
  assert.equal((await runQualityProbe(options)).state, 'uncertain');
  assert.equal((await runQualityProbe(options)).state, 'uncertain');
  assert.equal(calls, 1);
});

test('framed CLI checks the existing journal before loading remembered credentials and rejects mixed quality modes', async (t) => {
  const root = await temporary(t),
    env = { LOCALAPPDATA: root, SystemRoot: process.env.SystemRoot ?? '' },
    base = [
      'services/spine-service/pilot.mjs',
      '--free-confirmed',
      '--remember-credentials',
      '--quality-diuna-9b-framed',
    ];
  const result = spawnSync(process.execPath, base, {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Brak dziennika dotychczasowej proby/);
  assert.doesNotMatch(result.stdout, /Account ID|Token Workers AI/);
  const mixed = spawnSync(process.execPath, [...base, '--quality-diuna-9b-auto-reference'], {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /Nieprawidlowa konfiguracja lokalna/);
});
