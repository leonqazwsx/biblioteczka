import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openJobStore } from '../services/spine-service/job-store.mjs';
import { runQualityProbe } from '../services/spine-service/quality-probe.mjs';
import { readQualityCover } from '../services/spine-service/quality-cover.mjs';
import { cloudflareProfile } from '../services/spine-service/cloudflare-profiles.mjs';
import { variant, png } from './helpers/service-images.mjs';
const { recoverFramedQuota } = await import('../services/spine-service/quota-recovery.mjs').catch(
  () => ({}),
);
const appRoot = path.resolve(import.meta.dirname, '..'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const config = cloudflareProfile('framed-v5-9b').config,
  oldClock = () => new Date('2026-10-19T12:00:00.000Z'),
  afterClock = () => new Date('2026-10-20T00:01:00.000Z');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-quota-recovery-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('bookshelf-quota-recovery-'));
    return fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 });
  });
  const dataDir = path.join(root, 'service'),
    outputDir = path.join(root, 'output'),
    journal = path.join(dataDir, 'jobs.json');
  const initial = await openJobStore({ dataDir, config, clock: oldClock });
  const other = await initial.submit({
    installationId: 'unrelated',
    requestId: '11111111-2222-4333-a444-555555555555',
    bytes: png,
    mime: 'image/png',
    priority: 'interactive',
  });
  await initial.reserveAttempt({ workId: other.id, day: '2026-10-19' });
  await initial.transition(other.id, {
    state: 'uncertain',
    errorCode: 'PROVIDER_UNCERTAIN',
    retryAt: null,
  });
  await initial.close();
  const source = await readQualityCover({ appRoot, autoCleaned: true });
  const args = {
    dataDir,
    outputDir,
    ...source,
    clock: oldClock,
    provider: {
      config,
      async generate() {
        throw Object.assign(Error('synthetic old unclassified refusal'), {
          code: 'PROVIDER_UNCERTAIN',
          providerDiagnostic: { http: 429, codes: [4006] },
        });
      },
    },
  };
  const report = await runQualityProbe(args),
    reportFile = path.join(outputDir, 'cloudflare-framed-9b-result.json');
  const before = await fs.readFile(journal),
    snapshot = JSON.parse(before);
  return {
    root,
    dataDir,
    outputDir,
    journal,
    args,
    report,
    reportFile,
    before,
    snapshot,
    options: { dataDir, outputDir, confirmed: true, clock: afterClock },
  };
}

test('confirmed quota recovery preserves counters and unrelated uncertainties, backs up bytes, and enables one later attempt', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t);
  const result = await recoverFramedQuota(a.options);
  assert.equal(result.blocked, false);
  assert.equal(result.recovered, true);
  const next = JSON.parse(await fs.readFile(a.journal));
  assert.deepEqual(next.days, a.snapshot.days);
  assert.equal(next.lastDay, '2026-10-19');
  assert.deepEqual(next.works[0], a.snapshot.works[0]);
  assert.deepEqual(next.attempts[0], a.snapshot.attempts[0]);
  assert.equal(next.works[1].state, 'queued');
  assert.equal(next.works[1].retryAt, '2026-10-20T00:01:00.000Z');
  assert.equal(next.attempts[1].state, 'refused');
  assert.equal(next.attempts[1].reason, 'quota');
  const backups = path.join(a.root, 'backups'),
    beforeFile = path.join(backups, 'framed-quota-' + a.report.requestId + '.before.json');
  assert.deepEqual(await fs.readFile(beforeFile), a.before);
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(backups, 'framed-quota-' + a.report.requestId + '.recovery.json'),
      'utf8',
    ),
  );
  assert.equal(receipt.beforeHash, hash(a.before));
  const once = await fs.readFile(a.journal);
  assert.equal((await recoverFramedQuota(a.options)).recovered, false);
  assert.deepEqual(await fs.readFile(a.journal), once);
  let calls = 0;
  const ready = await runQualityProbe({
    ...a.args,
    clock: afterClock,
    provider: {
      config,
      async generate() {
        calls++;
        return { bytes: variant(37), mime: 'image/png' };
      },
    },
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.dayAttempts, 1);
  assert.equal(calls, 1);
  const final = JSON.parse(await fs.readFile(a.journal));
  assert.equal(final.days['2026-10-19'].attempts, 2);
  assert.equal(final.days['2026-10-20'].attempts, 1);
  assert.equal(final.works[0].state, 'uncertain');
});

test('before the UTC reset plus a minute recovery changes no journal or report and creates no recovery receipt', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t),
    reportBefore = await fs.readFile(a.reportFile);
  const result = await recoverFramedQuota({
    ...a.options,
    clock: () => new Date('2026-10-20T00:00:59.999Z'),
  });
  assert.equal(result.blocked, true);
  assert.equal(result.notBefore, '2026-10-20T00:01:00.000Z');
  assert.deepEqual(await fs.readFile(a.journal), a.before);
  assert.deepEqual(await fs.readFile(a.reportFile), reportBefore);
  await assert.rejects(
    fs.stat(path.join(a.root, 'backups', 'framed-quota-' + a.report.requestId + '.recovery.json')),
    { code: 'ENOENT' },
  );
});

test('missing human confirmation does not modify the uncertain attempt', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t);
  await assert.rejects(recoverFramedQuota({ ...a.options, confirmed: false }), {
    code: 'QUALITY_RECOVERY_CONFIRMATION',
  });
  assert.deepEqual(await fs.readFile(a.journal), a.before);
});

test('wrong diagnostics, a possible result or a different request cannot unlock a work', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t);
  for (const patch of [
    { diagnostic: { http: 429, codes: [9999] } },
    { diagnostic: { http: 429, codes: [4006, 3036] } },
    { diagnostic: { http: 500, codes: [4006] } },
    { result: { assetId: 'a'.repeat(64) } },
    { requestId: '11111111-2222-4333-a444-555555555555' },
  ]) {
    await fs.writeFile(a.reportFile, JSON.stringify({ ...a.report, ...patch }));
    await assert.rejects(recoverFramedQuota(a.options), { code: 'QUALITY_RECOVERY_SCOPE' });
    assert.deepEqual(await fs.readFile(a.journal), a.before);
  }
});

test('an already resolved work or a busy journal is not reclassified', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t),
    store = await openJobStore({ dataDir: a.dataDir, config, clock: afterClock });
  try {
    await assert.rejects(recoverFramedQuota(a.options), { code: 'DATA_IN_USE' });
    assert.deepEqual(await fs.readFile(a.journal), a.before);
    await store.transition(a.snapshot.works[1].workId, {
      state: 'failed',
      errorCode: 'OPERATOR_RESOLVED',
      retryAt: null,
    });
  } finally {
    await store.close();
  }
  const settled = await fs.readFile(a.journal);
  await assert.rejects(recoverFramedQuota(a.options), { code: 'QUALITY_RECOVERY_SCOPE' });
  assert.deepEqual(await fs.readFile(a.journal), settled);
});

test('failed journal publication resumes from its verified receipt without duplicating a reservation', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t);
  const f = {
    ...fs,
    async rename(from, to) {
      if (to === a.journal) throw Object.assign(Error('synthetic write failure'), { code: 'EIO' });
      return fs.rename(from, to);
    },
  };
  await assert.rejects(recoverFramedQuota({ ...a.options, fsAdapter: f }), { code: 'EIO' });
  assert.deepEqual(await fs.readFile(a.journal), a.before);
  assert.equal((await recoverFramedQuota(a.options)).recovered, true);
  const next = JSON.parse(await fs.readFile(a.journal));
  assert.equal(next.attempts.length, 2);
  assert.deepEqual(next.days, a.snapshot.days);
});

test('a conflicting recovery receipt blocks mutation', async (t) => {
  assert.equal(typeof recoverFramedQuota, 'function');
  const a = await fixture(t),
    file = path.join(a.root, 'backups', 'framed-quota-' + a.report.requestId + '.recovery.json');
  await fs.writeFile(file, '{"version":999}');
  await assert.rejects(recoverFramedQuota(a.options), { code: 'QUALITY_RECOVERY_CONFLICT' });
  assert.deepEqual(await fs.readFile(a.journal), a.before);
});

test('resume CLI requires the existing journal before credentials and rejects other quality modes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-quota-cli-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('bookshelf-quota-cli-'));
    return fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 });
  });
  const base = [
      'services/spine-service/pilot.mjs',
      '--free-confirmed',
      '--remember-credentials',
      '--resume-confirmed-framed-quota',
    ],
    env = { LOCALAPPDATA: root, SystemRoot: process.env.SystemRoot ?? '' };
  const result = spawnSync(process.execPath, base, {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Brak dziennika dotychczasowej proby/);
  assert.doesNotMatch(result.stdout, /Account ID|Token Workers AI/);
  const mixed = spawnSync(process.execPath, [...base, '--quality-diuna-9b-framed'], {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /Nieprawidlowa konfiguracja lokalna/);
});
