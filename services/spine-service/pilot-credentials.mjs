import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { problem } from '../../src/domain.mjs';
import {
  assertSafePath,
  ensureDirectory,
  atomicWrite,
  exactKeys,
} from '../../src/durable-files.mjs';
import { accountId, apiToken, createHiddenPrompt } from './pilot-input.mjs';

const failure = (kind) =>
  problem(
    'PILOT_CREDENTIALS_' + kind,
    'Nie udalo sie ' +
      ({ READ: 'odczytac', WRITE: 'zapisac', FORGET: 'usunac' }[kind] ?? 'przetworzyc') +
      ' zapisanych danych Cloudflare.',
  );

// Only static program text is placed in the command line. Both directions use a
// private stdin/stdout pipe; no secret is passed as an argument or environment key.
async function windowsCrypt(operation, bytes) {
  if (process.platform !== 'win32' || !path.isAbsolute(process.env.SystemRoot ?? ''))
    throw failure('CRYPT');
  const script = `$ErrorActionPreference='Stop'
$inputBytes=$null; $outputBytes=$null
try {
  Add-Type -AssemblyName System.Security
  $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
  $entropy=[Text.Encoding]::UTF8.GetBytes('BiblioteczkaSpinePilot.credentials.v1')
  $outputBytes=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
} catch { [Console]::Error.WriteLine('PILOT_CREDENTIALS_CRYPT'); exit 1 }
finally {
  if($null -ne $inputBytes){[Array]::Clear($inputBytes,0,$inputBytes.Length)}
  if($null -ne $outputBytes){[Array]::Clear($outputBytes,0,$outputBytes.Length)}
}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:CLOUDFLARE_|BOOKSHELF_SPINE_|OPENAI_API_KEY$)/i.test(key),
    ),
  );
  return new Promise((resolve, reject) => {
    const child = execFile(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 65536, encoding: 'utf8' },
      (error, stdout) => {
        const encoded = stdout?.trim();
        if (
          error ||
          !encoded ||
          encoded.length > 32768 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        ) {
          reject(failure('CRYPT'));
          return;
        }
        resolve(Buffer.from(encoded, 'base64'));
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(bytes.toString('base64'));
  });
}
const windowsProtection = {
  protect: (bytes) => windowsCrypt('Protect', bytes),
  unprotect: (bytes) => windowsCrypt('Unprotect', bytes),
};

export function createCredentialStore({ localAppData, protection = windowsProtection }) {
  if (!path.isAbsolute(localAppData ?? ''))
    throw problem('PILOT_LOCAL_DATA', 'Brak lokalnego katalogu danych Windows.');
  const pilotRoot = path.join(localAppData, 'BiblioteczkaSpinePilot'),
    directory = path.join(pilotRoot, 'credentials'),
    file = path.join(directory, 'cloudflare-v1.dpapi');
  async function existing() {
    for (const folder of [pilotRoot, directory])
      if (!(await assertSafePath(folder, { directory: true, missing: true }))) return null;
    return assertSafePath(file, { missing: true });
  }
  return {
    async load() {
      let clear;
      try {
        const stat = await existing();
        if (!stat) return null;
        if (stat.size < 1 || stat.size > 16384) throw failure('READ');
        clear = await protection.unprotect(await fs.readFile(file));
        if (!Buffer.isBuffer(clear) || clear.length > 4096) throw failure('READ');
        const value = JSON.parse(clear.toString('utf8'));
        if (!exactKeys(value, ['version', 'accountId', 'apiToken']) || value.version !== 1)
          throw failure('READ');
        return { accountId: accountId(value.accountId), apiToken: apiToken(value.apiToken) };
      } catch {
        throw failure('READ');
      } finally {
        clear?.fill(0);
      }
    },
    async save(value) {
      // Validate before encryption; only encrypted bytes ever reach durable files.
      const normalized = {
        version: 1,
        accountId: accountId(value?.accountId),
        apiToken: apiToken(value?.apiToken),
      };
      const clear = Buffer.from(JSON.stringify(normalized));
      try {
        const encrypted = await protection.protect(clear);
        if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > 16384)
          throw failure('WRITE');
        await ensureDirectory(pilotRoot);
        await ensureDirectory(directory);
        await atomicWrite(file, encrypted);
      } catch {
        throw failure('WRITE');
      } finally {
        clear.fill(0);
      }
    },
    async forget() {
      try {
        if (!(await existing())) return false;
        await fs.unlink(file);
        return true;
      } catch {
        throw failure('FORGET');
      }
    },
  };
}

export async function readOperatorCredentials({
  store,
  remember = false,
  replace = false,
  promptFactory = createHiddenPrompt,
}) {
  if (!replace) {
    const saved = await store.load();
    if (saved) return { ...saved, source: 'stored', saved: true };
  }
  const prompt = promptFactory();
  let id, token;
  async function read(label, validate) {
    for (;;) {
      try {
        return validate(await prompt.ask(label));
      } catch (error) {
        if (!['PILOT_ACCOUNT_ID', 'PILOT_API_TOKEN'].includes(error.code)) throw error;
        console.log(error.message);
      }
    }
  }
  try {
    id = await read('Account ID (32 znaki): ', accountId);
    token = await read('Token Workers AI: ', apiToken);
  } finally {
    await prompt.close();
  }
  const result = { accountId: id, apiToken: token };
  if (remember) await store.save(result);
  return { ...result, source: 'entered', saved: remember };
}
