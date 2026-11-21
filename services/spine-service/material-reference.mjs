import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateImageBytes } from '../../src/image-validation.mjs';
import { problem } from '../../src/domain.mjs';

export const MATERIAL_SHA256 = 'b494e96d36efb33378a45d85f0a99a621cedec773f4755702349cf4a2d78c5e2';
export function readMaterialReference(bytes) {
  try {
    bytes ??= readFileSync(new URL('./assets/bookcloth-neutral-v1.png', import.meta.url));
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > 5 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== MATERIAL_SHA256
    )
      throw new Error('MATERIAL_CHANGED');
    validateImageBytes(bytes, 'image/png');
    return { bytes: Buffer.from(bytes), mime: 'image/png' };
  } catch {
    throw problem('QUALITY_MATERIAL_CHANGED', 'Próbka materiału jest niedostępna lub zmieniona.');
  }
}
