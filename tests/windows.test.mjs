import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsIntegration } from '../src/windows.mjs';

const HOST = 'C:\\Program Files\\Biblioteczka\\Biblioteczka.exe';

function fakeHost(reply) {
  const calls = [];
  return {
    calls,
    execute: async (file, args, options) => {
      calls.push({ file, args, options });
      const value = typeof reply === 'function' ? await reply(args) : reply;
      return { stdout: typeof value === 'string' ? value : JSON.stringify(value) };
    },
  };
}

test('without the .NET host Windows features are reported as unavailable and nothing runs', async () => {
  for (const options of [
    { hostExe: null, platform: 'win32' },
    { hostExe: HOST, platform: 'linux' },
  ]) {
    const host = fakeHost({});
    const windows = createWindowsIntegration({ ...options, port: 47831, execute: host.execute });
    assert.deepEqual(await windows.status(), {
      supported: false,
      autostart: false,
      conflict: false,
      canEnable: false,
    });
    await assert.rejects(windows.setAutostart(true), (e) => e.code === 'WINDOWS_UNAVAILABLE');
    await assert.rejects(windows.openSettings(), (e) => e.code === 'WINDOWS_UNAVAILABLE');
    assert.equal(host.calls.length, 0);
  }
});

test('autostart goes through the host control command with literal arguments', async () => {
  const host = fakeHost((args) => ({
    supported: true,
    autostart: args[1] === 'enable',
    conflict: false,
    canEnable: true,
  }));
  const windows = createWindowsIntegration({
    hostExe: HOST,
    port: 47831,
    platform: 'win32',
    execute: host.execute,
  });
  assert.equal((await windows.setAutostart(true)).autostart, true);
  assert.equal((await windows.setAutostart(false)).autostart, false);
  assert.deepEqual(host.calls[0].args, ['--control', 'enable', '--port', '47831']);
  assert.equal(host.calls[0].file, HOST);
  assert.equal(host.calls[0].options.windowsHide, true);
  await assert.rejects(windows.setAutostart('yes'), (e) => e.code === 'INVALID');
  assert.equal(host.calls.length, 2);
});

test('host errors and malformed replies become useful errors', async () => {
  const cases = [
    [{ error: 'Brak dostępu do rejestru.' }, /Brak dostępu do rejestru/],
    ['not json', /Nie udało się odczytać ustawień Windows/],
    [[1, 2], /Nieprawidłowa odpowiedź/],
  ];
  for (const [reply, message] of cases) {
    const host = fakeHost(reply);
    const windows = createWindowsIntegration({
      hostExe: HOST,
      port: 47831,
      platform: 'win32',
      execute: host.execute,
    });
    await assert.rejects(
      windows.status(),
      (e) => e.code === 'WINDOWS_UNAVAILABLE' && message.test(e.message),
    );
  }
  const failing = createWindowsIntegration({
    hostExe: HOST,
    port: 47831,
    platform: 'win32',
    execute: async () => {
      throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    },
  });
  await assert.rejects(failing.status(), (e) => e.code === 'WINDOWS_UNAVAILABLE');
});

test('opening the panel asks the running app once even for concurrent clicks', async () => {
  let release;
  const host = fakeHost(
    () => new Promise((resolve) => (release = () => resolve({ opened: true }))),
  );
  const windows = createWindowsIntegration({
    hostExe: HOST,
    port: 47831,
    platform: 'win32',
    execute: host.execute,
  });
  const first = windows.openSettings(),
    second = windows.openSettings();
  await new Promise((r) => setImmediate(r));
  release();
  assert.deepEqual(await first, { opened: true });
  assert.deepEqual(await second, { opened: true });
  assert.equal(host.calls.length, 1);
  assert.deepEqual(host.calls[0].args, ['--control', 'open-settings', '--port', '47831']);
});

test('opening the panel reports when no running app answered and rejects invalid ports', async () => {
  const host = fakeHost({ opened: false });
  const windows = createWindowsIntegration({
    hostExe: HOST,
    port: 47831,
    platform: 'win32',
    execute: host.execute,
  });
  await assert.rejects(windows.openSettings(), (e) => e.code === 'WINDOWS_UNAVAILABLE');
  const invalid = createWindowsIntegration({
    hostExe: HOST,
    port: 0,
    platform: 'win32',
    execute: host.execute,
  });
  await assert.rejects(invalid.openSettings(), (e) => e.code === 'INVALID');
});
