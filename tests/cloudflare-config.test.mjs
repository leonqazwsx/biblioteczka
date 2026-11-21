import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const { cloudflareProviderConfig } = await import('../services/spine-service/config.mjs').catch(
  () => ({}),
);
const valid = {
  BOOKSHELF_SPINE_PROVIDER: 'cloudflare',
  BOOKSHELF_SPINE_FREE_CONFIRMED: '1',
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: 'fixture-cloudflare-secret-not-real',
};
test('explicit provider free confirmation account and token are mandatory', () => {
  assert.equal(typeof cloudflareProviderConfig, 'function');
  for (const patch of [
    { BOOKSHELF_SPINE_PROVIDER: '' },
    { BOOKSHELF_SPINE_PROVIDER: 'openai' },
    { BOOKSHELF_SPINE_FREE_CONFIRMED: '' },
    { BOOKSHELF_SPINE_FREE_CONFIRMED: 'true' },
    { CLOUDFLARE_ACCOUNT_ID: '../path' },
    { CLOUDFLARE_API_TOKEN: 'bad\nkey' },
  ])
    assert.throws(
      () => cloudflareProviderConfig({ ...valid, ...patch }),
      (e) => e.code === 'SERVICE_CONFIG' && !e.message.includes(valid.CLOUDFLARE_API_TOKEN),
    );
  assert.deepEqual(cloudflareProviderConfig(valid), {
    accountId: valid.CLOUDFLARE_ACCOUNT_ID,
    apiToken: valid.CLOUDFLARE_API_TOKEN,
    freeConfirmed: true,
  });
});
test('CLI refuses paid fallback and never prints secrets or writes them to the job journal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = {
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ...valid,
    BOOKSHELF_SPINE_FREE_CONFIRMED: '0',
    BOOKSHELF_SPINE_DATA_DIR: root,
    BOOKSHELF_SPINE_CREDENTIALS: JSON.stringify({
      'fixture-installation-token-for-cli': 'fixture',
    }),
    BOOKSHELF_SPINE_PORT: '47849',
    OPENAI_API_KEY: 'fixture-paid-fallback-secret',
  };
  const result = spawnSync(process.execPath, ['services/spine-service/main.mjs'], {
    env,
    encoding: 'utf8',
    timeout: 2000,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    1,
    JSON.stringify({
      status: result.status,
      error: result.error?.code,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  assert.match(result.stderr, /SERVICE_CONFIG/);
  assert.equal(result.stdout, '');
  for (const secret of [valid.CLOUDFLARE_API_TOKEN, env.OPENAI_API_KEY])
    assert.equal((result.stderr + result.stdout).includes(secret), false);
  assert.equal(
    await fs.stat(path.join(root, 'jobs.json')).then(
      () => true,
      () => false,
    ),
    false,
  );
});
