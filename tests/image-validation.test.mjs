import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageBytes } from '../src/image-validation.mjs';
import { png } from './helpers/images.mjs';
// Two solid 2×2 pixels encoded by Pillow; no external cover or paid provider.
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK7DkP/9k=',
  'base64',
);
const webp = Buffer.from(
  'UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAIAAUAmJQBOgCgAAP7u/58jsIbsOXXFzZDeAAA=',
  'base64',
);
test('valid PNG, JPEG and WebP pass; truncation, signature-only payloads and changed PNG data fail', () => {
  for (const [bytes, mime] of [
    [png, 'image/png'],
    [jpeg, 'image/jpeg'],
    [webp, 'image/webp'],
  ]) {
    assert.equal(validateImageBytes(bytes, mime), mime);
    for (const length of [9, bytes.length - 2])
      assert.throws(() => validateImageBytes(bytes.subarray(0, length), mime), { code: 'INVALID' });
  }
  const damaged = Buffer.from(png);
  damaged[45] ^= 1;
  assert.throws(() => validateImageBytes(damaged, 'image/png'), { code: 'INVALID' });
});
