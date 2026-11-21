import test from 'node:test';
import assert from 'node:assert/strict';
const windows = await import('../src/windows.mjs').catch(() => ({}));
test(
  'Windows Startup shortcut remains controllable and safely migrates owned legacy registrations',
  { skip: process.platform !== 'win32' },
  async () => {
    const { execFile } = await import('node:child_process'),
      { promisify } = await import('node:util'),
      path = await import('node:path');
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('tests/windows-control.ps1'),
      ],
      { windowsHide: true, timeout: 20000 },
    );
    assert.match(stdout, /WINDOWS_STARTUP_OK/);
  },
);
test('unsupported platforms do not invoke Windows or enable autostart', async () => {
  const bridge = windows.createWindowsIntegration({
    appRoot: '/tmp/Biblioteczka',
    port: 47831,
    platform: 'linux',
    execute: () => {
      throw new Error('must not run');
    },
  });
  assert.deepEqual(await bridge.status(), {
    supported: false,
    autostart: false,
    conflict: false,
    canEnable: false,
  });
  await assert.rejects(
    () => bridge.setAutostart(true),
    (e) => e.code === 'WINDOWS_UNAVAILABLE',
  );
});
test('Windows control passes paths as literal arguments and rejects nonboolean settings', async () => {
  const appRoot = "C:\\Readers & books\\Anna's room\\Biblioteczka";
  const bridge = windows.createWindowsIntegration({
    appRoot,
    port: 47831,
    platform: 'win32',
    execute: async (file, args) => {
      assert.equal(file.toLowerCase().endsWith('powershell.exe'), true);
      assert.equal(args[args.indexOf('-AppRoot') + 1], appRoot);
      const action = args[args.indexOf('-Action') + 1];
      return {
        stdout: JSON.stringify({
          supported: true,
          autostart: action === 'enable',
          conflict: false,
          canEnable: true,
        }),
      };
    },
  });
  assert.equal((await bridge.status()).autostart, false);
  assert.equal((await bridge.setAutostart(true)).autostart, true);
  await assert.rejects(
    () => bridge.setAutostart('true'),
    (e) => e.code === 'INVALID',
  );
});
test('Windows control failures become a useful error rather than malformed JSON', async () => {
  const bridge = windows.createWindowsIntegration({
    appRoot: 'C:\\Biblioteczka',
    port: 47831,
    platform: 'win32',
    execute: async () => {
      throw Object.assign(new Error('failed'), { stderr: 'Obca wartość autostartu.' });
    },
  });
  await assert.rejects(
    () => bridge.setAutostart(false),
    (e) => e.code === 'WINDOWS_UNAVAILABLE' && e.message.includes('Obca wartość'),
  );
});

test('settings launch is a fixed Windows action and concurrent clicks share one operation', async () => {
  let calls = 0,
    release;
  const pending = new Promise((r) => (release = r)),
    appRoot = "C:\\Readers & books\\Anna's room\\Biblioteczka";
  const bridge = windows.createWindowsIntegration({
    appRoot,
    port: 47831,
    platform: 'win32',
    execute: async (file, args, opts) => {
      calls++;
      assert.equal(args[args.indexOf('-Action') + 1], 'open-settings');
      assert.equal(args[args.indexOf('-Port') + 1], '47831');
      assert.equal(args[args.indexOf('-AppRoot') + 1], appRoot);
      assert.equal(opts.windowsHide, true);
      await pending;
      return { stdout: '{"opened":true}' };
    },
  });
  const a = bridge.openSettings(),
    b = bridge.openSettings();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await a, { opened: true });
  assert.deepEqual(await b, { opened: true });
});
test('settings launch rejects unsupported systems and invalid ports before executing', async () => {
  let calls = 0;
  const execute = async () => {
    calls++;
    return { stdout: '{}' };
  };
  await assert.rejects(
    () =>
      windows
        .createWindowsIntegration({
          appRoot: 'C:\\Biblioteczka',
          port: 47831,
          platform: 'linux',
          execute,
        })
        .openSettings(),
    (e) => e.code === 'WINDOWS_UNAVAILABLE',
  );
  for (const port of [0, 65536, 47831.5, '47831'])
    await assert.rejects(
      () =>
        windows
          .createWindowsIntegration({
            appRoot: 'C:\\Biblioteczka',
            port,
            platform: 'win32',
            execute,
          })
          .openSettings(),
      (e) => e.code === 'INVALID',
    );
  assert.equal(calls, 0);
});
test(
  'Windows settings PowerShell opens only the validated loopback settings URL',
  { skip: process.platform !== 'win32' },
  async () => {
    const { execFile } = await import('node:child_process'),
      { promisify } = await import('node:util'),
      path = await import('node:path');
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('tests/windows-settings.ps1'),
      ],
      { windowsHide: true, timeout: 15000 },
    );
    assert.match(stdout, /WINDOWS_SETTINGS_OK/);
  },
);
