import path from 'node:path';
import {problem} from '../../src/domain.mjs';
import {validServiceToken} from '../../src/spine-service-config.mjs';
export {localSpineServiceConfig} from '../../src/spine-service-config.mjs';

export function validateCredentials(credentials) {
  if (!(credentials instanceof Map) || !credentials.size || [...credentials].some(([token, id]) =>
    !validServiceToken(token) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw problem('SERVICE_CONFIG', 'Nieprawidłowa konfiguracja poświadczeń instalacji.');
  return new Map(credentials);
}
export function serviceConfig(env = process.env) {
  let entries;
  try {const parsed = JSON.parse(env.BOOKSHELF_SPINE_CREDENTIALS); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); entries = Object.entries(parsed);}
  catch {throw problem('SERVICE_CONFIG', 'Ustaw poświadczenia prywatnej usługi.');}
  const credentials = validateCredentials(new Map(entries)), port = Number(env.BOOKSHELF_SPINE_PORT ?? 47842);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !env.BOOKSHELF_SPINE_DATA_DIR || !path.isAbsolute(env.BOOKSHELF_SPINE_DATA_DIR))
    throw problem('SERVICE_CONFIG', 'Ustaw trwały bezwzględny katalog danych i poprawny port.');
  return {credentials, dataDir: env.BOOKSHELF_SPINE_DATA_DIR, port, host: env.BOOKSHELF_SPINE_HOST ?? '127.0.0.1'};
}
export function cloudflareProviderConfig(env = process.env) {
  if (env.BOOKSHELF_SPINE_PROVIDER !== 'cloudflare' || env.BOOKSHELF_SPINE_FREE_CONFIRMED !== '1' ||
      typeof env.CLOUDFLARE_ACCOUNT_ID !== 'string' || !/^[0-9a-f]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID) ||
      typeof env.CLOUDFLARE_API_TOKEN !== 'string' || !/^[\x21-\x7e]{24,512}$/.test(env.CLOUDFLARE_API_TOKEN))
    throw problem('SERVICE_CONFIG', 'Ustaw konto Cloudflare Workers Free i poświadczenia w środowisku operatora.');
  return {accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN, freeConfirmed: true};
}
