import { t } from '../shared/i18n.mjs';
export function paletteFromImage(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 60;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 40, 60);
  const pixels = ctx.getImageData(0, 0, 40, 60).data,
    bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    const r = Math.round(pixels[i] / 32) * 32,
      g = Math.round(pixels[i + 1] / 32) * 32,
      b = Math.round(pixels[i + 2] / 32) * 32;
    const key = [r, g, b].map((x) => Math.min(255, x).toString(16).padStart(2, '0')).join('');
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  return [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((x) => '#' + x[0]);
}
export async function readCoverFile(file) {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error(t('Wybierz JPEG, PNG lub WebP do 10 MB.'));
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f1e9dc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.86);
    return { mime: 'image/jpeg', base64: data.split(',')[1], palette: paletteFromImage(canvas) };
  } finally {
    bitmap.close();
  }
}
export async function localPalette(coverId) {
  const image = new Image();
  image.src = '/covers/' + coverId;
  await image.decode();
  return paletteFromImage(image);
}
