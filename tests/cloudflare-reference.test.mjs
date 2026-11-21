import test from 'node:test';
import assert from 'node:assert/strict';
import { image, loadSharp } from './helpers/cloudflare-images.mjs';
const { createCoverReference } = await import(
  '../services/spine-service/cover-reference.mjs'
).catch(() => ({}));
function ready() {
  assert.equal(typeof createCoverReference, 'function', 'reference thumbnail feature is present');
}
test('reference applies EXIF orientation before fitting inside 480 pixels', async () => {
  ready();
  const coverBytes = await image({ width: 800, height: 600, format: 'jpeg', orientation: 6 });
  const result = await createCoverReference({ coverBytes, coverMime: 'image/jpeg' }),
    meta = await loadSharp()(result.bytes).metadata();
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(meta.width, 360);
  assert.equal(meta.height, 480);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
});
test('reference does not enlarge tiny covers and flattens transparency to white', async () => {
  ready();
  const coverBytes = await image({ width: 24, height: 32, alpha: true });
  const result = await createCoverReference({ coverBytes, coverMime: 'image/png' }),
    sharp = loadSharp(),
    meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 24);
  assert.equal(meta.height, 32);
  assert.equal(meta.hasAlpha, false);
  const pixels = await sharp(result.bytes).raw().toBuffer();
  assert.ok([...pixels.subarray(0, 3)].every((v) => v >= 250));
});
test('reference rejects mislabeled corrupt oversized and excessive pixel input', async () => {
  ready();
  const valid = await image();
  for (const input of [
    { coverBytes: Buffer.from('not an image'), coverMime: 'image/png' },
    { coverBytes: valid, coverMime: 'image/jpeg' },
    { coverBytes: Buffer.alloc(5 * 1024 * 1024 + 1), coverMime: 'image/png' },
    { coverBytes: await image({ width: 4100, height: 4100 }), coverMime: 'image/png' },
  ])
    await assert.rejects(
      () => createCoverReference(input),
      (e) => e.code === 'AI_REJECTED',
    );
});
