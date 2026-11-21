import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function retryRename(from, to) {
  for (let n = 0; ; n++)
    try {
      return await fs.rename(from, to);
    } catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || n >= 50) throw e;
      await delay(100);
    }
}
const exists = async (file) => {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
const live = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
};
async function read(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    const folders = (await fs.readdir(path.dirname(file)))
      .filter((name) => /^\.bookshelf-(stage|previous)-/.test(name))
      .map((name) => path.join(path.dirname(file), name));
    if (path.basename(file) !== '.bookshelf-update.lock')
      throw new Error(
        'Nie można odczytać dziennika aktualizacji: ' +
          file +
          '. Nie przenoś ani nie usuwaj dziennika. Wymagane jest ręczne porównanie zachowanych folderów: ' +
          folders.join('; '),
      );
    throw new Error(
      'Nie można potwierdzić właściciela aktualizacji: ' +
        file +
        '. Zamknij wszystkie instalatory i procesy aktualizacji. Dopiero po potwierdzeniu ich zatrzymania przenieś starą blokadę do pliku .legacy (zachowaj kopię) i ponów instalator. Nie usuwaj dziennika ani folderów danych. Zachowano: ' +
        folders.join('; '),
    );
  }
}
async function recoveryGate(root) {
  if (process.platform !== 'win32') {
    const guard = path.join(root, '.bookshelf-update.recovery');
    let handle;
    try {
      handle = await fs.open(guard, 'wx');
    } catch (e) {
      if (e.code === 'EEXIST')
        throw new Error('Inna aktualizacja lub odzyskiwanie jeszcze trwa: ' + guard);
      throw e;
    }
    return async () => {
      await handle.close();
      await fs.unlink(guard);
    };
  }
  // The Windows kernel releases this mutex even if either updater/helper crashes.
  // This closes the stale-file reclamation race between two update processes.
  const name =
    'Local\\BiblioteczkaUpdate-' + createHash('sha256').update(root.toLowerCase()).digest('hex');
  const script =
    "$m=New-Object Threading.Mutex($false,'" +
    name +
    "');$owned=$false;try{try{$owned=$m.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true};if(-not $owned){exit 2};[Console]::WriteLine('READY');[Console]::Out.Flush();$null=[Console]::In.ReadLine()}finally{if($owned){$m.ReleaseMutex()};$m.Dispose()}";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let detail = '';
  child.stderr.on('data', (v) => (detail += v));
  const exited = new Promise((r) => child.once('exit', r));
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (v) => {
      output += v;
      if (output.includes('READY')) resolve();
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(
        new Error(
          'Inna aktualizacja jeszcze trwa lub mutex jest niedostępny: ' + code + ' ' + detail,
        ),
      ),
    );
  });
  return async () => {
    child.stdin.end();
    await exited;
  };
}
export async function acquireUpdate(root) {
  const lock = path.join(root, '.bookshelf-update.lock'),
    journal = path.join(root, '.bookshelf-update.json');
  const owner = { version: 1, pid: process.pid, hostname: os.hostname(), id: randomUUID() };
  const releaseGate = await recoveryGate(root);
  try {
    const previous = await read(lock);
    if (previous) {
      if (
        !Number.isSafeInteger(previous.pid) ||
        previous.pid <= 0 ||
        previous.hostname !== os.hostname() ||
        live(previous.pid)
      )
        throw new Error(
          'Inna aktualizacja jeszcze trwa lub nie można potwierdzić jej właściciela: ' + lock,
        );
      await fs.unlink(lock);
    }
    // Publish only complete, flushed owner metadata. A crash during staging leaves
    // no lock; the exclusive hard link also refuses a concurrently created legacy lock.
    const stagedOwner = path.join(root, '.bookshelf-update.owner-' + owner.id);
    try {
      const handle = await fs.open(stagedOwner, 'wx');
      try {
        await handle.writeFile(JSON.stringify(owner));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.link(stagedOwner, lock);
    } finally {
      await fs.rm(stagedOwner, { force: true });
    }
  } finally {
    await releaseGate();
  }
  return {
    id: owner.id,
    async pending() {
      return read(journal);
    },
    async record(transaction) {
      const temp = journal + '.' + owner.id + '.tmp';
      const h = await fs.open(temp, 'w');
      try {
        await h.writeFile(JSON.stringify({ ...transaction, version: 1 }));
        await h.sync();
      } finally {
        await h.close();
      }
      await retryRename(temp, journal);
    },
    async clear() {
      await fs.rm(journal, { force: true });
    },
    async release() {
      const current = await read(lock);
      if (current?.id === owner.id) await fs.unlink(lock);
    },
  };
}

export async function reconcileUpdate(
  transaction,
  { root, target, health, shutdown, safeTree, inside, requireInactiveGuardian },
) {
  if (!transaction) return;
  const tx = transaction;
  if (
    tx.version !== 1 ||
    !/^[-a-f0-9]{36}$/.test(tx.id) ||
    tx.target !== target ||
    !Number.isSafeInteger(tx.port) ||
    tx.port < 1 ||
    tx.port > 65535 ||
    !['preparing', 'moving', 'activating', 'activated', 'committed'].includes(tx.phase)
  )
    throw new Error('Nieprawidłowy dziennik aktualizacji. Zachowano foldery.');
  for (const [name, prefix] of [
    ['stage', '.bookshelf-stage-'],
    ['backup', '.bookshelf-previous-'],
  ]) {
    if (tx[name] !== path.join(root, prefix + tx.id))
      throw new Error('Nieprawidłowa ścieżka dziennika. Zachowano foldery.');
    await inside(root, tx[name]);
    if (await exists(tx[name])) await safeTree(tx[name]);
  }
  await inside(root, tx.previousRoot);
  if (await exists(target)) await safeTree(target);
  // A committed target is authoritative. Leave previous/staged data for explicit cleanup.
  if (tx.phase === 'committed' && (await exists(target))) return;
  if (tx.phase === 'committed' && !(await exists(tx.backup)))
    throw new Error(
      'Brakuje zainstalowanego folderu i poprzedniej kopii. Zachowano etap: ' + tx.stage,
    );
  if (await exists(tx.backup)) {
    const current = await health('http://127.0.0.1:' + tx.port);
    if (current) {
      if (current.installationId !== tx.installationId)
        throw new Error('Odzyskanie blokuje inna instalacja. Zachowano foldery.');
      await shutdown('http://127.0.0.1:' + tx.port, current.pid, target);
    }
    await requireInactiveGuardian(target);
    if (await exists(target)) {
      if (await exists(tx.stage))
        throw new Error(
          'Odzyskanie wymaga sprawdzenia dwóch zachowanych folderów: ' +
            target +
            ' oraz ' +
            tx.stage,
        );
      await retryRename(target, tx.stage);
    }
    await retryRename(tx.backup, target);
  } else if (tx.hadTarget && !(await exists(target)))
    throw new Error('Brakuje poprzedniego folderu. Zachowano etap: ' + tx.stage);
  if (!(await exists(target)) && tx.previousRoot !== target && (await exists(tx.previousRoot)))
    return { previousRoot: tx.previousRoot };
}
