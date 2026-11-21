import http from 'node:http';
import {timingSafeEqual, createHash} from 'node:crypto';
import {problem} from '../../src/domain.mjs';
import {exactKeys, isUuid, imageTypes} from '../../src/durable-files.mjs';
import {validateCredentials} from './config.mjs';

const maxBody = 7 * 1024 * 1024;
function readBody(req) {
  if (Number(req.headers['content-length']) > maxBody) {req.resume(); return Promise.reject(problem('TOO_LARGE', 'Zgłoszenie jest zbyt duże.'));}
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const cleanup = () => {req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', abort);};
    const fail = error => {cleanup(); reject(error);};
    const abort = () => fail(problem('INVALID', 'Przerwane zgłoszenie.'));
    const end = () => {cleanup(); resolve(Buffer.concat(chunks));};
    const data = chunk => {size += chunk.length; if (size > maxBody) {fail(problem('TOO_LARGE', 'Zgłoszenie jest zbyt duże.')); req.resume();} else chunks.push(chunk);};
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', abort);
  });
}
export function createSpineServiceServer({store, worker, credentials, clock = () => new Date()}) {
  const tokens = [...validateCredentials(credentials)].map(([token, installationId]) => [Buffer.from(token), installationId]);
  const windows = new Map();
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}); res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const authorization = req.headers.authorization;
      const presented = typeof authorization === 'string' && /^Bearer [A-Za-z0-9._~-]{24,512}$/.test(authorization) ? Buffer.from(authorization.slice(7)) : Buffer.alloc(0);
      let installationId = null;
      for (const [token, id] of tokens) if (token.length === presented.length && timingSafeEqual(token, presented)) installationId = id;
      if (!installationId) {req.resume(); return json(res, 401, {error: 'UNAUTHORIZED'});}
      const now = clock().getTime(); let window = windows.get(installationId);
      if (!window || now >= window.start + 60000) {window = {start: now, count: 0}; windows.set(installationId, window);}
      if (++window.count > 60) {req.resume(); return json(res, 429, {error: 'RATE_LIMITED'}, {'Retry-After': String(Math.max(1, Math.ceil((window.start + 60000 - now) / 1000)))});}
      if (req.method === 'POST' && req.url === '/v1/spine-jobs') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw problem('INVALID', 'Wymagany JSON.');
        let input; try {input = JSON.parse((await readBody(req)).toString('utf8'));} catch (error) {if (error.code === 'TOO_LARGE') throw error; throw problem('INVALID', 'Nieprawidłowy JSON.');}
        if (!exactKeys(input, ['requestId', 'mime', 'base64', 'priority']) || !isUuid(input.requestId) || !imageTypes.includes(input.mime) ||
            !['interactive', 'backfill'].includes(input.priority) || typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))
          throw problem('INVALID', 'Nieprawidłowe zgłoszenie.');
        if (input.base64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4) throw problem('TOO_LARGE', 'Obraz jest zbyt duży.');
        const bytes = Buffer.from(input.base64, 'base64');
        if (bytes.toString('base64') !== input.base64) throw problem('INVALID', 'Niekanoniczny zapis obrazu.');
        const job = await store.submit({installationId, requestId: input.requestId, mime: input.mime, bytes, priority: input.priority});
        worker.wake(); return json(res, ['queued', 'generating'].includes(job.state) ? 202 : 200, job);
      }
      const match = /^\/v1\/spine-jobs\/([0-9a-f-]+)(\/image)?$/.exec(req.url);
      if (req.method === 'GET' && match && isUuid(match[1])) {
        const input = {installationId, id: match[1]};
        if (!match[2]) return json(res, 200, store.get(input));
        const {bytes, mime} = await store.readResult(input);
        res.writeHead(200, {'Content-Type': mime, 'Content-Length': bytes.length, 'X-Image-SHA256': createHash('sha256').update(bytes).digest('hex'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); return res.end(bytes);
      }
      req.resume(); return json(res, 404, {error: 'NOT_FOUND'});
    } catch (error) {
      req.resume(); const code = error.code ?? 'SERVICE_ERROR';
      const status = {INVALID: 400, TOO_LARGE: 413, CONFLICT: 409, NOT_FOUND: 404, NOT_READY: 409, QUEUE_FULL: 429}[code] ?? 503;
      // No raw exception, path, credential or provider response is exposed.
      json(res, status, {error: status === 503 ? 'SERVICE_UNAVAILABLE' : code}, code === 'QUEUE_FULL' ? {'Retry-After': '300'} : {});
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  return server;
}
