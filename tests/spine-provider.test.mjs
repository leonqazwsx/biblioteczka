import test from 'node:test';
import assert from 'node:assert/strict';
const { createSpineProvider } = await import('../src/spine-provider.mjs').catch(() => ({}));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=',
  'base64',
);
test('cover reference is sent once with pinned image parameters and usage is normalized', async () => {
  assert.equal(typeof createSpineProvider, 'function');
  let calls = 0;
  const p = createSpineProvider({
    apiKey: 'test-only-key',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/images/edits');
      assert.equal(options.method, 'POST');
      const f = options.body;
      assert.equal(f.get('model'), 'gpt-image-2.5-flare-2026-09-08');
      assert.equal(f.get('quality'), 'medium');
      assert.equal(f.get('size'), '1024x1536');
      assert.equal(f.get('output_format'), 'webp');
      assert.equal(f.get('output_compression'), '80');
      assert.equal(f.get('n'), '1');
      assert.deepEqual(Buffer.from(await f.get('image[]').arrayBuffer()), png);
      return Response.json({
        created: 0,
        output_format: 'png',
        data: [{ b64_json: png.toString('base64') }],
        usage: {
          input_tokens: 200,
          input_tokens_details: { text_tokens: 100, image_tokens: 100 },
          output_tokens: 300,
          total_tokens: 500,
        },
      });
    },
  });
  const result = await p.generate({ coverBytes: png, coverMime: 'image/png' });
  assert.deepEqual(result.bytes, png);
  assert.deepEqual(result.usage, { textInput: 100, imageInput: 100, imageOutput: 300 });
  assert.equal(calls, 1);
});
test('provider errors are redacted and never retried', async () => {
  assert.equal(typeof createSpineProvider, 'function');
  let calls = 0;
  const p = createSpineProvider({
    apiKey: 'test-secret',
    fetchImpl: async () => {
      calls++;
      return Response.json({ error: { message: 'test-secret private data' } }, { status: 429 });
    },
  });
  await assert.rejects(
    () => p.generate({ coverBytes: png, coverMime: 'image/png' }),
    (e) => e.code === 'AI_UNAVAILABLE' && !e.message.includes('test-secret'),
  );
  assert.equal(calls, 1);
  assert.equal(createSpineProvider({}).available, false);
});
test('invalid payload and absent accounting cannot be presented as a usable priced image', async () => {
  assert.equal(typeof createSpineProvider, 'function');
  const p = createSpineProvider({
    apiKey: 'fake',
    fetchImpl: async () => Response.json({ data: [{ b64_json: 'bad!!!!' }] }),
  });
  await assert.rejects(
    () => p.generate({ coverBytes: png, coverMime: 'image/png' }),
    (e) => e.code === 'INVALID',
  );
  const good = createSpineProvider({
    apiKey: 'fake',
    fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }),
  });
  assert.equal((await good.generate({ coverBytes: png, coverMime: 'image/png' })).usage, null);
});
