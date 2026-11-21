import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { problem } from './domain.mjs';

export async function assertSafePath(target, { directory = false, missing = false, f = fs } = {}) {
  const stat = await f.lstat(target).catch((error) => {
    if (missing && error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())))
    throw problem('UNSAFE_PATH', 'Niebezpieczna ścieżka danych.');
  return stat;
}

export async function ensureDirectory(target, f = fs) {
  await assertSafePath(target, { directory: true, missing: true, f });
  await f.mkdir(target, { recursive: true });
  await assertSafePath(target, { directory: true, f });
}

// Publish only complete bytes. Never follow an existing symlink or replace a directory.
export async function atomicWrite(target, bytes, f = fs) {
  await assertSafePath(path.dirname(target), { directory: true, f });
  await assertSafePath(target, { missing: true, f });
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    const file = await f.open(temp, 'wx');
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await f.rename(temp, target);
        break;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        await delay(40 * 2 ** attempt);
      }
    }
  } finally {
    await f.unlink(temp).catch(() => {});
  }
}

export function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
export const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const isHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const isIso = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
