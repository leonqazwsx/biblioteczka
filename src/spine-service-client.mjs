import { createHash } from 'node:crypto';
import { problem } from './domain.mjs';
import { exactKeys, isUuid, isHash, isIso, imageTypes } from './durable-files.mjs';
import { normalizeServiceUrl, validServiceToken } from './spine-service-config.mjs';
import { validateImageBytes } from './image-validation.mjs';

export function validateSpineResult(result) {
  if (
    !exactKeys(result, ['assetId', 'mime', 'size', 'model', 'promptVersion']) ||
    !isHash(result.assetId) ||
    !imageTypes.includes(result.mime) ||
    !Number.isSafeInteger(result.size) ||
    result.size < 1 ||
    result.size > 5 * 1024 * 1024 ||
    typeof result.model !== 'string' ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(result.model) ||
    typeof result.promptVersion !== 'string' ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(result.promptVersion)
  )
    throw problem('INVALID_JOB', 'Nieprawidłowa odpowiedź usługi ilustracji.');
  return result;
}
export function validateSpineJob(job) {
  if (
    !exactKeys(job, ['id', 'state', 'retryAt', 'errorCode', 'result']) ||
    !isUuid(job.id) ||
    !['queued', 'generating', 'ready', 'failed', 'uncertain'].includes(job.state) ||
    (job.retryAt !== null && !isIso(job.retryAt)) ||
    (job.errorCode !== null && !/^[A-Z_]{1,64}$/.test(job.errorCode)) ||
    (job.state === 'ready' ? job.result === null : job.result !== null)
  )
    throw problem('INVALID_JOB', 'Nieprawidłowa odpowiedź usługi ilustracji.');
  if (job.result) validateSpineResult(job.result);
  return job;
}

async function boundedBytes(response, limit, code) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => {});
    throw problem(code, 'Nieprawidłowa odpowiedź usługi ilustracji.');
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw problem(code, 'Nieprawidłowa odpowiedź usługi ilustracji.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function createSpineServiceClient({ url, token, fetchImpl = fetch, timeoutMs = 20000 }) {
  const origin = normalizeServiceUrl(url);
  if (!validServiceToken(token))
    throw problem('SERVICE_CONFIG', 'Nieprawidłowe poświadczenia usługi.');
  async function request(route, { signal, body, image = false, expectedResult } = {}) {
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let rejectAbort;
    const aborted = new Promise((_, reject) => {
      rejectAbort = () =>
        reject(
          problem(
            signal?.aborted ? 'SERVICE_ABORTED' : 'SERVICE_OFFLINE',
            'Usługa ilustracji jest chwilowo niedostępna.',
          ),
        );
    });
    combined.addEventListener('abort', rejectAbort, { once: true });
    if (combined.aborted) rejectAbort();
    try {
      return await Promise.race([
        aborted,
        (async () => {
          const response = await fetchImpl(origin + route, {
            method: body ? 'POST' : 'GET',
            redirect: 'manual',
            signal: combined,
            headers: {
              Authorization: 'Bearer ' + token,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel();
            throw problem('SERVICE_REDIRECT', 'Usługa zwróciła nieoczekiwane przekierowanie.');
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            if (response.status === 401 || response.status === 403)
              throw problem('SERVICE_UNAUTHORIZED', 'Usługa ilustracji jest niedostępna.');
            if ([429, 503].includes(response.status)) {
              const header = response.headers.get('retry-after'),
                numeric = /^\d+$/.test(header ?? '') ? Number(header) : null;
              const deadline =
                numeric !== null
                  ? Date.now() + Math.min(numeric, 86400) * 1000
                  : Date.parse(header ?? '');
              const error = problem('SERVICE_RETRY', 'Usługa ilustracji jest chwilowo zajęta.');
              error.retryAt = new Date(
                Number.isFinite(deadline)
                  ? Math.max(deadline, Date.now() + 1000)
                  : Date.now() + 300000,
              ).toISOString();
              throw error;
            }
            throw problem('SERVICE_REJECTED', 'Usługa nie przyjęła zgłoszenia ilustracji.');
          }
          if (!image) {
            if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
              throw problem('INVALID_JOB', 'Nieprawidłowa odpowiedź usługi ilustracji.');
            const bytes = await boundedBytes(response, 16384, 'INVALID_JOB');
            let job;
            try {
              job = JSON.parse(bytes.toString('utf8'));
            } catch {
              throw problem('INVALID_JOB', 'Nieprawidłowa odpowiedź usługi ilustracji.');
            }
            return validateSpineJob(job);
          }
          const mime = response.headers.get('content-type'),
            digest = response.headers.get('x-image-sha256');
          if (mime !== expectedResult.mime || digest !== expectedResult.assetId) {
            await response.body?.cancel();
            throw problem('INVALID_IMAGE', 'Obraz nie przeszedł kontroli pobrania.');
          }
          const bytes = await boundedBytes(response, 5 * 1024 * 1024, 'INVALID_IMAGE');
          let detected;
          try {
            detected = validateImageBytes(bytes, mime);
          } catch {
            throw problem('INVALID_IMAGE', 'Obraz nie przeszedł kontroli pobrania.');
          }
          if (
            bytes.length !== expectedResult.size ||
            detected !== mime ||
            createHash('sha256').update(bytes).digest('hex') !== expectedResult.assetId
          )
            throw problem('INVALID_IMAGE', 'Obraz nie przeszedł kontroli pobrania.');
          return { bytes, mime };
        })(),
      ]);
    } catch (error) {
      if (
        [
          'SERVICE_REDIRECT',
          'SERVICE_UNAUTHORIZED',
          'SERVICE_RETRY',
          'SERVICE_REJECTED',
          'INVALID_JOB',
          'INVALID_IMAGE',
          'SERVICE_ABORTED',
        ].includes(error.code)
      )
        throw error;
      throw problem(
        signal?.aborted ? 'SERVICE_ABORTED' : 'SERVICE_OFFLINE',
        'Usługa ilustracji jest chwilowo niedostępna.',
      );
    } finally {
      combined.removeEventListener('abort', rejectAbort);
    }
  }
  function route(id) {
    if (!isUuid(id)) throw problem('INVALID_JOB', 'Nieprawidłowy numer zadania.');
    return '/v1/spine-jobs/' + id;
  }
  return {
    origin,
    requestSpacingMs: 1100,
    submit({ requestId, mime, bytes, priority, signal }) {
      if (
        !isUuid(requestId) ||
        !imageTypes.includes(mime) ||
        !['interactive', 'backfill'].includes(priority) ||
        !Buffer.isBuffer(bytes) ||
        bytes.length > 5 * 1024 * 1024
      )
        return Promise.reject(problem('INVALID_JOB', 'Nieprawidłowe zgłoszenie ilustracji.'));
      try {
        validateImageBytes(bytes, mime);
      } catch {
        return Promise.reject(problem('INVALID_IMAGE', 'Nieprawidłowa okładka.'));
      }
      return request('/v1/spine-jobs', {
        signal,
        body: { requestId, mime, base64: bytes.toString('base64'), priority },
      });
    },
    get({ id, signal }) {
      return request(route(id), { signal });
    },
    download({ id, expectedResult, signal }) {
      validateSpineResult(expectedResult);
      return request(route(id) + '/image', { signal, image: true, expectedResult });
    },
  };
}
