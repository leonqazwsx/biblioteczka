import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { problem } from './domain.mjs';
import { t } from '../public/shared/i18n.mjs';

const executeDefault = promisify(execFile);
const ACTIONS = new Set(['status', 'enable', 'disable', 'open-settings']);

/**
 * Windows features (start with Windows, opening the panel window) belong to the .NET host
 * (host/Biblioteczka.Host). The server asks it through `Biblioteczka.exe --control <action>`,
 * which prints one JSON object. Without a host (e.g. `npm start`) these features are unavailable.
 */
export function createWindowsIntegration({
  hostExe = null,
  port,
  platform = process.platform,
  execute = executeDefault,
}) {
  const unsupported = { supported: false, autostart: false, conflict: false, canEnable: false };
  const available = platform === 'win32' && typeof hostExe === 'string' && hostExe.length > 0;
  let opening;

  async function control(action) {
    if (!ACTIONS.has(action)) throw problem('INVALID', t('Nieznane polecenie Windows.'));
    if (!available) {
      if (action === 'status') return { ...unsupported };
      throw problem(
        'WINDOWS_UNAVAILABLE',
        action === 'open-settings'
          ? t('Panel otwiera się z aplikacji Biblioteczka.')
          : t('Autostart jest dostępny w aplikacji Biblioteczka dla Windows.'),
      );
    }
    let result;
    try {
      const { stdout } = await execute(hostExe, ['--control', action, '--port', String(port)], {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 65536,
        encoding: 'utf8',
      });
      result = JSON.parse(stdout.replace(/^﻿/, ''));
    } catch {
      throw problem(
        'WINDOWS_UNAVAILABLE',
        action === 'open-settings'
          ? t('Nie udało się otworzyć panelu. Spróbuj ponownie.')
          : t('Nie udało się odczytać ustawień Windows. Spróbuj uruchomić Biblioteczkę ponownie.'),
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw problem('WINDOWS_UNAVAILABLE', t('Nieprawidłowa odpowiedź aplikacji.'));
    if (typeof result.error === 'string') throw problem('WINDOWS_UNAVAILABLE', result.error);
    return result;
  }

  return {
    status: () => control('status'),
    setAutostart: async (enabled) => {
      if (typeof enabled !== 'boolean')
        throw problem('INVALID', t('Wybierz włączenie lub wyłączenie autostartu.'));
      return control(enabled ? 'enable' : 'disable');
    },
    openSettings: async () => {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw problem('INVALID', t('Nieprawidłowy port.'));
      opening ??= control('open-settings')
        .then((result) => {
          if (result.opened !== true)
            throw problem(
              'WINDOWS_UNAVAILABLE',
              t('Nie udało się otworzyć panelu. Spróbuj ponownie.'),
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
