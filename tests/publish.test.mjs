import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publish } from '../scripts/publish.mjs';
import { retryRename } from '../scripts/update-transaction.mjs';
import { installationId } from '../src/installation.mjs';
import { stopRuntime } from './helpers/windows-runtime.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
async function powershell(args) {
  // A background Windows app can inherit capture pipes. Wait for the launcher itself.
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (v) => (output += v));
    child.stderr.on('data', (v) => (output += v));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Launcher timeout'));
    }, 30000);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) resolve();
      else reject(Object.assign(new Error('Launcher failed: ' + output), { code }));
    });
  });
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookshelf update '));
  const listener = net.createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const origin = 'http://127.0.0.1:' + port;
  t.after(async () => {
    try {
      const { token } = await (await fetch(origin + '/api/bootstrap')).json();
      await fetch(origin + '/api/shutdown', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
        body: '{}',
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch {}
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await fs.cp(path.join(project, 'src'), path.join(root, 'src'), { recursive: true });
  await fs.cp(path.join(project, 'public/shared'), path.join(root, 'public/shared'), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.copyFile(path.join(project, 'scripts/start.ps1'), path.join(root, 'scripts/start.ps1'));
  for (const f of [
    'package.ps1',
    'publish.mjs',
    'desktop-functions.ps1',
    'windows.ps1',
    'tray.ps1',
    'payload-manifest.mjs',
    'update-transaction.mjs',
    'runtime-functions.ps1',
    'runtime-policy.ps1',
    'lively-functions.ps1',
    'lively-repair.ps1',
  ])
    await fs.copyFile(path.join(project, 'scripts', f), path.join(root, 'scripts', f));
  await fs.copyFile(
    path.join(project, 'Start-Bookshelf.cmd'),
    path.join(root, 'Start-Bookshelf.cmd'),
  );
  for (const f of ['README.md', 'THIRD-PARTY-NOTICES.md'])
    await fs.writeFile(path.join(root, f), 'fixture');
  for (const f of ['manager.html', 'wallpaper.html'])
    await fs.writeFile(path.join(root, 'public', f), '<p>fixture</p>');
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.4.2' }),
  );
  const runtimePath = path.join(root, 'test-runtime');
  await fs.mkdir(runtimePath);
  await fs.copyFile(process.execPath, path.join(runtimePath, 'node.exe'));
  await fs.writeFile(path.join(runtimePath, 'LICENSE'), 'test fixture');
  return { root, port, origin, runtimePath, target: path.join(root, 'Biblioteczka') };
}
async function command(origin, command) {
  const state = await (await fetch(origin + '/api/state')).json();
  const { token } = await (await fetch(origin + '/api/bootstrap')).json();
  const response = await fetch(origin + '/api/commands', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
    body: JSON.stringify({ expectedRevision: state.revision, command }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
test('updates the same directory, retains collection and all local assets, and removes old releases only after startup', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await command(f.origin, {
    type: 'addBook',
    draft: {
      title: 'Test',
      authors: ['Autor'],
      shelfId: (await (await fetch(f.origin + '/api/state')).json()).shelves[0].id,
      status: 'read',
      readDate: '2026-10-03',
    },
  });
  const ledger = {
    version: 1,
    days: { '2026-10-04': { attempts: 8, unknownCharges: 1, estimatedUsd: 0.15 } },
    pending: [],
  };
  const assets = {
    'covers/example.png': Buffer.from([1, 2, 3, 4]),
    'spines/example.webp': Buffer.from([5, 6, 7]),
    'ai-usage.json': Buffer.from(JSON.stringify(ledger)),
    'library.backup.json': await fs.readFile(path.join(f.target, 'data/library.backup.json')),
  };
  for (const [name, bytes] of Object.entries(assets)) {
    await fs.mkdir(path.dirname(path.join(f.target, 'data', name)), { recursive: true });
    await fs.writeFile(path.join(f.target, 'data', name), bytes);
  }
  const dist = path.join(f.root, 'dist');
  await fs.mkdir(path.join(dist, 'Biblioteczka-0.4.1-win-x64-20261004-100000'), {
    recursive: true,
  });
  await fs.writeFile(path.join(dist, 'Biblioteczka-0.4.1-win-x64-20261004-100000.zip'), 'old');
  const foreign = path.join(dist, 'Biblioteczka-0.3.0-win-x64-20261001-100000', 'data');
  await fs.mkdir(foreign, { recursive: true });
  await fs.writeFile(path.join(foreign, 'library.json'), 'a separate collection');
  await fs.writeFile(
    path.join(f.root, 'package.json'),
    JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.4.3' }),
  );
  const realFetch = globalThis.fetch;
  let lostShutdown = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await realFetch(url, options);
    if (url === f.origin + '/api/shutdown' && options?.method === 'POST' && !lostShutdown) {
      assert.equal(response.status, 200);
      lostShutdown = true;
      throw new TypeError('fixture lost the acknowledged stop response');
    }
    return response;
  });
  const result = await publish({
    sourceRoot: f.root,
    runtimePath: path.join(f.target, 'runtime'),
    port: f.port,
  });
  assert.equal(lostShutdown, true);
  assert.equal(result.target, f.target);
  assert.equal(result.version, '0.4.3');
  const running = await (await fetch(f.origin + '/api/health')).json(),
    tray = JSON.parse(await fs.readFile(path.join(f.target, 'data/tray-state.json'), 'utf8'));
  assert.equal(tray.serverPid, running.pid);
  assert.equal(tray.sessionId, running.sessionId);
  assert.doesNotThrow(() => process.kill(tray.pid, 0));
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.3');
  for (const [name, bytes] of Object.entries(assets))
    if (name !== 'ai-usage.json')
      assert.deepEqual(await fs.readFile(path.join(f.target, 'data', name)), bytes, name);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(f.target, 'data/ai-usage.json'), 'utf8')),
    ledger,
  );
  assert.deepEqual(await fs.readdir(dist), ['Biblioteczka-0.3.0-win-x64-20261001-100000']);
  assert.equal(result.protected.length, 1);
});
test('a failed new startup restores the previous application and collection and keeps old release archives', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await command(f.origin, { type: 'updateSettings', patch: { theme: 'dark' } });
  await fs.mkdir(path.join(f.root, 'dist'));
  await fs.writeFile(
    path.join(f.root, 'dist/Biblioteczka-0.4.1-win-x64-20261004-100000.zip'),
    'keep on failure',
  );
  await fs.writeFile(path.join(f.root, 'src/main.mjs'), 'process.exitCode=7;');
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /przywrócono/,
  );
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.2');
  assert.equal(
    await fs.readFile(
      path.join(f.root, 'dist/Biblioteczka-0.4.1-win-x64-20261004-100000.zip'),
      'utf8',
    ),
    'keep on failure',
  );
});
test('an updater refuses to stop a different installation using the same port', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const health = await (await fetch(f.origin + '/api/health')).json();
  const otherWorkspace = path.join(f.root, 'other workspace');
  const other = path.join(otherWorkspace, 'old app');
  await fs.mkdir(path.join(other, 'data'), { recursive: true });
  await fs.copyFile(
    path.join(f.target, 'data/library.json'),
    path.join(other, 'data/library.json'),
  );
  await assert.rejects(
    () =>
      publish({
        sourceRoot: otherWorkspace,
        runtimePath: f.runtimePath,
        previousRoot: other,
        port: f.port,
      }),
    /inna instalacja/,
  );
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, health.pid);
});
test(
  'the Windows launcher opens the permanent installation and repeated launches keep the same process',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t);
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    const before = await (await fetch(f.origin + '/api/health')).json();
    const launch = () =>
      powershell([
        '-File',
        path.join(f.root, 'scripts/start.ps1'),
        '-Port',
        String(f.port),
        '-NoBrowser',
        '-NoTray',
      ]);
    await launch();
    await launch();
    assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, before.pid);
    await assert.rejects(
      () => fs.access(path.join(f.root, 'data/library.json')),
      (e) => e.code === 'ENOENT',
    );
    await assert.rejects(
      () =>
        powershell([
          '-File',
          path.join(f.root, 'scripts/start.ps1'),
          '-AppRoot',
          f.root,
          '-Port',
          String(f.port),
          '-NoBrowser',
          '-NoTray',
        ]),
      (e) => e.code === 1,
    );
    assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, before.pid);
    const { token } = await (await fetch(f.origin + '/api/bootstrap')).json();
    await fetch(f.origin + '/api/shutdown', {
      method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
      body: '{}',
    });
    await new Promise((r) => setTimeout(r, 500));
    await launch();
    const restarted = await (await fetch(f.origin + '/api/health')).json();
    assert.notEqual(restarted.pid, before.pid);
    assert.equal(restarted.installationId, before.installationId);
  },
);
test(
  'the release PowerShell command updates in place using the bundled runtime without producing another archive',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t);
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    const state = await command(f.origin, { type: 'updateSettings', patch: { theme: 'dark' } });
    await fs.writeFile(
      path.join(f.root, 'package.json'),
      JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.4.3' }),
    );
    await powershell(['-File', path.join(f.root, 'scripts/package.ps1'), '-Port', String(f.port)]);
    assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.3');
    assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
    assert.ok(!(await fs.readdir(f.root)).some((name) => name.startsWith('.bookshelf-')));
    assert.ok(!(await fs.stat(path.join(f.root, 'dist')).catch(() => null)));
  },
);

test('OneDrive entries with unknown directory types are fully checked when copying an existing collection', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await command(f.origin, {
    type: 'addBook',
    draft: { title: 'OneDrive', authors: ['Autor'], shelfId: 'other', status: 'read' },
  });
  const data = path.join(f.target, 'data'),
    asset = path.join(data, 'covers/cloud-file.png');
  await fs.mkdir(path.dirname(asset), { recursive: true });
  await fs.writeFile(asset, Buffer.from([8, 9, 10]));
  const originalRead = fs.readdir.bind(fs);
  t.mock.method(fs, 'readdir', async (dir, options) => {
    const entries = await originalRead(dir, options);
    if (
      (options?.withFileTypes && path.resolve(dir).startsWith(data + path.sep)) ||
      (options?.withFileTypes && path.resolve(dir) === data)
    )
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: () => false,
        isFile: () => false,
      }));
    return entries;
  });
  await fs.writeFile(
    path.join(f.root, 'package.json'),
    JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.5.0' }),
  );
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  assert.deepEqual(await fs.readFile(asset), Buffer.from([8, 9, 10]));
});
test(
  'published tray launcher can be opened twice without replacing its running helper log',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t);
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    for (const file of ['desktop-functions.ps1', 'windows.ps1', 'tray.ps1'])
      await fs.access(path.join(f.target, 'scripts', file));
    const launch = () =>
      powershell([
        '-File',
        path.join(f.target, 'scripts/start.ps1'),
        '-Port',
        String(f.port),
        '-NoBrowser',
      ]);
    await launch();
    await launch();
    const log = await fs.readFile(path.join(f.target, 'data/tray.log'), 'utf8');
    assert.match(log, /"ready":true/);
    assert.doesNotMatch(log, /duplicate/);
    const { token } = await (await fetch(f.origin + '/api/bootstrap')).json();
    await fetch(f.origin + '/api/shutdown', {
      method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
      body: '{}',
    });
    await new Promise((r) => setTimeout(r, 2500));
  },
);
test('external installer target preserves collection and rolls back a failed update', async (t) => {
  const f = await fixture(t),
    target = path.join(f.root, 'Chosen folder & books', "Reader's home", 'Biblioteczka');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const result = await publish({
    sourceRoot: f.root,
    targetRoot: target,
    runtimePath: f.runtimePath,
    port: f.port,
  });
  assert.equal(result.target, target);
  const state = await command(f.origin, {
    type: 'addBook',
    draft: {
      title: 'Preserved',
      authors: ['Reader'],
      shelfId: 'other',
      status: 'read',
      readDate: '2026-10-05',
    },
  });
  const asset = path.join(target, 'data/covers/keep.png');
  await fs.mkdir(path.dirname(asset), { recursive: true });
  await fs.writeFile(asset, Buffer.from([3, 4, 5]));
  await fs.writeFile(
    path.join(f.root, 'package.json'),
    JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.7.0' }),
  );
  await publish({
    sourceRoot: f.root,
    targetRoot: target,
    runtimePath: f.runtimePath,
    port: f.port,
  });
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  assert.deepEqual(await fs.readFile(asset), Buffer.from([3, 4, 5]));
  await fs.writeFile(path.join(f.root, 'src/main.mjs'), 'process.exitCode=9;');
  await assert.rejects(
    () =>
      publish({ sourceRoot: f.root, targetRoot: target, runtimePath: f.runtimePath, port: f.port }),
    /przywrócono/,
  );
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.7.0');
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
});
test('installer refuses a foreign or nonempty target and a different folder name', async (t) => {
  const f = await fixture(t);
  const parent = path.join(f.root, 'external');
  await fs.mkdir(parent);
  const target = path.join(parent, 'Biblioteczka');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'private.txt'), 'keep');
  await assert.rejects(
    () =>
      publish({ sourceRoot: f.root, targetRoot: target, runtimePath: f.runtimePath, port: f.port }),
    /obcy|pusty|Biblioteczka/i,
  );
  assert.equal(await fs.readFile(path.join(target, 'private.txt'), 'utf8'), 'keep');
  await assert.rejects(
    () =>
      publish({
        sourceRoot: f.root,
        targetRoot: path.join(parent, 'different'),
        runtimePath: f.runtimePath,
        port: f.port,
      }),
    /Biblioteczka/,
  );
});

test('an initialized installation with missing data is never replaced by an empty collection', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.target);
  await fs.copyFile(path.join(f.root, 'package.json'), path.join(f.target, 'package.json'));
  const marker = path.join(f.target, 'data-initialized.json'),
    original = Buffer.from('{"version":1,"initialized":true}\n');
  await fs.writeFile(marker, original);
  await fs.writeFile(
    path.join(f.root, 'package.json'),
    JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.7.1' }),
  );
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /Brakuje poprawnej kolekcji/,
  );
  assert.deepEqual(await fs.readFile(marker), original);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(f.target, 'package.json'), 'utf8')).version,
    '0.4.2',
  );
  await assert.rejects(
    () => fs.access(path.join(f.target, 'data/library.json')),
    (e) => e.code === 'ENOENT',
  );
  assert.ok(!(await fs.readdir(f.root)).some((name) => name.startsWith('.bookshelf-')));
});

test(
  'installer refuses a junction target without changing the linked directory',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t),
      outside = path.join(f.root, 'personal files'),
      parent = path.join(f.root, 'junction parent');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'preserved');
    await fs.mkdir(parent);
    const target = path.join(parent, 'Biblioteczka');
    await fs.symlink(outside, target, 'junction');
    await assert.rejects(
      () =>
        publish({
          sourceRoot: f.root,
          targetRoot: target,
          runtimePath: f.runtimePath,
          port: f.port,
        }),
      /Dowiązanie/,
    );
    assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'preserved');
    assert.deepEqual(await fs.readdir(outside), ['private.txt']);
    await fs.unlink(target);
  },
);

test(
  'updating with a real active tray waits for its exit and starts a replacement',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t);
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    const launch = () =>
      powershell([
        '-File',
        path.join(f.target, 'scripts/start.ps1'),
        '-Port',
        String(f.port),
        '-NoBrowser',
      ]);
    await launch();
    const state = await (await fetch(f.origin + '/api/state')).json();
    await fs.writeFile(
      path.join(f.root, 'package.json'),
      JSON.stringify({ name: 'bookshelf-wallpaper', type: 'module', version: '0.7.1' }),
    );
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    await launch();
    assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.7.1');
    assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
    const tray = JSON.parse(await fs.readFile(path.join(f.target, 'data/tray-state.json'), 'utf8'));
    assert.equal(tray.serverPid, (await (await fetch(f.origin + '/api/health')).json()).pid);
    assert.doesNotThrow(() => process.kill(tray.pid, 0));
  },
);

test('a tray that does not exit aborts the update and restarts the previous server', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await (await fetch(f.origin + '/api/state')).json();
  const stalled = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const exited = new Promise((r) => stalled.once('exit', r));
  t.after(async () => {
    stalled.kill();
    await exited;
  });
  await fs.writeFile(
    path.join(f.target, 'data/tray-state.json'),
    JSON.stringify({
      pid: stalled.pid,
      serverPid: (await (await fetch(f.origin + '/api/health')).json()).pid,
      installationId: installationId(f.target),
    }),
  );
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /ikona zasobnika nadal pracuje/,
  );
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.2');
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
});

test('recovers a dead updater owner and interrupted target move before the next update', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await command(f.origin, { type: 'updateSettings', patch: { theme: 'dark' } });
  await stopRuntime(f.origin, f.target);
  const id = '11111111-1111-4111-8111-111111111111',
    backup = path.join(f.root, '.bookshelf-previous-' + id),
    stage = path.join(f.root, '.bookshelf-stage-' + id);
  await retryRename(f.target, backup);
  await fs.mkdir(stage);
  await fs.writeFile(path.join(stage, 'data-to-preserve'), 'interrupted stage');
  await fs.writeFile(
    path.join(f.root, '.bookshelf-update.lock'),
    JSON.stringify({ version: 1, pid: 2147483647, hostname: os.hostname(), id }),
  );
  await fs.writeFile(
    path.join(f.root, '.bookshelf-update.json'),
    JSON.stringify({
      version: 1,
      id,
      target: f.target,
      previousRoot: f.target,
      stage,
      backup,
      port: f.port,
      phase: 'moving',
      hadTarget: true,
    }),
  );
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  assert.equal(
    await fs.readFile(path.join(stage, 'data-to-preserve'), 'utf8'),
    'interrupted stage',
  );
});

test('never steals a live updater lock', async (t) => {
  const f = await fixture(t),
    lock = path.join(f.root, '.bookshelf-update.lock'),
    owner = { version: 1, pid: process.pid, id: 'live-owner' };
  await fs.writeFile(lock, JSON.stringify(owner));
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /aktualizacja.*trwa/i,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(lock, 'utf8')), owner);
});

test('interrupted activation leaves both folders alone while the candidate guardian is recovering', async (t) => {
  const f = await fixture(t),
    id = '22222222-2222-4222-8222-222222222222',
    backup = path.join(f.root, '.bookshelf-previous-' + id),
    stage = path.join(f.root, '.bookshelf-stage-' + id);
  await fs.mkdir(path.join(f.target, 'data'), { recursive: true });
  await fs.mkdir(backup);
  await fs.writeFile(path.join(f.target, 'package.json'), '{"name":"bookshelf-wallpaper"}');
  await fs.writeFile(
    path.join(f.target, 'data/tray-state.json'),
    JSON.stringify({ pid: process.pid, installationId: installationId(f.target) }),
  );
  const transaction = JSON.stringify({
    version: 1,
    id,
    target: f.target,
    previousRoot: f.target,
    stage,
    backup,
    port: f.port,
    phase: 'activated',
    hadTarget: true,
    installationId: installationId(f.target),
  });
  await fs.writeFile(path.join(f.root, '.bookshelf-update.json'), transaction);
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /odzyskuje połączenie/,
  );
  await fs.access(f.target);
  await fs.access(backup);
  await assert.rejects(() => fs.access(stage), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.root, '.bookshelf-update.json'), 'utf8'), transaction);
});

test('retries transient activation and rollback renames', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const rename = fs.rename.bind(fs);
  let activation = 0,
    rollback = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (
      to === f.target &&
      path.basename(from).startsWith('.bookshelf-stage-') &&
      activation++ === 0
    )
      throw Object.assign(new Error('sharing activation'), { code: 'EPERM' });
    if (
      to === f.target &&
      path.basename(from).startsWith('.bookshelf-previous-') &&
      rollback++ === 0
    )
      throw Object.assign(new Error('sharing rollback'), { code: 'EPERM' });
    return rename(from, to);
  });
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.equal(activation, 2);
  await fs.writeFile(path.join(f.root, 'src/main.mjs'), 'process.exitCode=9;');
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /przywrócono/,
  );
  assert.equal(rollback, 2);
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.2');
});

test('committed cleanup failure returns installed with warning and keeps previous files', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const remove = fs.rm.bind(fs);
  const cleanupMock = t.mock.method(fs, 'rm', async (file, options) => {
    if (path.basename(file).startsWith('.bookshelf-previous-'))
      throw Object.assign(new Error('cleanup locked'), { code: 'EPERM' });
    return remove(file, options);
  });
  const result = await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.equal(result.installed, true);
  assert.match(result.cleanupWarning, /cleanup locked/);
  assert.ok(result.preserved.length);
  const beforePid = (await (await fetch(f.origin + '/api/health')).json()).pid;
  cleanupMock.mock.restore();
  const { retryUpdateCleanup } = await import('../scripts/publish.mjs');
  assert.equal(typeof retryUpdateCleanup, 'function');
  const retried = await retryUpdateCleanup({ targetRoot: f.target });
  assert.equal(retried.cleaned, true);
  await assert.rejects(
    () => fs.access(result.preserved[0]),
    (e) => e.code === 'ENOENT',
  );
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, beforePid);
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).version, '0.4.2');
});

test('rejects a shipped payload with a missing frontend module before stopping the old server', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const before = await (await fetch(f.origin + '/api/health')).json();
  await fs.writeFile(
    path.join(f.root, 'payload-manifest.json'),
    JSON.stringify({ version: 1, files: { 'public/manager/missing.mjs': 'a'.repeat(64) } }),
  );
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /payload|pakiet|zasob/i,
  );
  assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, before.pid);
});

test('failed rollback retains the journal and staged data until a later update reconciles it', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const state = await command(f.origin, { type: 'updateSettings', patch: { theme: 'dark' } });
  await fs.writeFile(path.join(f.root, 'src/main.mjs'), 'process.exitCode=9;');
  const rename = fs.rename.bind(fs);
  const mocked = t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.target && path.basename(from).startsWith('.bookshelf-previous-'))
      throw Object.assign(new Error('rollback remains locked'), { code: 'EBUSY' });
    return rename(from, to);
  });
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /Dane zachowano/,
  );
  const journal = JSON.parse(
    await fs.readFile(path.join(f.root, '.bookshelf-update.json'), 'utf8'),
  );
  assert.equal(journal.phase, 'activated');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(journal.backup, 'data/library.json'), 'utf8')),
    state,
  );
  await fs.access(path.join(journal.stage, 'data/library.json'));
  mocked.mock.restore();
  await fs.copyFile(path.join(project, 'src/main.mjs'), path.join(f.root, 'src/main.mjs'));
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), state);
  await fs.access(path.join(journal.stage, 'data/library.json'));
});

test(
  'launcher rejects a corrupted installed frontend even while its server responds',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t);
    await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
    const before = await (await fetch(f.origin + '/api/health')).json();
    await fs.writeFile(path.join(f.target, 'public/manager.html'), '<p>corrupt</p>');
    await assert.rejects(
      () =>
        powershell([
          '-File',
          path.join(f.target, 'scripts/start.ps1'),
          '-Port',
          String(f.port),
          '-NoBrowser',
          '-NoTray',
        ]),
      /Uszkodzony pakiet/,
    );
    assert.equal((await (await fetch(f.origin + '/api/health')).json()).pid, before.pid);
  },
);

test('a legacy empty updater lock reports a safe manual recovery route and preserves folders', async (t) => {
  const f = await fixture(t),
    lock = path.join(f.root, '.bookshelf-update.lock'),
    stage = path.join(f.root, '.bookshelf-stage-legacy');
  await fs.writeFile(lock, '');
  await fs.mkdir(stage);
  await fs.writeFile(path.join(stage, 'keep'), 'preserved');
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    (error) =>
      error.message.includes(lock) &&
      error.message.includes(stage) &&
      /Zamknij wszystkie instalatory/.test(error.message) &&
      /legacy/.test(error.message),
  );
  assert.equal(await fs.readFile(lock, 'utf8'), '');
  assert.equal(await fs.readFile(path.join(stage, 'keep'), 'utf8'), 'preserved');
});

test('temporary data ownership metadata is excluded from the staged collection', async (t) => {
  const f = await fixture(t);
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  const stageName = '.bookshelf-data-lock-stage-synthetic';
  await fs.mkdir(path.join(f.target, 'data', stageName));
  await fs.writeFile(path.join(f.target, 'data', stageName, 'owner.json'), 'temporary ownership');
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  await assert.rejects(
    () => fs.access(path.join(f.target, 'data', stageName)),
    (error) => error.code === 'ENOENT',
  );
  assert.ok((await (await fetch(f.origin + '/api/health')).json()).pid);
});

test('interruption while recording the updater owner cannot leave an ambiguous lock', async (t) => {
  const f = await fixture(t),
    open = fs.open.bind(fs);
  let interrupted = false;
  const mock = t.mock.method(fs, 'open', async (file, flags, ...rest) => {
    const handle = await open(file, flags, ...rest);
    if (flags === 'wx' && path.basename(file).startsWith('.bookshelf-update') && !interrupted) {
      interrupted = true;
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => {
        await write('{unfinished');
        throw new Error('interrupted owner write');
      };
    }
    return handle;
  });
  await assert.rejects(
    () => publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port }),
    /interrupted owner write/,
  );
  mock.mock.restore();
  await assert.rejects(
    () => fs.access(path.join(f.root, '.bookshelf-update.lock')),
    (error) => error.code === 'ENOENT',
  );
  await publish({ sourceRoot: f.root, runtimePath: f.runtimePath, port: f.port });
  assert.ok((await (await fetch(f.origin + '/api/health')).json()).pid);
});
