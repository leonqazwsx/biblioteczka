import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { installationId } from '../src/installation.mjs';
import { fixture, execute } from './helpers/windows-runtime.mjs';
test(
  'standalone launcher reports owned readiness and a repeated launch keeps the same runtime',
  { skip: process.platform !== 'win32', timeout: 80000 },
  async (t) => {
    const f = await fixture(t),
      args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(f.root, 'scripts/start.ps1'),
        '-AppRoot',
        f.root,
        '-Port',
        String(f.port),
        '-NoBrowser',
        '-ResultJson',
      ];
    const first = await execute('powershell.exe', args, { windowsHide: true, timeout: 60000 });
    const line = first.stdout.split(/\r?\n/).find((s) => s.startsWith('BOOKSHELF_STARTED:'));
    assert.ok(line, first.stdout);
    const proof = JSON.parse(line.slice('BOOKSHELF_STARTED:'.length));
    assert.equal(proof.installationId, installationId(f.root));
    assert.ok(proof.sessionId);
    const again = await execute('powershell.exe', args, { windowsHide: true, timeout: 60000 });
    const next = JSON.parse(
      again.stdout
        .split(/\r?\n/)
        .find((s) => s.startsWith('BOOKSHELF_STARTED:'))
        .slice('BOOKSHELF_STARTED:'.length),
    );
    assert.equal(next.pid, proof.pid);
    assert.equal(next.sessionId, proof.sessionId);
  },
);
test(
  'server and guardian survive closure of the owned kill-on-close launcher Job',
  { skip: process.platform !== 'win32', timeout: 80000 },
  async (t) => {
    const f = await fixture(t);
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('tests/standalone-job.ps1'),
        '-AppRoot',
        f.root,
        '-Port',
        String(f.port),
      ],
      { windowsHide: true, timeout: 60000 },
    );
    assert.match(stdout, /STANDALONE_JOB_OK/);
  },
);
test(
  'a non-killing inner Job cannot hide an outer kill-on-close launcher Job',
  { skip: process.platform !== 'win32', timeout: 80000 },
  async (t) => {
    const f = await fixture(t);
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('tests/standalone-job.ps1'),
        '-AppRoot',
        f.root,
        '-Port',
        String(f.port),
        '-Nested',
      ],
      { timeout: 60000 },
    );
    assert.match(stdout, /STANDALONE_JOB_OK/);
  },
);
