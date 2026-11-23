import { inflateSync } from 'node:zlib';
import { imageMime } from './covers.mjs';
import { problem } from './domain.mjs';
import { t } from '../public/shared/i18n.mjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const invalid = () => {
  throw problem('INVALID', t('Nieprawidłowa struktura obrazu.'));
};
function dimensions(width, height) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) invalid();
}

function png(bytes) {
  let offset = 8,
    header,
    ended = false,
    seenData = false,
    dataEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset),
      end = offset + length + 12;
    if (end > bytes.length) invalid();
    const type = bytes.toString('latin1', offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      crc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      invalid();
    if (!header && (type !== 'IHDR' || length !== 13)) invalid();
    if (type === 'IHDR') {
      if (header) invalid();
      header = data;
      dimensions(data.readUInt32BE(0), data.readUInt32BE(4));
      if (data[10] !== 0 || data[11] !== 0 || data[12] > 1) invalid();
      const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowed[data[9]]?.includes(data[8])) invalid();
    } else if (type === 'IDAT') {
      if (dataEnded) invalid();
      seenData = true;
      compressed.push(data);
    } else {
      if (seenData) dataEnded = true;
      if (type === 'IEND') {
        if (length !== 0 || !seenData || end !== bytes.length) invalid();
        ended = true;
      } else if (type[0] === type[0].toUpperCase() && type !== 'PLTE') invalid();
      if (type === 'PLTE' && (seenData || !length || length > 768 || length % 3)) invalid();
    }
    offset = end;
  }
  if (!ended) invalid();
  const width = header.readUInt32BE(0),
    height = header.readUInt32BE(4),
    channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header[9]],
    bits = header[8] * channels;
  const passes = header[12]
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const rows = [];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const stride = 1 + Math.ceil((w * bits) / 8);
    rows.push([stride, h]);
    expected += stride * h;
  }
  if (expected > 64 * 1024 * 1024) invalid();
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch {
    invalid();
  }
  if (decoded.length !== expected) invalid();
  let row = 0;
  for (const [stride, count] of rows)
    for (let n = 0; n < count; n++) {
      if (decoded[row] > 4) invalid();
      row += stride;
    }
}
function jpeg(bytes) {
  let offset = 2,
    hasFrame = false,
    hasScan = false,
    scanBytes = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) invalid();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (!hasFrame || !hasScan || !scanBytes || offset !== bytes.length) invalid();
      return;
    }
    if (marker === 0 || marker === 216 || marker === undefined || (marker >= 208 && marker <= 215))
      invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    if ([192, 193, 194].includes(marker)) {
      if (
        length < 8 ||
        bytes[offset + 2] !== 8 ||
        ![1, 3, 4].includes(bytes[offset + 7]) ||
        length !== 8 + 3 * bytes[offset + 7]
      )
        invalid();
      dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      hasFrame = true;
    }
    offset = end;
    if (marker === 218) {
      if (!hasFrame || length < 6) invalid();
      hasScan = true;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          scanBytes++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 208 && next <= 215)) {
          offset += 2;
          scanBytes++;
          continue;
        }
        if (next === 255) {
          offset++;
          continue;
        }
        break;
      }
    }
  }
  invalid();
}
function webp(bytes) {
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let offset = 12,
    hasImage = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = bytes.toString('latin1', offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4),
      end = offset + 8 + length;
    if (end + (length & 1) > bytes.length) invalid();
    const data = bytes.subarray(offset + 8, end);
    if (type === 'VP8 ') {
      if (
        hasImage ||
        length <= 10 ||
        data[0] & 1 ||
        !data.subarray(3, 6).equals(Buffer.from([157, 1, 42]))
      )
        invalid();
      const partition = (data[0] | (data[1] << 8) | (data[2] << 16)) >>> 5;
      if (partition < 7 || partition > length - 3) invalid();
      dimensions(data.readUInt16LE(6) & 16383, data.readUInt16LE(8) & 16383);
      hasImage = true;
    } else if (type === 'VP8L') {
      if (hasImage || length <= 5 || data[0] !== 47 || data.readUInt32LE(1) >>> 29) invalid();
      const word = data.readUInt32LE(1);
      dimensions((word & 16383) + 1, ((word >>> 14) & 16383) + 1);
      hasImage = true;
    } else if (type === 'VP8X') {
      if (length !== 10 || data[0] & 2) invalid();
      dimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
    } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(type)) invalid();
    offset = end + (length & 1);
  }
  if (!hasImage || offset !== bytes.length) invalid();
}
export function validateImageBytes(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 5 * 1024 * 1024 || imageMime(bytes) !== mime)
    invalid();
  try {
    if (mime === 'image/png') png(bytes);
    else if (mime === 'image/jpeg') jpeg(bytes);
    else if (mime === 'image/webp') webp(bytes);
    else invalid();
  } catch (error) {
    if (error.code === 'INVALID') throw error;
    invalid();
  }
  return mime;
}
