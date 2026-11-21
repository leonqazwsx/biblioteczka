import { createRequire } from 'node:module';
const serviceRequire = createRequire(
  new URL('../../services/spine-service/package.json', import.meta.url),
);
export const loadSharp = () => serviceRequire('sharp');
export async function image({
  width = 20,
  height = 30,
  format = 'png',
  orientation,
  alpha = false,
} = {}) {
  const sharp = loadSharp();
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 30, g: 80, b: 120 },
    },
  });
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  return pipeline[format]().toBuffer();
}
