import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, until, pause, execute } from './helpers/windows-runtime.mjs';
import { writePayloadManifest } from '../scripts/payload-manifest.mjs';
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
test(
  'guardian restores a crashed owned server, retains collection and exits after intentional stop',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.start(),
      tray = await f.tray();
    const { token } = await (await fetch(f.origin + '/api/bootstrap')).json();
    const response = await fetch(f.origin + '/api/commands', {
      method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
      body: JSON.stringify({
        expectedRevision: 0,
        command: {
          type: 'addBook',
          draft: {
            title: 'Recovery keeps me',
            authors: ['Fixture'],
            shelfId: 'fantasy',
            status: 'read',
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const before = await response.json();
    process.kill(first.pid);
    const recovered = await until(async () => {
      const h = await f.health();
      return h.pid !== first.pid && h.installationId === first.installationId ? h : null;
    }, 35000);
    await until(async () => {
      const current = await f.tray();
      return current.serverPid === recovered.pid && current.pid === tray.pid;
    });
    assert.deepEqual(await (await fetch(f.origin + '/api/state')).json(), before);
    assert.equal((await f.shutdown()).status, 200);
    await until(() => !alive(tray.pid), 10000);
    await pause(6500);
    assert.equal(alive(recovered.pid), false);
  },
);
test(
  'shutdown arriving during recovery cancels the pending start instead of resurrecting the app',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.start(),
      tray = await f.tray();
    const main = path.join(f.root, 'src/main.mjs');
    await fs.writeFile(
      main,
      'await new Promise(r=>setTimeout(r,6000));\n' + (await fs.readFile(main, 'utf8')),
    );
    await writePayloadManifest(f.root);
    process.kill(first.pid);
    await until(async () => {
      const files = await fs.readdir(path.join(f.root, 'data'));
      return files.some((n) => n.startsWith('.runtime-recovery-'));
    }, 35000);
    await fs.writeFile(
      path.join(f.root, 'data/runtime-stop.json'),
      JSON.stringify({
        version: 1,
        appId: 'bookshelf-wallpaper',
        installationId: first.installationId,
        pid: first.pid,
        sessionId: first.sessionId,
        createdAt: new Date().toISOString(),
      }),
    );
    await until(() => !alive(tray.pid), 15000);
    await pause(8000);
    await assert.rejects(() => f.health());
    const escaped = f.root.replaceAll("'", "''");
    const script = path.join(f.root, 'check-owned.ps1');
    await fs.writeFile(
      script,
      `$target='${escaped}\\runtime\\node.exe'\n@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -ieq $target}).Count`,
    );
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-File', script]);
    assert.equal(Number(stdout.trim()), 0);
  },
);
test(
  'guardian replaces a hung server only after sustained failure of the verified process',
  { skip: process.platform !== 'win32', timeout: 160000 },
  async (t) => {
    const entry =
      `import {existsSync,unlinkSync} from 'node:fs';\nconst hang=new URL('../data/fixture-hang',import.meta.url);setInterval(()=>{if(existsSync(hang)){unlinkSync(hang);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}},100).unref();\n` +
      (await fs.readFile('src/main.mjs', 'utf8'));
    const f = await fixture(t, { entry }),
      first = await f.start(),
      tray = await f.tray();
    t.after(() => {
      if (alive(first.pid)) process.kill(first.pid);
    });
    await fs.writeFile(path.join(f.root, 'data/fixture-hang'), 'hang once');
    await pause(12000);
    assert.equal(alive(first.pid), true, 'a short outage must not kill the process');
    let recovered;
    try {
      recovered = await until(async () => {
        const h = await f.health();
        return h.pid !== first.pid && h.installationId === first.installationId ? h : null;
      }, 100000);
    } catch (error) {
      const details = await Promise.all(
        ['tray-state.json', 'runtime-events.log', 'recovery-launch-error.log'].map((name) =>
          fs.readFile(path.join(f.root, 'data', name), 'utf8').catch(() => ''),
        ),
      );
      error.message += '\n' + details.join('\n');
      throw error;
    }
    assert.equal(alive(first.pid), false);
    await until(async () => {
      const saved = await f.tray();
      return saved.pid === tray.pid && saved.serverPid === recovered.pid;
    });
  },
);
test(
  'a replacement stopped before adoption is never brought back',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t),
      first = await f.start(),
      tray = await f.tray();
    const server = path.join(f.root, 'src/server.mjs'),
      main = path.join(f.root, 'src/main.mjs');
    const source = await fs.readFile(server, 'utf8'),
      rewritten = source.replace(
        "if (route === '/api/health')\n          return json(res, 200,",
        "if (route === '/api/health')\n          return json(res, 503,",
      );
    assert.notEqual(rewritten, source);
    await fs.writeFile(server, rewritten);
    await fs.appendFile(
      main,
      `\n{const origin=${JSON.stringify(f.origin)};const {token}=await(await fetch(origin+'/api/bootstrap')).json();await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Bookshelf-Token':token},body:'{}'});}\n`,
    );
    await writePayloadManifest(f.root);
    process.kill(first.pid);
    const intent = await until(async () => {
      const saved = JSON.parse(
        await fs.readFile(path.join(f.root, 'data/runtime-stop.json'), 'utf8'),
      );
      return saved.pid !== first.pid ? saved : null;
    }, 45000);
    assert.ok(intent.recoveryNonce);
    await until(() => !alive(tray.pid) && !alive(intent.pid), 20000);
    await pause(6500);
    const ledger = JSON.parse(
      await fs.readFile(path.join(f.root, 'data/runtime-recovery.json'), 'utf8'),
    );
    assert.equal(ledger.serverAttempts.length, 1);
    await assert.rejects(() => f.health());
  },
);
