import { operatorConfig } from './pilot-input.mjs';
import { cloudflareProfile } from './cloudflare-profiles.mjs';
import { problem } from '../../src/domain.mjs';

async function boundedJson(response) {
  if (
    !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') ||
    Number(response.headers.get('content-length')) > 65536 ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error('INVALID_CHECK');
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error('INVALID_CHECK');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

export async function checkCloudflareAccess({
  accountId,
  apiToken,
  profile = 'default',
  fetchImpl = fetch,
  timeoutMs = 10000,
}) {
  const config = operatorConfig({ accountId, apiToken, freeConfirmed: true });
  const model = cloudflareProfile(profile).config.remoteModel;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw problem('SERVICE_CONFIG', 'Nieprawidlowy czas sprawdzenia.');
  async function probe(route, kind) {
    let http = null,
      timer;
    const controller = new AbortController();
    const unknown = () => ({
      http,
      status: 'UNCONFIRMED',
      codes: [],
      ...(kind === 'workersAI' ? { modelFound: null } : {}),
    });
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(unknown());
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        timeout,
        (async () => {
          const response = await fetchImpl('https://api.cloudflare.com/client/v4' + route, {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + config.apiToken },
            redirect: 'manual',
            signal: controller.signal,
          });
          http = response.status;
          if (http >= 300 && http < 400) {
            await response.body?.cancel().catch(() => {});
            return unknown();
          }
          const data = await boundedJson(response);
          const codes = Array.isArray(data?.errors)
            ? [
                ...new Set(
                  data.errors
                    .map((error) => error?.code)
                    .filter((code) => Number.isSafeInteger(code) && code >= 0 && code <= 999999999),
                ),
              ]
            : [];
          if (data?.success === false) return { ...unknown(), status: 'REFUSED', codes };
          if (
            !response.ok ||
            data?.success !== true ||
            !Array.isArray(data.errors) ||
            data.errors.length
          )
            return unknown();
          if (kind === 'token')
            return data.result?.status === 'active'
              ? { http, status: 'ACTIVE', codes: [] }
              : unknown();
          if (!Array.isArray(data.result)) return unknown();
          return {
            http,
            status: 'OK',
            codes: [],
            modelFound: data.result.some((entry) => entry?.name === model),
          };
        })(),
      ]);
    } catch {
      return unknown();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  const [token, workersAI] = await Promise.all([
    probe('/user/tokens/verify', 'token'),
    probe(
      '/accounts/' +
        config.accountId +
        '/ai/models/search?search=' +
        model.split('/').at(-1) +
        '&per_page=20',
      'workersAI',
    ),
  ]);
  return { token, workersAI };
}
