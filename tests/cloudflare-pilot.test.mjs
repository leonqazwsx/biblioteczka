import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { run } from '../src/main.mjs';
import { CLOUDFLARE_SPINE_CONFIG } from '../services/spine-service/provider-config.mjs';
import { installationId } from '../src/installation.mjs';
import { runService } from '../services/spine-service/main.mjs';

const operator = await import('../services/spine-service/pilot-input.mjs').catch(() => ({}));
const runtime = await import('../services/spine-service/pilot-runtime.mjs').catch(() => ({}));
const fakeId = '0123456789abcdef0123456789abcdef',
  fakeToken = 'fixture-secret-not-a-real-cloudflare-token';
const appRoot = path.resolve(import.meta.dirname, '..');

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf-pilot-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('bookshelf-pilot-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('operator identifies the invalid field without including credential values', () => {
  assert.equal(typeof operator.operatorConfig, 'function');
  for (const [patch, code] of [
    [{ freeConfirmed: false }, 'PILOT_FREE_REQUIRED'],
    [{ accountId: 'https://dash.cloudflare.com/private-account' }, 'PILOT_ACCOUNT_ID'],
    [{ apiToken: 'Bearer ' + fakeToken }, 'PILOT_API_TOKEN'],
    [{ apiToken: '\"' + fakeToken + '\"' }, 'PILOT_API_TOKEN'],
    [{ apiToken: "'" + fakeToken + "'" }, 'PILOT_API_TOKEN'],
  ]) {
    assert.throws(
      () =>
        operator.operatorConfig({
          accountId: fakeId,
          apiToken: fakeToken,
          freeConfirmed: true,
          ...patch,
        }),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.message.includes(fakeToken), false);
        assert.equal(error.message.includes(fakeId), false);
        return true;
      },
    );
  }
  const valid = operator.operatorConfig({
    accountId: '  ' + fakeId + '  ',
    apiToken: '  ' + fakeToken + '  ',
    freeConfirmed: true,
  });
  assert.deepEqual(valid, { accountId: fakeId, apiToken: fakeToken, freeConfirmed: true });
});

test('hidden terminal entry returns the secret without echoing it', async () => {
  assert.equal(typeof operator.readHiddenLine, 'function');
  const input = new PassThrough(),
    output = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  output.columns = 80;
  let printed = '';
  output.on('data', (bytes) => {
    printed += bytes.toString();
  });
  const answer = operator.readHiddenLine('Token: ', { input, output });
  input.write(fakeToken + '\r');
  assert.equal(await answer, fakeToken);
  assert.equal(printed.includes(fakeToken), false);
  assert.match(printed, /Token:/);
  assert.equal(input.listenerCount('keypress'), 0);
});

test('Ctrl+C cancels hidden entry and releases terminal raw mode', async () => {
  assert.equal(typeof operator.readHiddenLine, 'function');
  const input = new PassThrough(),
    output = new PassThrough(),
    modes = [];
  input.isTTY = true;
  input.setRawMode = (value) => {
    modes.push(value);
    return input;
  };
  output.columns = 80;
  const answer = operator.readHiddenLine('Token: ', { input, output });
  input.write('\x03');
  await assert.rejects(answer, { code: 'PILOT_CANCELLED' });
  assert.equal(modes.at(-1), false);
  assert.equal(input.listenerCount('keypress'), 0);
});

test('consecutive secret prompts keep echo disabled even for pasted type-ahead', async () => {
  assert.equal(typeof operator.createHiddenPrompt, 'function');
  const input = new PassThrough(),
    output = new PassThrough(),
    modes = [];
  let referenced = true;
  input.ref = () => {
    referenced = true;
  };
  input.unref = () => {
    referenced = false;
  };
  input.isTTY = true;
  input.setRawMode = (value) => {
    modes.push(value);
    return input;
  };
  output.columns = 80;
  let printed = '';
  output.on('data', (bytes) => {
    printed += bytes.toString();
  });
  const prompt = operator.createHiddenPrompt({ input, output });
  try {
    const first = prompt.ask('Account: ');
    input.write(fakeId + '\r' + fakeToken + '\r');
    assert.equal(await first, fakeId);
    assert.equal(modes.includes(false), false);
    assert.equal(await prompt.ask('Token: '), fakeToken);
    assert.equal(printed.includes(fakeId), false);
    assert.equal(printed.includes(fakeToken), false);
  } finally {
    await prompt.close();
  }
  assert.equal(modes.at(-1), false);
  assert.equal(referenced, false, 'closing entry must let an otherwise idle operator process exit');
});

test('terminal cleanup yields after pausing before restoring Windows input mode', async () => {
  assert.equal(typeof operator.createHiddenPrompt, 'function');
  const input = new PassThrough(),
    output = new PassThrough(),
    modes = [];
  input.isTTY = true;
  input.setRawMode = (value) => {
    modes.push(value);
    return input;
  };
  output.columns = 80;
  const prompt = operator.createHiddenPrompt({ input, output });
  const closed = prompt.close();
  assert.equal(
    modes.includes(false),
    false,
    'restoring raw mode in the input callback can stall the Windows terminal',
  );
  await closed;
  assert.equal(modes.at(-1), false);
  await prompt.close();
});

test('client environment excludes provider keys and private service configuration', () => {
  assert.equal(typeof runtime.clientEnvironment, 'function');
  const result = runtime.clientEnvironment(
    {
      Path: 'C:/Windows',
      LOCALAPPDATA: 'C:/Local',
      CLOUDFLARE_API_TOKEN: fakeToken,
      cloudflare_account_id: fakeId,
      OPENAI_API_KEY: 'fixture-other-provider',
      BOOKSHELF_SPINE_CREDENTIALS: 'fixture-private-map',
      BOOKSHELF_SPINE_PROVIDER: 'cloudflare',
      BOOKSHELF_SPINE_DATA_DIR: 'C:/private-service',
      BOOKSHELF_SPINE_SERVICE_TOKEN: 'old-token',
    },
    { url: 'http://127.0.0.1:12345', token: 'fixture-new-local-pairing-token' },
  );
  assert.deepEqual(result, {
    Path: 'C:/Windows',
    LOCALAPPDATA: 'C:/Local',
    BOOKSHELF_SPINE_SERVICE_URL: 'http://127.0.0.1:12345',
    BOOKSHELF_SPINE_SERVICE_TOKEN: 'fixture-new-local-pairing-token',
  });
});

test('one pilot start launches a real isolated client and service and closes both', async (t) => {
  assert.equal(typeof runtime.startPilot, 'function');
  const dataRoot = await directory(t);
  let calls = 0;
  const pilot = await runtime.startPilot({
    appRoot,
    dataRoot,
    clientPort: 0,
    servicePort: 0,
    provider: {
      config: CLOUDFLARE_SPINE_CONFIG,
      generate: async () => {
        calls++;
        throw new Error('no work expected');
      },
    },
  });
  t.after(() => pilot.close());
  const health = await (await fetch(pilot.origin + '/api/health')).json();
  assert.equal(health.appId, 'bookshelf-wallpaper');
  assert.notEqual(health.pid, process.pid);
  assert.equal((await (await fetch(pilot.origin + '/api/ai/status')).json()).enabled, true);
  assert.equal((await fetch(pilot.serviceOrigin + '/v1/spine-jobs')).status, 401);
  assert.equal(calls, 0);
  await pilot.close();
  await pilot.close();
  await assert.rejects(fetch(pilot.origin + '/api/health'));
  await assert.rejects(fetch(pilot.serviceOrigin + '/v1/spine-jobs'));
  assert.throws(() => process.kill(health.pid, 0));
});

test('pilot replaces only its matching previous client and preserves its collection', async (t) => {
  assert.equal(typeof runtime.startPilot, 'function');
  const dataRoot = await directory(t),
    previous = await run({ appRoot, dataDir: path.join(dataRoot, 'collection'), port: 0 });
  t.after(() => previous.close());
  const state = await (await fetch(previous.origin + '/api/state')).json();
  const pilot = await runtime.startPilot({
    appRoot,
    dataRoot,
    clientPort: Number(new URL(previous.origin).port),
    servicePort: 0,
    provider: {
      config: CLOUDFLARE_SPINE_CONFIG,
      generate: async () => {
        throw new Error('no work expected');
      },
    },
  });
  t.after(() => pilot.close());
  assert.deepEqual(await (await fetch(pilot.origin + '/api/state')).json(), state);
  assert.notEqual((await (await fetch(pilot.origin + '/api/health')).json()).pid, process.pid);
});

test('pilot refuses a foreign installation without sending a shutdown request', async (t) => {
  assert.equal(typeof runtime.startPilot, 'function');
  const dataRoot = await directory(t);
  let shutdowns = 0;
  const foreign = http.createServer((req, res) => {
    if (req.method === 'POST') shutdowns++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        appId: 'bookshelf-wallpaper',
        installationId: 'foreign-installation',
        pid: process.pid,
      }),
    );
  });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        foreign.close(resolve);
        foreign.closeAllConnections();
      }),
  );
  await assert.rejects(
    runtime.startPilot({
      appRoot,
      dataRoot,
      clientPort: foreign.address().port,
      servicePort: 0,
      provider: {
        config: CLOUDFLARE_SPINE_CONFIG,
        generate: async () => {
          throw new Error('no work expected');
        },
      },
    }),
    { code: 'PORT_IN_USE' },
  );
  assert.equal(shutdowns, 0);
});

test('cancelling startup while replacement waits closes the acquired private service', async (t) => {
  assert.equal(typeof runtime.startPilot, 'function');
  const dataRoot = await directory(t),
    controller = new AbortController();
  let seenBootstrap;
  const waiting = new Promise((resolve) => {
    seenBootstrap = resolve;
  });
  const previous = http.createServer((req, res) => {
    if (req.url === '/api/bootstrap') {
      seenBootstrap();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        appId: 'bookshelf-wallpaper',
        installationId: installationId(appRoot, path.join(dataRoot, 'collection')),
        pid: process.pid,
      }),
    );
  });
  await new Promise((resolve) => previous.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        previous.close(resolve);
        previous.closeAllConnections();
      }),
  );
  const provider = {
    config: CLOUDFLARE_SPINE_CONFIG,
    generate: async () => {
      throw new Error('no work expected');
    },
  };
  const starting = runtime.startPilot({
    appRoot,
    dataRoot,
    provider,
    clientPort: previous.address().port,
    servicePort: 0,
    signal: controller.signal,
  });
  const rejected = assert.rejects(starting, { code: 'PILOT_CANCELLED' });
  await waiting;
  controller.abort();
  await rejected;
  const reopened = await runService({
    dataDir: path.join(dataRoot, 'service'),
    port: 0,
    provider,
    credentials: new Map([['fixture-reopen-service-token', 'pilot-local']]),
  });
  await reopened.close();
});
