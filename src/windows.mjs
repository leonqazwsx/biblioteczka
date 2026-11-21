import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { problem } from './domain.mjs';
const executeDefault = promisify(execFile);
export function createWindowsIntegration({
  appRoot,
  port,
  platform = process.platform,
  execute = executeDefault,
}) {
  const unsupported = { supported: false, autostart: false, conflict: false, canEnable: false };
  let opening;
  async function control(action) {
    if (platform !== 'win32') {
      if (action === 'status') return { ...unsupported };
      throw problem(
        'WINDOWS_UNAVAILABLE',
        action === 'open-settings'
          ? 'Otwieranie ustawień jest dostępne w Windows.'
          : 'Autostart jest dostępny w Windows.',
      );
    }
    const executable = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    try {
      const { stdout } = await execute(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(appRoot, 'scripts', 'windows.ps1'),
          '-AppRoot',
          appRoot,
          '-Port',
          String(port),
          '-Action',
          action,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536, encoding: 'utf8' },
      );
      return JSON.parse(stdout.replace(/^\uFEFF/, ''));
    } catch (e) {
      throw problem(
        'WINDOWS_UNAVAILABLE',
        String(
          e.stderr?.trim() ||
            (action === 'open-settings'
              ? 'Nie udało się otworzyć ustawień w przeglądarce. Spróbuj ponownie.'
              : 'Nie udało się odczytać ustawień Windows. Spróbuj uruchomić Biblioteczkę ponownie.'),
        ),
      );
    }
  }
  return {
    status: () => control('status'),
    setAutostart: async (enabled) => {
      if (typeof enabled !== 'boolean')
        throw problem('INVALID', 'Wybierz włączenie lub wyłączenie autostartu.');
      return control(enabled ? 'enable' : 'disable');
    },
    openSettings: async () => {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw problem('INVALID', 'Nieprawidłowy port.');
      if (!opening)
        opening = control('open-settings')
          .then((result) => {
            if (result?.opened !== true)
              throw problem(
                'WINDOWS_UNAVAILABLE',
                'Nie udało się otworzyć ustawień w przeglądarce. Spróbuj ponownie.',
              );
            return { opened: true };
          })
          .finally(() => {
            opening = null;
          });
      return opening;
    },
  };
}
