import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readQualityCover } from '../services/spine-service/quality-cover.mjs';
import { createCloudflareProvider } from '../services/spine-service/cloudflare-provider.mjs';
import { png } from './helpers/service-images.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const autoFile =
  'output/execution/spine-cover-cleanup-9b-20261019/assets/diuna-cloudflare-9b-cover-cleaned.jpg';
const autoHash = '3f3d25811f4904e3ff0ab248153a25ad9df814b8aef4f1daf754365122368542';
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-auto-ref-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 }));
  return directory;
}

test('auto-reference selects the approved cleanup output while keeping original and manual options', async () => {
  const automatic = await readQualityCover({ appRoot: root, autoCleaned: true });
  assert.equal(automatic.expectedCoverHash, autoHash);
  assert.equal(automatic.coverMime, 'image/jpeg');
  assert.deepEqual(automatic.coverBytes, await fs.readFile(path.join(root, autoFile)));
  assert.notEqual(hash((await readQualityCover({ appRoot: root })).coverBytes), autoHash);
  assert.equal(
    (await readQualityCover({ appRoot: root, textless: true })).expectedCoverHash,
    '41977fb72cbee18c7addcb2b92de2fd8d8698211b3091d7efb4ad421c7703fdf',
  );
});

test('missing, changed or conflicting automatic references stop before transport', async (t) => {
  const directory = await temporary(t);
  await assert.rejects(readQualityCover({ appRoot: directory, autoCleaned: true }), {
    code: 'QUALITY_REFERENCE_CHANGED',
  });
  const file = path.join(directory, autoFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = await fs.readFile(path.join(root, autoFile));
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(file, bytes);
  await assert.rejects(readQualityCover({ appRoot: directory, autoCleaned: true }), {
    code: 'QUALITY_REFERENCE_CHANGED',
  });
  for (const options of [{ textless: true, autoCleaned: true }, { autoCleaned: 'true' }])
    await assert.rejects(readQualityCover({ appRoot: root, ...options }), {
      code: 'SERVICE_CONFIG',
    });
});

test('auto-reference sends the same spine request as manual cleanup except for its image', async () => {
  const sent = [],
    provider = createCloudflareProvider({
      accountId: '0123456789abcdef0123456789abcdef',
      apiToken: 'synthetic-auto-reference-token',
      freeConfirmed: true,
      profile: 'smooth-v4-9b',
      fetchImpl: async (url, request) => {
        sent.push({ url, body: request.body });
        return Response.json({
          success: true,
          errors: [],
          result: { image: png.toString('base64') },
        });
      },
    });
  await provider.generate(await readQualityCover({ appRoot: root, textless: true }));
  await provider.generate(await readQualityCover({ appRoot: root, autoCleaned: true }));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, sent[1].url);
  assert.deepEqual([...sent[1].body.keys()], ['prompt', 'width', 'height', 'input_image_0']);
  for (const field of ['prompt', 'width', 'height'])
    assert.equal(sent[0].body.get(field), sent[1].body.get(field));
  assert.equal(sent[1].body.get('width'), '320');
  assert.equal(sent[1].body.get('height'), '1600');
  assert.notDeepEqual(
    Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()),
    Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),
  );
});

test('auto-reference CLI requires the existing journal before credentials and rejects cleanup or manual modes', async (t) => {
  const directory = await temporary(t),
    env = { LOCALAPPDATA: directory, SystemRoot: process.env.SystemRoot ?? '' },
    base = [
      'services/spine-service/pilot.mjs',
      '--free-confirmed',
      '--quality-diuna-9b-auto-reference',
    ];
  const missing = spawnSync(process.execPath, base, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Brak dziennika dotychczasowej proby/);
  assert.doesNotMatch(missing.stdout, /Account ID|Token Workers AI/);
  for (const mode of ['--quality-diuna-9b-cleanup', '--quality-diuna-9b-textless']) {
    const mixed = spawnSync(process.execPath, [...base, mode], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(mixed.status, 1);
    assert.match(mixed.stderr, /Nieprawidlowa konfiguracja lokalna/);
  }
});
