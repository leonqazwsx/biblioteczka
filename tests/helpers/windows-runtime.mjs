import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { writePayloadManifest } from '../../scripts/payload-manifest.mjs';
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export function execute(file, args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (x) => (stdout += x));
    child.stderr.on('data', (x) => (stderr += x));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Runtime fixture timeout: ' + stdout + stderr));
    }, timeout);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error('Runtime fixture failed: ' + stdout + stderr));
    });
  });
}
export async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error('Runtime fixture condition timed out' + (last ? ': ' + last.message : ''));
}
export async function stopRuntime(origin, target) {
  const tray = JSON.parse(await fs.readFile(path.join(target, 'data/tray-state.json'), 'utf8'));
  const { token } = await (
    await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(3000) })
  ).json();
  const response = await fetch(origin + '/api/shutdown', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
    body: JSON.stringify({ expectedPid: tray.serverPid }),
    signal: AbortSignal.timeout(3000),
  });
  if (response.status !== 200) throw new Error('Fixture rejected shutdown: ' + response.status);
  await until(
    () =>
      [tray.pid, tray.serverPid].every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (e) {
          if (e.code === 'ESRCH') return true;
          throw e;
        }
      }),
    15000,
  );
}
export async function fixture(t, { entry } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Bookshelf standalone & reader's "));
  const listener = net.createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const origin = 'http://127.0.0.1:' + port;
  for (const name of ['src', 'scripts', 'public/shared'])
    await fs.cp(name, path.join(root, name), { recursive: true });
  for (const name of ['package.json', 'README.md', 'THIRD-PARTY-NOTICES.md', 'Start-Bookshelf.cmd'])
    await fs.copyFile(name, path.join(root, name));
  await fs.mkdir(path.join(root, 'runtime'));
  await fs.copyFile(process.execPath, path.join(root, 'runtime/node.exe'));
  await fs.writeFile(path.join(root, 'runtime/LICENSE'), 'fixture');
  for (const name of ['manager.html', 'wallpaper.html'])
    await fs.writeFile(path.join(root, 'public', name), 'fixture');
  if (entry) await fs.writeFile(path.join(root, 'src/main.mjs'), entry);
  await writePayloadManifest(root);
  t.after(async () => {
    try {
      const { token } = await (
        await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) })
      ).json();
      await fetch(origin + '/api/shutdown', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
        body: '{}',
        signal: AbortSignal.timeout(1000),
      });
    } catch {}
    for (let n = 0; n < 80; n++) {
      if (
        !(await fs.access(path.join(root, 'data/tray-state.json')).then(
          () => true,
          () => false,
        ))
      )
        break;
      await pause(100);
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  });
  return {
    root,
    port,
    origin,
    async start() {
      const { stdout } = await execute('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts/start.ps1'),
        '-AppRoot',
        root,
        '-Port',
        String(port),
        '-NoBrowser',
        '-ResultJson',
      ]);
      const line = stdout.split(/\r?\n/).find((s) => s.startsWith('BOOKSHELF_STARTED:'));
      if (!line) throw new Error('No readiness result: ' + stdout);
      return JSON.parse(line.slice('BOOKSHELF_STARTED:'.length));
    },
    async health() {
      return (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(600) })).json();
    },
    async tray() {
      return JSON.parse(await fs.readFile(path.join(root, 'data/tray-state.json'), 'utf8'));
    },
    async shutdown() {
      const { token } = await (
        await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) })
      ).json();
      return fetch(origin + '/api/shutdown', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bookshelf-Token': token },
        body: '{}',
        signal: AbortSignal.timeout(1000),
      });
    },
  };
}
