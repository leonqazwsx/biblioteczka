import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
const { createSpineServiceClient } = await import('../src/spine-service-client.mjs').catch(
  () => ({}),
);
import { png, variant } from './helpers/service-images.mjs';
const id = randomUUID(),
  assetId = createHash('sha256').update(png).digest('hex');
const result = {
  assetId,
  mime: 'image/png',
  size: png.length,
  model: 'fixture',
  promptVersion: 'cover-motif-v1',
};
const job = { id, state: 'queued', retryAt: null, errorCode: null, result: null };
const token = 'fixture_service_token_1234567890';
function client(fetchImpl) {
  assert.equal(typeof createSpineServiceClient, 'function');
  return createSpineServiceClient({ url: 'http://127.0.0.1:47842', token, fetchImpl });
}
test('lost response can be retried with identical UUID and exact cover-only payload', async () => {
  const payloads = [];
  const a = client(async (_, options) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) throw new Error(token);
    return Response.json(job);
  });
  const request = {
    requestId: randomUUID(),
    mime: 'image/png',
    bytes: png,
    priority: 'interactive',
  };
  await assert.rejects(
    a.submit(request),
    (error) => error.code === 'SERVICE_OFFLINE' && !error.message.includes(token),
  );
  await a.submit(request);
  assert.equal(payloads[1].requestId, payloads[0].requestId);
  assert.deepEqual(Object.keys(payloads[0]).sort(), ['base64', 'mime', 'priority', 'requestId']);
});
test('401 terminal transport, 429 retry deadline and redacted errors', async () => {
  let calls = 0;
  const a = client(async () => {
    calls++;
    return new Response(token, { status: 401 });
  });
  await assert.rejects(
    a.get({ id }),
    (error) => error.code === 'SERVICE_UNAUTHORIZED' && !error.message.includes(token),
  );
  assert.equal(calls, 1);
  const b = client(
    async () => new Response('', { status: 429, headers: { 'Retry-After': '300' } }),
  );
  await assert.rejects(
    b.get({ id }),
    (error) => error.code === 'SERVICE_RETRY' && Date.parse(error.retryAt) > Date.now() + 290000,
  );
});
test('strict job validation rejects states, IDs, fields and invalid result', async () => {
  for (const value of [
    { ...job, id: '../bad' },
    { ...job, state: 'processing' },
    { ...job, url: 'https://foreign' },
    { ...job, retryAt: 'tomorrow' },
    { ...job, state: 'ready' },
    { ...job, result },
  ])
    await assert.rejects(client(async () => Response.json(value)).get({ id }), {
      code: 'INVALID_JOB',
    });
});
test('download validates type, bytes, length and digest and never follows redirect', async () => {
  const headers = { 'Content-Type': 'image/png', 'X-Image-SHA256': assetId };
  const valid = client(async () => new Response(png, { headers }));
  assert.deepEqual((await valid.download({ id, expectedResult: result })).bytes, png);
  for (const response of [
    new Response(png, { headers: { ...headers, 'Content-Type': 'image/jpeg' } }),
    new Response(Buffer.concat([png, Buffer.from('x')]), { headers }),
    new Response(png, { headers: { ...headers, 'X-Image-SHA256': '0'.repeat(64) } }),
    new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { headers }),
  ])
    await assert.rejects(client(async () => response).download({ id, expectedResult: result }), {
      code: 'INVALID_IMAGE',
    });
  await assert.rejects(
    client(async (_, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response('', { status: 302, headers: { Location: 'https://foreign' } });
    }).download({ id, expectedResult: result }),
    { code: 'SERVICE_REDIRECT' },
  );
});
test('abort bounds even a transport implementation that ignores its signal', async () => {
  const controller = new AbortController(),
    pending = client(async () => new Promise(() => {})).get({ id, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'SERVICE_ABORTED' });
});
test('correct MIME, size and hash still cannot admit a header-only broken PNG', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    digest = createHash('sha256').update(bytes).digest('hex');
  const broken = client(
    async () =>
      new Response(bytes, { headers: { 'Content-Type': 'image/png', 'X-Image-SHA256': digest } }),
  );
  await assert.rejects(
    broken.download({ id, expectedResult: { ...result, assetId: digest, size: bytes.length } }),
    { code: 'INVALID_IMAGE' },
  );
});
