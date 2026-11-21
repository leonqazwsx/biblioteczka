import test from 'node:test';
import assert from 'node:assert/strict';
import { image, loadSharp } from './helpers/cloudflare-images.mjs';
import { SPINE_CONFIG } from '../src/spine-provider.mjs';
const { createCloudflareProvider } = await import(
  '../services/spine-service/cloudflare-provider.mjs'
).catch(() => ({}));
const configModule = await import('../services/spine-service/provider-config.mjs').catch(
  () => ({}),
);
const options = {
  accountId: '0123456789abcdef0123456789abcdef',
  apiToken: 'test-only-cloudflare-private-token',
  freeConfirmed: true,
};
function create(extra = {}) {
  assert.equal(
    typeof createCloudflareProvider,
    'function',
    'Cloudflare adapter feature is present',
  );
  return createCloudflareProvider({ ...options, ...extra });
}
const refusal = (code, status = 429, headers = {}) =>
  Response.json(
    {
      success: false,
      result: null,
      errors: [{ code, message: 'private provider message' }],
      messages: [],
    },
    { status, headers },
  );
test('multipart sends only resized cover and fixed spine instructions to the pinned Cloudflare endpoint', async () => {
  let calls = 0;
  const output = () => image(),
    provider = create({
      fetchImpl: async (url, request) => {
        calls++;
        assert.equal(
          url,
          'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/black-forest-labs/flux-2-klein-4b',
        );
        assert.equal(request.method, 'POST');
        assert.equal(request.redirect, 'manual');
        assert.equal(request.headers.Authorization, 'Bearer ' + options.apiToken);
        const form = request.body;
        assert.deepEqual([...form.keys()].sort(), ['height', 'input_image_0', 'prompt', 'width']);
        assert.equal(form.get('width'), '512');
        assert.equal(form.get('height'), '1536');
        const { SPINE_PROMPT } = await import('../src/spine-provider.mjs');
        assert.equal(typeof SPINE_PROMPT, 'string');
        assert.equal(form.get('prompt'), SPINE_PROMPT);
        const file = form.get('input_image_0'),
          meta = await loadSharp()(Buffer.from(await file.arrayBuffer())).metadata();
        assert.equal(file.type, 'image/jpeg');
        assert.equal(meta.width, 480);
        assert.equal(meta.height, 360);
        assert.equal(meta.exif, undefined);
        return Response.json({
          success: true,
          result: { image: (await output()).toString('base64') },
          errors: [],
          messages: [],
        });
      },
    });
  const result = await provider.generate({
    coverBytes: await image({ width: 800, height: 600 }),
    coverMime: 'image/png',
  });
  assert.equal(calls, 1);
  assert.equal(result.mime, 'image/png');
  assert.equal(result.usage, null);
  assert.equal(provider.config.model, 'cf-flux-2-klein-4b');
});
test('Cloudflare result accepts structurally valid PNG JPEG and WebP bytes', async () => {
  create();
  for (const [format, mime] of [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ]) {
    const bytes = await image({ format }),
      provider = create({
        fetchImpl: async () =>
          Response.json({
            success: true,
            result: { image: bytes.toString('base64') },
            errors: [],
            messages: [],
          }),
      });
    const result = await provider.generate({ coverBytes: await image(), coverMime: 'image/png' });
    assert.equal(result.mime, mime);
    assert.deepEqual(result.bytes, bytes);
  }
});
test('Cloudflare configuration fails closed without explicit free confirmation or valid account credentials', () => {
  create();
  for (const extra of [
    { freeConfirmed: false },
    { accountId: '../../other-account' },
    { apiToken: 'bad\nkey' },
    { apiToken: '' },
    { accountId: '' },
  ])
    assert.throws(
      () => create(extra),
      (e) => e.code === 'SERVICE_CONFIG' && !e.message.includes(options.apiToken),
    );
});
test('confirmed quota capacity authorization and invalid input have distinct redacted outcomes', async () => {
  create();
  const cases = [
    [3036, 429, 'PROVIDER_QUOTA'],
    [4006, 429, 'PROVIDER_QUOTA'],
    [3040, 429, 'PROVIDER_CAPACITY'],
    [5035, 403, 'PROVIDER_AUTH'],
    [0, 401, 'PROVIDER_AUTH'],
    [5004, 400, 'AI_REJECTED'],
    [3003, 400, 'AI_REJECTED'],
    [3006, 413, 'AI_REJECTED'],
    [9999, 429, 'PROVIDER_UNCERTAIN'],
    [3007, 408, 'PROVIDER_UNCERTAIN'],
    [0, 500, 'PROVIDER_UNCERTAIN'],
  ];
  const coverBytes = await image();
  for (const [code, status, want] of cases) {
    const provider = create({ fetchImpl: async () => refusal(code, status) });
    await assert.rejects(
      () => provider.generate({ coverBytes, coverMime: 'image/png' }),
      (e) =>
        e.code === want &&
        !e.message.includes('private provider message') &&
        !e.message.includes(options.apiToken),
    );
  }
  await assert.rejects(
    () =>
      create({ fetchImpl: async () => new Response('not json', { status: 403 }) }).generate({
        coverBytes,
        coverMime: 'image/png',
      }),
    (e) => e.code === 'PROVIDER_AUTH',
  );
});
test('quota proof cannot be inferred from contradictory errors or a body carrying a result', async () => {
  create();
  const coverBytes = await image();
  for (const payload of [
    { success: false, result: null, errors: [{ code: 3036 }, { code: 9999 }] },
    { success: false, result: { image: 'anything' }, errors: [{ code: 3036 }] },
    { success: true, result: null, errors: [{ code: 3036 }] },
    { success: false, result: null, errors: [{ code: 4006 }, { code: 9999 }] },
    { success: false, result: { image: 'anything' }, errors: [{ code: 4006 }] },
    { success: true, result: null, errors: [{ code: 4006 }] },
  ])
    await assert.rejects(
      () =>
        create({ fetchImpl: async () => Response.json(payload, { status: 429 }) }).generate({
          coverBytes,
          coverMime: 'image/png',
        }),
      (e) => e.code === 'PROVIDER_UNCERTAIN',
    );
});
test('recognized refusal parses Retry-After seconds and HTTP-date without changing unknown errors into retries', async () => {
  create();
  const coverBytes = await image(),
    clock = () => new Date('2026-10-15T12:00:00.000Z');
  for (const [header, want] of [
    ['120', 120000],
    ['Thu, 15 Oct 2026 12:04:00 GMT', 240000],
    ['invalid', 0],
  ]) {
    await assert.rejects(
      () =>
        create({
          clock,
          fetchImpl: async () => refusal(3040, 429, { 'Retry-After': header }),
        }).generate({ coverBytes, coverMime: 'image/png' }),
      (e) => e.code === 'PROVIDER_CAPACITY' && e.retryAfterMs === want,
    );
  }
});
test('bad references never reach the provider and redirects are never followed', async () => {
  let calls = 0;
  const provider = create({
    fetchImpl: async () => {
      calls++;
      return new Response('', { status: 302, headers: { Location: 'https://example.com' } });
    },
  });
  await assert.rejects(
    () => provider.generate({ coverBytes: Buffer.from('corrupt'), coverMime: 'image/png' }),
    (e) => e.code === 'AI_REJECTED',
  );
  assert.equal(calls, 0);
  const coverBytes = await image();
  await assert.rejects(
    () => provider.generate({ coverBytes, coverMime: 'image/png' }),
    (e) => e.code === 'PROVIDER_UNCERTAIN',
  );
  assert.equal(calls, 1);
});
test('Cloudflare rejects oversized streams invalid base64 and malformed generated images', async () => {
  create();
  const coverBytes = await image();
  for (const fetchImpl of [
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(7 * 1024 * 1024 + 1));
            c.close();
          },
        }),
      ),
    async () => Response.json({ success: true, result: { image: 'bad!!!' } }),
    async () =>
      Response.json({
        success: true,
        result: { image: Buffer.from('not image').toString('base64') },
      }),
    async () =>
      Response.json({
        success: true,
        result: { image: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') },
      }),
  ])
    await assert.rejects(
      () => create({ fetchImpl }).generate({ coverBytes, coverMime: 'image/png' }),
      (e) => e.code === 'PROVIDER_UNCERTAIN',
    );
});
test('deadline bounds fetch and body readers even if transport ignores abort', async () => {
  create();
  const coverBytes = await image();
  for (const fetchImpl of [
    () => new Promise(() => {}),
    async () =>
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        }),
      ),
  ]) {
    const start = Date.now();
    await assert.rejects(
      () => create({ fetchImpl, timeoutMs: 40 }).generate({ coverBytes, coverMime: 'image/png' }),
      (e) => e.code === 'PROVIDER_UNCERTAIN',
    );
    assert.ok(Date.now() - start < 1500);
  }
});
test('configuration hash retains legacy values but changes when reference processing changes', () => {
  assert.equal(typeof configModule.providerConfigHash, 'function');
  assert.equal(typeof configModule.validateProviderConfig, 'function');
  const config = configModule.CLOUDFLARE_SPINE_CONFIG;
  assert.notEqual(
    configModule.providerConfigHash(config),
    configModule.providerConfigHash({ ...config, referenceVersion: 'sharp-400-jpeg-v2' }),
  );
  assert.deepEqual(configModule.validateProviderConfig(SPINE_CONFIG), SPINE_CONFIG);
  assert.throws(
    () => configModule.validateProviderConfig({ ...config, apiToken: options.apiToken }),
    (e) => e.code === 'SERVICE_CONFIG',
  );
});

test('unproven authentication bodies preserve uncertainty separately from the authorization pause', async () => {
  create();
  const coverBytes = await image();
  for (const fetchImpl of [
    async () => new Response('edge error', { status: 403 }),
    async () => Response.json({ success: true, result: null, errors: [] }, { status: 401 }),
    async () =>
      Response.json(
        { success: false, result: { image: 'possible-result' }, errors: [{ code: 5035 }] },
        { status: 403 },
      ),
  ])
    await assert.rejects(
      () => create({ fetchImpl }).generate({ coverBytes, coverMime: 'image/png' }),
      (e) => e.code === 'PROVIDER_AUTH' && e.uncertain === true,
    );
});
