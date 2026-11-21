import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { run } from '../src/main.mjs';
const root = process.cwd();
function child(args) {
  const process = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'scripts/tray.ps1'),
      ...args,
    ],
    { windowsHide: true },
  );
  let output = '',
    errors = '';
  process.stdout.on('data', (v) => (output += v));
  process.stderr.on('data', (v) => (errors += v));
  const exit = new Promise((resolve) =>
    process.on('exit', (code) => resolve({ code, output, errors })),
  );
  return { process, exit, text: () => output };
}
async function waitReady(c) {
  for (let n = 0; n < 80; n++) {
    if (c.text().includes('"ready":true')) return;
    if (c.process.exitCode !== null) throw new Error(JSON.stringify(await c.exit));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('No tray ready signal');
}
test(
  'tray has one mutex per installation and exits after its server stops',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka tray '));
    await fs.writeFile(path.join(appRoot, 'package.json'), await fs.readFile('package.json'));
    const app = await run({ appRoot, port: 0 });
    const port = new URL(app.origin).port;
    t.after(async () => {
      await app.close();
      await fs.rm(appRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    });
    const first = child(['-AppRoot', appRoot, '-Port', port]);
    t.after(() => first.process.kill());
    await waitReady(first);
    const second = child(['-AppRoot', appRoot, '-Port', port]);
    const duplicate = await second.exit;
    assert.equal(duplicate.code, 0, duplicate.errors);
    assert.match(duplicate.output, /"duplicate":true/);
    await app.close();
    const stopped = await first.exit;
    assert.equal(stopped.code, 0, stopped.errors);
  },
);
test(
  'tray probe creates all actions but rejects a foreign installation',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'Biblioteczka probe '));
    await fs.writeFile(path.join(appRoot, 'package.json'), await fs.readFile('package.json'));
    const app = await run({ appRoot, port: 0 });
    const port = new URL(app.origin).port;
    t.after(async () => {
      await app.close();
      await fs.rm(appRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    });
    const probe = await child(['-AppRoot', appRoot, '-Port', port, '-Probe']).exit;
    assert.equal(probe.code, 0, probe.errors);
    const data = JSON.parse(probe.output.replace(/^\uFEFF/, ''));
    assert.deepEqual(data.actions, [
      'Otwórz biblioteczkę',
      'Podgląd tapety',
      'Autostart',
      'Spróbuj ponownie',
      'Zamknij Biblioteczkę',
    ]);
    assert.equal(data.autostart, false);
    const before = await (await fetch(app.origin + '/api/health')).json();
    const foreign = await child([
      '-AppRoot',
      path.join(appRoot, 'foreign'),
      ' -Port'.trim(),
      port,
      '-Probe',
    ]).exit;
    assert.notEqual(foreign.code, 0);
    assert.equal((await (await fetch(app.origin + '/api/health')).json()).pid, before.pid);
  },
);
