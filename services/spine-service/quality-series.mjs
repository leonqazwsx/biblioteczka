import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { problem } from '../../src/domain.mjs';
import { atomicWrite, ensureDirectory } from '../../src/durable-files.mjs';
import { providerConfigHash } from './provider-config.mjs';
import { SMOOTH_9B_CONFIG } from './cloudflare-profiles.mjs';
import { runQualityProbe } from './quality-probe.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const QUALITY_SERIES_SAMPLES = Object.freeze([
  Object.freeze({
    sampleKey: 'rok-1984',
    title: 'Rok 1984',
    authors: ['George Orwell'],
    reference: 'output/execution/spine-variety-9b-20261019/references/rok-1984-textless.png',
    expectedCoverHash: '02b35a8fa6352176510e0851e22cfe58c45b05def67fd07e1782f72c93b530c4',
    coverMime: 'image/png',
  }),
  Object.freeze({
    sampleKey: 'quo-vadis',
    title: 'Quo vadis',
    authors: ['Henryk Sienkiewicz'],
    reference: 'output/execution/spine-variety-9b-20261019/references/quo-vadis-textless.png',
    expectedCoverHash: '55434e85bb59e4c76fefbd0f61574c33d323d1bdd2c177ccadc9e5af51485cee',
    coverMime: 'image/png',
  }),
]);
export async function readQualitySamples({ appRoot }) {
  if (!path.isAbsolute(appRoot ?? ''))
    throw problem('SERVICE_CONFIG', 'Nieprawidłowy katalog próbek.');
  return Promise.all(
    QUALITY_SERIES_SAMPLES.map(async (sample) => {
      const coverBytes = await fs.readFile(path.join(appRoot, sample.reference)).catch(() => {
        throw problem('QUALITY_REFERENCE_CHANGED', 'Brak zatwierdzonej referencji.');
      });
      if (hash(coverBytes) !== sample.expectedCoverHash)
        throw problem('QUALITY_REFERENCE_CHANGED', 'Referencja jest inna niż zatwierdzona.');
      return { ...sample, coverBytes };
    }),
  );
}
export async function runQualitySeries({
  dataDir,
  outputDir,
  samples,
  provider,
  clock = () => new Date(),
  signal,
}) {
  if (
    !path.isAbsolute(dataDir ?? '') ||
    !path.isAbsolute(outputDir ?? '') ||
    !Array.isArray(samples) ||
    samples.length !== 2 ||
    typeof provider?.generate !== 'function' ||
    !provider.config ||
    providerConfigHash(provider.config) !== providerConfigHash(SMOOTH_9B_CONFIG)
  )
    throw problem('SERVICE_CONFIG', 'Nieprawidłowa konfiguracja serii.');
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (
      !sample ||
      sample.sampleKey !== QUALITY_SERIES_SAMPLES[i].sampleKey ||
      typeof sample.title !== 'string' ||
      !Buffer.isBuffer(sample.coverBytes) ||
      hash(sample.coverBytes) !== sample.expectedCoverHash ||
      sample.coverMime !== 'image/png'
    )
      throw problem('QUALITY_REFERENCE_CHANGED', 'Seria zawiera nieprawidłową referencję.');
  }
  const report = {
    version: 1,
    source: 'cloudflare-free-quality-series',
    state: 'running',
    requestsStarted: 0,
    results: [],
  };
  for (const sample of samples) {
    const result = await runQualityProbe({
      dataDir,
      outputDir: path.join(outputDir, sample.sampleKey),
      sampleKey: sample.sampleKey,
      coverBytes: sample.coverBytes,
      coverMime: sample.coverMime,
      expectedCoverHash: sample.expectedCoverHash,
      provider,
      clock,
      signal,
    });
    report.requestsStarted += result.requestsStarted;
    report.results.push({
      sampleKey: sample.sampleKey,
      title: sample.title,
      ...result,
      file: result.file ? sample.sampleKey + '/' + result.file : null,
    });
    report.state =
      result.state !== 'ready'
        ? 'stopped'
        : report.results.length === samples.length
          ? 'ready'
          : 'running';
    await ensureDirectory(outputDir);
    await atomicWrite(
      path.join(outputDir, 'quality-series-result.json'),
      JSON.stringify(report, null, 2),
    );
    if (result.state !== 'ready') break;
  }
  return report;
}
