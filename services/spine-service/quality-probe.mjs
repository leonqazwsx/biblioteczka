import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openJobStore } from './job-store.mjs';
import {
  QUALITY_CONFIG,
  QUALITY_9B_CONFIG,
  STYLE_9B_CONFIG,
  SMOOTH_9B_CONFIG,
  FRAMED_9B_CONFIG,
  COVER_CLEAN_9B_CONFIG,
} from './cloudflare-profiles.mjs';
import { providerConfigHash } from './provider-config.mjs';
import { acquireDataLock } from '../../src/data-lock.mjs';
import { problem } from '../../src/domain.mjs';
import { atomicWrite, ensureDirectory, assertSafePath } from '../../src/durable-files.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifacts = new Map(
  [
    [QUALITY_CONFIG, 'diuna-cloudflare-v2', 'cloudflare-quality-result.json'],
    [QUALITY_9B_CONFIG, 'diuna-cloudflare-9b', 'cloudflare-quality-9b-result.json'],
    [STYLE_9B_CONFIG, 'diuna-cloudflare-9b-style', 'cloudflare-style-9b-result.json'],
    [SMOOTH_9B_CONFIG, 'diuna-cloudflare-9b-smooth', 'cloudflare-smooth-9b-result.json'],
    [FRAMED_9B_CONFIG, 'diuna-cloudflare-9b-framed', 'cloudflare-framed-9b-result.json'],
    [
      COVER_CLEAN_9B_CONFIG,
      'diuna-cloudflare-9b-cover-cleaned',
      'cloudflare-cover-cleanup-result.json',
    ],
  ].map(([config, stem, report]) => [providerConfigHash(config), { stem, report }]),
);
export function qualityRequestId(coverHash, config, sampleKey = 'diuna') {
  const value = hash(
    Buffer.from(sampleKey + '-quality|' + coverHash + '|' + providerConfigHash(config)),
  );
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function diagnostic(value) {
  return value && typeof value === 'object'
    ? {
        http:
          Number.isSafeInteger(value.http) && value.http >= 100 && value.http <= 599
            ? value.http
            : null,
        codes: Array.isArray(value.codes)
          ? [
              ...new Set(
                value.codes.filter(
                  (code) => Number.isSafeInteger(code) && code >= 0 && code <= 999999999,
                ),
              ),
            ]
          : [],
      }
    : null;
}
export async function assertQualityProbeReady({ dataDir }) {
  if (!path.isAbsolute(dataDir ?? ''))
    throw problem('SERVICE_CONFIG', 'Nieprawidłowy katalog próby.');
  const journal = await fs.stat(path.join(dataDir, 'jobs.json')).catch(() => null);
  if (!journal?.isFile()) throw problem('QUALITY_NO_PILOT', 'Brak dziennika dotychczasowej próby.');
  const lock = await acquireDataLock(dataDir);
  await lock.release();
}
async function backupJournal(dataDir) {
  const bytes = await fs.readFile(path.join(dataDir, 'jobs.json'));
  const folder = path.join(path.dirname(dataDir), 'backups');
  await ensureDirectory(folder);
  const target = path.join(
    folder,
    'before-diuna-quality-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomUUID() +
      '.json',
  );
  await fs.writeFile(target, bytes, { flag: 'wx' });
  if (hash(await fs.readFile(target)) !== hash(bytes))
    throw problem('QUALITY_BACKUP', 'Nie udało się potwierdzić kopii dziennika.');
}
async function writeImage(outputDir, job, image, stem) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mime];
  if (!extension) throw problem('INVALID_IMAGE', 'Nieznany format wyniku.');
  const relative = 'assets/' + stem + '.' + extension,
    target = path.join(outputDir, relative);
  await ensureDirectory(path.dirname(target));
  await assertSafePath(target, { missing: true });
  try {
    await fs.writeFile(target, image.bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (hash(await fs.readFile(target)) !== job.result.assetId)
    throw problem('QUALITY_OUTPUT_CONFLICT', 'Plik porównania zawiera już inny obraz.');
  return relative;
}
export async function runQualityProbe({
  dataDir,
  outputDir,
  coverBytes,
  coverMime,
  expectedCoverHash,
  provider,
  clock = () => new Date(),
  signal,
  sampleKey = 'diuna',
}) {
  const signature = provider?.config && providerConfigHash(provider.config);
  const artifact = artifacts.get(signature);
  if (
    typeof sampleKey !== 'string' ||
    sampleKey.length > 48 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sampleKey) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(sampleKey) ||
    !Buffer.isBuffer(coverBytes) ||
    !path.isAbsolute(outputDir ?? '') ||
    typeof provider?.generate !== 'function' ||
    !artifact
  )
    throw problem('SERVICE_CONFIG', 'Nieprawidłowa konfiguracja próby jakości.');
  const installationId = 'pilot-quality-' + sampleKey;
  if (hash(coverBytes) !== expectedCoverHash)
    throw problem('QUALITY_COVER_CHANGED', 'Okładka próby jest inna niż zatwierdzona.');
  if (signal?.aborted) throw problem('PILOT_CANCELLED', 'Przerwano próbę.');
  await assertQualityProbeReady({ dataDir });
  const store = await openJobStore({ dataDir, config: provider.config, clock });
  let requestsStarted = 0,
    responseDiagnostic = null;
  try {
    if (signal?.aborted) throw problem('PILOT_CANCELLED', 'Przerwano próbę.');
    await backupJournal(dataDir);
    const requestId = qualityRequestId(expectedCoverHash, provider.config, sampleKey);
    let job = await store.submit({
      installationId,
      requestId,
      mime: coverMime,
      bytes: coverBytes,
      priority: 'interactive',
    });
    if (job.state === 'queued' && !signal?.aborted) {
      const reservation = await store.reserveAttempt({
        workId: job.id,
        day: clock().toISOString().slice(0, 10),
      });
      if (reservation) {
        requestsStarted = 1;
        let abort;
        try {
          const interrupted = new Promise((_, reject) => {
            abort = () => reject(problem('PROVIDER_UNCERTAIN', 'Przerwano próbę.'));
            signal?.addEventListener('abort', abort, { once: true });
          });
          if (signal?.aborted) throw problem('PROVIDER_UNCERTAIN', 'Przerwano próbę.');
          const result = await Promise.race([
            provider.generate({ coverBytes, coverMime, signal }),
            interrupted,
          ]);
          await store.complete({
            workId: job.id,
            ...reservation,
            bytes: result.bytes,
            mime: result.mime,
          });
        } catch (error) {
          responseDiagnostic = diagnostic(error.providerDiagnostic);
          const kind = {
            PROVIDER_QUOTA: 'quota',
            PROVIDER_CAPACITY: 'capacity',
            PROVIDER_AUTH: 'authorization',
          }[error.code];
          if (kind)
            await store.deferAttempt({
              workId: job.id,
              ...reservation,
              kind,
              retryAfterMs: error.retryAfterMs ?? 0,
              uncertain: kind === 'authorization' && error.uncertain === true,
            });
          else
            await store.transition(job.id, {
              state: error.code === 'AI_REJECTED' ? 'failed' : 'uncertain',
              errorCode: error.code === 'AI_REJECTED' ? 'AI_REJECTED' : 'PROVIDER_UNCERTAIN',
              retryAt: null,
            });
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      }
    }
    job = store.get({ installationId, id: job.id });
    let file = null;
    if (job.state === 'ready')
      file = await writeImage(
        outputDir,
        job,
        await store.readResult({ installationId, id: job.id }),
        artifact.stem.replace(/^diuna-/, sampleKey + '-'),
      );
    await ensureDirectory(outputDir);
    const reportFile = path.join(outputDir, artifact.report);
    if (!responseDiagnostic && job.state !== 'ready') {
      try {
        const previous = JSON.parse(await fs.readFile(reportFile, 'utf8'));
        if (previous.requestId === requestId) responseDiagnostic = diagnostic(previous.diagnostic);
      } catch {}
    }
    const report = {
      version: 1,
      source: 'cloudflare-free-quality-probe',
      requestId,
      state: job.state,
      errorCode: job.errorCode,
      retryAt: job.retryAt,
      file,
      result: job.result,
      diagnostic: responseDiagnostic,
      requestsStarted,
      dayAttempts: store.usage(clock().toISOString().slice(0, 10)).attempts,
    };
    await atomicWrite(reportFile, JSON.stringify(report, null, 2));
    return report;
  } finally {
    await store.close();
  }
}
