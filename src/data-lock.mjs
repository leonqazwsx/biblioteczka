import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { problem } from './domain.mjs';
import { t } from '../public/shared/i18n.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const inUse = () =>
  problem(
    'DATA_IN_USE',
    t(
      'Ten folder danych jest już używany albo jego właściciela nie można bezpiecznie potwierdzić. Zamknij drugą Biblioteczkę i spróbuj ponownie.',
    ),
  );

// Each owner is published as a complete, nonempty directory. Removing only an
// immutable owner filename cannot erase a successor even if recovery races.
export async function acquireDataLock(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const directory = await fs.realpath(dataDir),
    lock = path.join(directory, '.bookshelf-data-lock');
  const token = crypto.randomUUID(),
    filename = 'owner-' + token + '.json',
    stage = path.join(directory, '.bookshelf-data-lock-stage-' + token);
  const owner = {
    version: 1,
    pid: process.pid,
    hostname: os.hostname(),
    token,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(stage);
  let acquired = false;
  try {
    await fs.writeFile(path.join(stage, filename), JSON.stringify(owner) + '\n', { flag: 'wx' });
    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        await fs.rename(stage, lock);
        acquired = true;
        break;
      } catch (error) {
        const stat = await fs.lstat(lock).catch((e) => {
          if (e.code === 'ENOENT') return null;
          throw e;
        });
        if (!stat) {
          if (['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) continue;
          throw error;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw inUse();
      }
      let names;
      try {
        names = await fs.readdir(lock);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw inUse();
      }
      if (names.length !== 1 || !/^owner-[0-9a-f-]+\.json$/.test(names[0])) throw inUse();
      const previousFile = path.join(lock, names[0]);
      let previous;
      try {
        const stat = await fs.lstat(previousFile);
        if (!stat.isFile() || stat.isSymbolicLink()) throw inUse();
        previous = JSON.parse(await fs.readFile(previousFile, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw inUse();
      }
      if (
        previous.version !== 1 ||
        !Number.isSafeInteger(previous.pid) ||
        previous.pid <= 0 ||
        previous.hostname !== os.hostname() ||
        typeof previous.token !== 'string' ||
        !uuid.test(previous.token) ||
        names[0] !== 'owner-' + previous.token + '.json'
      )
        throw inUse();
      try {
        process.kill(previous.pid, 0);
        throw inUse();
      } catch (error) {
        if (error.code !== 'ESRCH') throw inUse();
      }
      // Never use age as evidence of death (sleep, slow startup and PID reuse).
      try {
        await fs.unlink(previousFile);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      try {
        await fs.rmdir(lock);
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      }
    }
    if (!acquired) throw inUse();
  } finally {
    if (!acquired) await fs.rm(stage, { recursive: true, force: true });
  }
  let released = false;
  return {
    owner,
    async release() {
      if (released) return;
      const file = path.join(lock, filename);
      try {
        await fs.unlink(file);
      } catch (error) {
        if (error.code === 'ENOENT') {
          released = true;
          return;
        }
        throw error;
      }
      try {
        await fs.rmdir(lock);
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      }
      released = true;
    },
  };
}
