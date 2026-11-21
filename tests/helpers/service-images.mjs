// A structurally valid PNG; the older unit fixture had an incorrect IDAT CRC.
const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64');
function crc(bytes) {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let n = 0; n < 8; n++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;} return (value ^ 0xffffffff) >>> 0;}
for (let offset = 8; offset < original.length;) {const length = original.readUInt32BE(offset); original.writeUInt32BE(crc(original.subarray(offset + 4, offset + 8 + length)), offset + 8 + length); offset += length + 12;}
export const png = original;
export function variant(value) {
  const bytes = Buffer.from('Fixture\0' + value), chunk = Buffer.alloc(bytes.length + 12);
  chunk.writeUInt32BE(bytes.length); chunk.write('tEXt', 4, 'ascii'); bytes.copy(chunk, 8); chunk.writeUInt32BE(crc(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
