import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const credentials = await import('../services/spine-service/pilot-credentials.mjs').catch(
  () => ({}),
);
const accountId = '0123456789abcdef0123456789abcdef',
  apiToken = 'synthetic-private-token-never-real';
const entry = { accountId, apiToken },
  root = path.resolve(import.meta.dirname, '..');
async function temporary(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-credentials-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('bookshelf-credentials-'));
    return fs.rm(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 25 });
  });
  return folder;
}
function promptFor(values) {
  let closed = false;
  return {
    factory: () => ({
      async ask() {
        assert.ok(values.length);
        return values.shift();
      },
      async close() {
        closed = true;
      },
    }),
    get closed() {
      return closed;
    },
  };
}

test(
  'remembered credentials survive a fresh store and skip both terminal fields',
  { skip: process.platform !== 'win32' },
  async (t) => {
    assert.equal(typeof credentials.createCredentialStore, 'function');
    const localAppData = await temporary(t),
      store = credentials.createCredentialStore({ localAppData });
    assert.equal(await store.load(), null);
    const prompt = promptFor([accountId, apiToken]);
    const first = await credentials.readOperatorCredentials({
      store,
      remember: true,
      promptFactory: prompt.factory,
    });
    assert.equal(first.source, 'entered');
    assert.equal(first.saved, true);
    assert.equal(prompt.closed, true);
    const file = path.join(localAppData, 'BiblioteczkaSpinePilot/credentials/cloudflare-v1.dpapi');
    const encrypted = await fs.readFile(file);
    assert.equal(encrypted.includes(Buffer.from(apiToken)), false);
    assert.equal(encrypted.includes(Buffer.from(accountId)), false);
    const next = credentials.createCredentialStore({ localAppData });
    const second = await credentials.readOperatorCredentials({
      store: next,
      promptFactory: () => {
        throw Error('must not ask again');
      },
    });
    assert.deepEqual({ accountId: second.accountId, apiToken: second.apiToken }, entry);
    assert.equal(second.source, 'stored');
    const journal = path.join(localAppData, 'BiblioteczkaSpinePilot/service/jobs.json');
    await fs.mkdir(path.dirname(journal), { recursive: true });
    await fs.writeFile(journal, 'journal-untouched');
    assert.equal(await next.forget(), true);
    assert.equal(await next.load(), null);
    assert.equal(await next.forget(), false);
    assert.equal(await fs.readFile(journal, 'utf8'), 'journal-untouched');
  },
);

test('ordinary terminal entry remains session-only without the remember option', async (t) => {
  assert.equal(typeof credentials.readOperatorCredentials, 'function');
  const store = credentials.createCredentialStore({ localAppData: await temporary(t) }),
    prompt = promptFor([accountId, apiToken]);
  const result = await credentials.readOperatorCredentials({
    store,
    promptFactory: prompt.factory,
  });
  assert.equal(result.saved, false);
  assert.equal(result.apiToken, apiToken);
  assert.equal(prompt.closed, true);
  assert.equal(await store.load(), null);
});

test('replacement bypasses a damaged saved value and failed encryption keeps the original bytes', async (t) => {
  assert.equal(typeof credentials.createCredentialStore, 'function');
  const localAppData = await temporary(t),
    file = path.join(localAppData, 'BiblioteczkaSpinePilot/credentials/cloudflare-v1.dpapi');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'old-corrupted-ciphertext');
  const failed = credentials.createCredentialStore({
    localAppData,
    protection: {
      async protect() {
        throw Error(apiToken);
      },
      async unprotect() {
        throw Error('must not load on replace');
      },
    },
  });
  const prompt = promptFor([accountId, apiToken]);
  await assert.rejects(
    credentials.readOperatorCredentials({
      store: failed,
      remember: true,
      replace: true,
      promptFactory: prompt.factory,
    }),
    (error) => {
      assert.equal(error.code, 'PILOT_CREDENTIALS_WRITE');
      assert.equal(error.message.includes(apiToken), false);
      return true;
    },
  );
  assert.equal(prompt.closed, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'old-corrupted-ciphertext');
  const repaired = credentials.createCredentialStore({
    localAppData,
    protection: {
      async protect() {
        return Buffer.from('replacement-ciphertext');
      },
      async unprotect() {
        throw Error('must not load on replace');
      },
    },
  });
  await credentials.readOperatorCredentials({
    store: repaired,
    remember: true,
    replace: true,
    promptFactory: promptFor([accountId, apiToken]).factory,
  });
  assert.equal(await fs.readFile(file, 'utf8'), 'replacement-ciphertext');
});

test(
  'damaged credentials fail safely without printing secrets or silently asking again',
  { skip: process.platform !== 'win32' },
  async (t) => {
    assert.equal(typeof credentials.createCredentialStore, 'function');
    const localAppData = await temporary(t),
      store = credentials.createCredentialStore({ localAppData });
    await store.save(entry);
    const file = path.join(localAppData, 'BiblioteczkaSpinePilot/credentials/cloudflare-v1.dpapi'),
      bytes = await fs.readFile(file);
    bytes[bytes.length - 1] ^= 1;
    await fs.writeFile(file, bytes);
    await assert.rejects(
      credentials.readOperatorCredentials({
        store,
        promptFactory: () => {
          throw Error('must stop before prompting');
        },
      }),
      (error) => {
        assert.equal(error.code, 'PILOT_CREDENTIALS_READ');
        assert.equal(error.message.includes(apiToken), false);
        return true;
      },
    );
  },
);

test('cancelled input closes the terminal and never saves a partial credential', async (t) => {
  assert.equal(typeof credentials.readOperatorCredentials, 'function');
  const store = credentials.createCredentialStore({ localAppData: await temporary(t) });
  let closed = false;
  await assert.rejects(
    credentials.readOperatorCredentials({
      store,
      remember: true,
      promptFactory: () => ({
        async ask() {
          throw Object.assign(Error('cancel'), { code: 'PILOT_CANCELLED' });
        },
        async close() {
          closed = true;
        },
      }),
    }),
    { code: 'PILOT_CANCELLED' },
  );
  assert.equal(closed, true);
  assert.equal(await store.load(), null);
});

test('forget CLI removes only the saved credential and does not require journal, terminal or provider', async (t) => {
  const localAppData = await temporary(t),
    directory = path.join(localAppData, 'BiblioteczkaSpinePilot/credentials');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'cloudflare-v1.dpapi'), 'cipher');
  await fs.writeFile(path.join(directory, 'keep.txt'), 'keep');
  const result = spawnSync(
    process.execPath,
    ['services/spine-service/pilot.mjs', '--free-confirmed', '--forget-credentials'],
    {
      cwd: root,
      env: { LOCALAPPDATA: localAppData, SystemRoot: process.env.SystemRoot ?? '' },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usunieto zapisane dane/);
  assert.doesNotMatch(result.stdout, /Account ID|Token Workers AI/);
  await assert.rejects(fs.stat(path.join(directory, 'cloudflare-v1.dpapi')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'keep');
});
