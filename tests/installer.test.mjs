import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/store.mjs';
import { openCoverStore } from '../src/covers.mjs';
import { openSpineStore } from '../src/spine-assets.mjs';
import { png } from './helpers/images.mjs';
import { stopRuntime } from './helpers/windows-runtime.mjs';
async function execute(file, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      output += '\nInstaller did not exit after 90 seconds';
      c.kill();
    }, 90000);
    c.stdout.on('data', (v) => (output += v));
    c.stderr.on('data', (v) => (output += v));
    c.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.once('exit', (code) => {
      clearTimeout(timer);
      c.stdout.destroy();
      c.stderr.destroy();
      resolve({ code, output });
    });
  });
}
test(
  'single EXE installs and updates without extracting manually or shipping a collection',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka setup ')),
      payload = path.join(root, 'payload'),
      target = path.join(root, "Reader's library & home", 'Biblioteczka');
    await fs.mkdir(path.join(payload, 'public'), { recursive: true });
    await fs.cp('src', path.join(payload, 'src'), { recursive: true });
    await fs.cp('public/shared', path.join(payload, 'public/shared'), { recursive: true });
    await fs.cp('scripts', path.join(payload, 'scripts'), { recursive: true });
    for (const file of ['manager.html', 'wallpaper.html'])
      await fs.writeFile(path.join(payload, 'public', file), 'fixture');
    for (const file of ['Start-Bookshelf.cmd', 'README.md', 'THIRD-PARTY-NOTICES.md'])
      await fs.copyFile(file, path.join(payload, file));
    await fs.writeFile(
      path.join(payload, 'package.json'),
      JSON.stringify({ name: 'bookshelf-wallpaper', version: '0.7.0', type: 'module' }),
    );
    await fs.mkdir(path.join(payload, 'runtime'));
    await fs.copyFile(process.execPath, path.join(payload, 'runtime/node.exe'));
    await fs.writeFile(path.join(payload, 'runtime/LICENSE'), 'test');
    await fs.mkdir(path.join(payload, 'data'));
    await fs.writeFile(path.join(payload, 'data/library.json'), 'private collection excluded');
    await fs.writeFile(path.join(payload, '.env'), 'PRIVATE_KEY=must-not-ship');
    await fs.mkdir(path.join(payload, 'services/spine-service'), { recursive: true });
    await fs.writeFile(
      path.join(payload, 'services/spine-service/private-token.txt'),
      'fixture-provider-secret',
    );
    await fs.mkdir(path.join(payload, 'node_modules/sharp'), { recursive: true });
    await fs.writeFile(
      path.join(payload, 'node_modules/sharp/private-native.txt'),
      'fixture-native-dependency',
    );
    const listener = net.createServer();
    await new Promise((r) => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const origin = 'http://127.0.0.1:' + port;
    t.after(async () => {
      try {
        await stopRuntime(origin, target);
      } catch {}
      await fs.rm(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 150 });
    });
    const exe = path.join(root, 'Biblioteczka-Setup.exe');
    const build = await execute('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('scripts/build-setup.ps1'),
      '-PayloadPath',
      payload,
      '-OutputPath',
      exe,
    ]);
    assert.equal(build.code, 0, build.output);
    const resource = await execute('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('tests/setup-entries.ps1'),
      '-ExePath',
      exe,
    ]);
    assert.equal(resource.code, 0, resource.output);
    const names = JSON.parse(resource.output.replace(/^\uFEFF/, '')).map((name) =>
      name.replaceAll('\\', '/'),
    );
    assert.ok(names.includes('runtime/node.exe'));
    assert.ok(names.includes('scripts/install.ps1'));
    assert.ok(names.includes('payload-manifest.json'));
    assert.ok(names.includes('scripts/payload-manifest.mjs'));
    assert.ok(names.includes('scripts/update-transaction.mjs'));
    assert.ok(
      !names.some(
        (n) =>
          n.startsWith('data/') ||
          n.includes('.env') ||
          n.startsWith('services/') ||
          n.startsWith('node_modules/'),
      ),
    );
    const args = ['/quiet', '/target:' + target, '/port:' + port];
    const installed = await execute(exe, args);
    assert.equal(installed.code, 0, installed.output);
    const health = await (await fetch(origin + '/api/health')).json();
    assert.equal(health.version, '0.7.0');
    const { verifyPayloadManifest } = await import('../scripts/payload-manifest.mjs');
    assert.ok((await verifyPayloadManifest(target)).files > 10);
    for (const file of ['publish.mjs', 'install.mjs', 'install.ps1'])
      await fs.access(path.join(target, 'scripts', file));
    const { token } = await (await fetch(origin + '/api/bootstrap')).json();
    let state = await (
      await fetch(origin + '/api/commands', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
        body: JSON.stringify({
          expectedRevision: 0,
          command: {
            type: 'addBook',
            draft: {
              title: 'Installer keeps me',
              authors: ['Reader'],
              shelfId: 'other',
              status: 'read',
            },
          },
        }),
      })
    ).json();
    await stopRuntime(origin, target);
    const dataDir = path.join(target, 'data'),
      store = await openStore(dataDir),
      covers = await openCoverStore(dataDir),
      spines = await openSpineStore(dataDir),
      { coverId } = await covers.put(png, 'image/png');
    const pendingId = store.read().books[0].id;
    await store.commit(
      { type: 'updateBook', id: pendingId, patch: { coverId } },
      store.read().revision,
    );
    const beforeClaim = store.read(),
      claimed = await store.claimAutomaticSpine({
        collectionId: beforeClaim.collectionId,
        bookId: pendingId,
        coverId,
        expectedGeneration: beforeClaim.books[0].spineGeneration,
      });
    assert.ok(claimed);
    // A legacy automatic-spine journal left by older versions must survive updates byte for byte.
    const entry = {
      collectionId: beforeClaim.collectionId,
      bookId: pendingId,
      coverId,
      expectedGeneration: beforeClaim.books[0].spineGeneration,
      ticket: claimed.ticket,
      requestId: randomUUID(),
      remoteJobId: randomUUID(),
      origin: 'http://127.0.0.1:47842',
      phase: 'submitted',
      state: 'queued',
      retryAt: '2050-01-01T00:01:00.000Z',
      errorCode: 'PROVIDER_QUOTA',
    };
    await fs.writeFile(
      path.join(dataDir, 'automatic-spines.json'),
      JSON.stringify({ version: 1, entries: [entry] }),
    );
    await store.commit(
      {
        type: 'addBook',
        draft: { title: 'Manual crop', authors: ['Reader'], shelfId: 'other', status: 'read' },
      },
      store.read().revision,
    );
    const manualId = store.read().books[1].id,
      { assetId } = await spines.put(png, 'image/png');
    await store.commit(
      {
        type: 'setBookSpine',
        id: manualId,
        spine: { kind: 'manual', assetId, frame: { x: 35, y: 60, zoom: 1.5 } },
      },
      store.read().revision,
    );
    state = store.read();
    const pendingBytes = await fs.readFile(path.join(dataDir, 'automatic-spines.json'));
    const update = await execute(exe, args);
    assert.equal(update.code, 0, update.output);
    assert.deepEqual(await (await fetch(origin + '/api/state')).json(), state);
    assert.notEqual((await (await fetch(origin + '/api/health')).json()).pid, health.pid);
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'automatic-spines.json')), pendingBytes);
    const retained = JSON.parse(pendingBytes).entries[0];
    assert.deepEqual(retained.ticket, claimed.ticket);
    assert.equal(retained.remoteJobId, entry.remoteJobId);
    assert.equal(retained.errorCode, 'PROVIDER_QUOTA');
    assert.deepEqual((await (await fetch(origin + '/api/state')).json()).books[1].spine.frame, {
      x: 35,
      y: 60,
      zoom: 1.5,
    });
    const invalid = await execute(exe, [
      '/quiet',
      '/target:' + path.join(root, 'wrong'),
      '/port:' + port,
    ]);
    assert.notEqual(invalid.code, 0);
    assert.deepEqual(await (await fetch(origin + '/api/state')).json(), state);
  },
);

test(
  'PowerShell install establishes the tray after an installed cleanup warning',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka install outcome ')),
      source = path.join(root, 'source'),
      target = path.join(root, 'Biblioteczka');
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    await fs.mkdir(path.join(source, 'runtime'), { recursive: true });
    await fs.mkdir(path.join(source, 'scripts'));
    await fs.mkdir(path.join(target, 'scripts'), { recursive: true });
    await fs.copyFile(process.execPath, path.join(source, 'runtime/node.exe'));
    await fs.copyFile('scripts/install.ps1', path.join(source, 'scripts/install.ps1'));
    await fs.writeFile(
      path.join(source, 'scripts/install.mjs'),
      `console.log(JSON.stringify({installed:true,cleanupWarning:'previous folder locked',preserved:['fixture previous']}));`,
    );
    await fs.writeFile(
      path.join(target, 'scripts/start.ps1'),
      `param($AppRoot,$Port,[switch]$NoBrowser,[switch]$NoTray)\n[IO.File]::WriteAllText((Join-Path $AppRoot 'tray-established'),'ready')`,
    );
    const result = await execute('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(source, 'scripts/install.ps1'),
      '-Source',
      source,
      '-Target',
      target,
      '-Port',
      '1',
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /BOOKSHELF_CLEANUP_WARNING: previous folder locked/);
    assert.equal(await fs.readFile(path.join(target, 'tray-established'), 'utf8'), 'ready');
  },
);

test(
  'installer reports a committed installation with a launcher warning separately from activation failure',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka launcher outcome ')),
      source = path.join(root, 'source'),
      target = path.join(root, 'Biblioteczka');
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    await fs.mkdir(path.join(source, 'runtime'), { recursive: true });
    await fs.mkdir(path.join(source, 'scripts'));
    await fs.mkdir(path.join(target, 'scripts'), { recursive: true });
    await fs.copyFile(process.execPath, path.join(source, 'runtime/node.exe'));
    await fs.copyFile('scripts/install.ps1', path.join(source, 'scripts/install.ps1'));
    await fs.writeFile(
      path.join(source, 'scripts/install.mjs'),
      `console.log(JSON.stringify({installed:true,target:${JSON.stringify(target)}}));`,
    );
    await fs.writeFile(path.join(target, 'scripts/start.ps1'), 'exit 1');
    const result = await execute('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(source, 'scripts/install.ps1'),
      '-Source',
      source,
      '-Target',
      target,
      '-Port',
      '1',
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /BOOKSHELF_START_WARNING/);
    assert.match(
      await fs.readFile(path.join(source, 'install-warning.txt'), 'utf8'),
      /zainstalowana/,
    );
  },
);
