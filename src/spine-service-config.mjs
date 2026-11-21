import { problem } from './domain.mjs';
export const validServiceToken = (token) =>
  typeof token === 'string' && /^[A-Za-z0-9._~-]{24,512}$/.test(token);
export function normalizeServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw problem('SERVICE_CONFIG', 'Nieprawidłowa konfiguracja usługi ilustracji.');
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw problem('SERVICE_CONFIG', 'Usługa ilustracji wymaga bezpiecznego adresu.');
  return url.origin;
}
export function localSpineServiceConfig(env = process.env) {
  const url = env.BOOKSHELF_SPINE_SERVICE_URL,
    token = env.BOOKSHELF_SPINE_SERVICE_TOKEN;
  if (!url && !token) return null;
  if (!url || !validServiceToken(token))
    throw problem('SERVICE_CONFIG', 'Niepełna konfiguracja usługi ilustracji.');
  return { url: normalizeServiceUrl(url), token };
}
