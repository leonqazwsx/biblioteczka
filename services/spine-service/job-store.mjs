import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {acquireDataLock} from '../../src/data-lock.mjs';
import {imageMime} from '../../src/covers.mjs';
import {problem} from '../../src/domain.mjs';
import {SPINE_CONFIG} from '../../src/spine-provider.mjs';
import {validateImageBytes} from '../../src/image-validation.mjs';
import {validateProviderConfig,providerConfigHash} from './provider-config.mjs';
import {validateJobSnapshot as validate,migrateJobSnapshotV1} from './job-schema.mjs';
import {assertSafePath, ensureDirectory, atomicWrite, exactKeys, isUuid, isHash, isIso, imageTypes} from '../../src/durable-files.mjs';

const states = ['queued', 'generating', 'ready', 'failed', 'uncertain'];
const priorities = ['interactive', 'backfill'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const configHash = providerConfigHash;
const validInstallation = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
function checkImage(bytes, mime) {
  if (!Buffer.isBuffer(bytes)) throw problem('INVALID', 'Obraz musi zawierać bajty.');
  if (bytes.length > 5 * 1024 * 1024) throw problem('TOO_LARGE', 'Obraz przekracza 5 MB.');
  if (!imageTypes.includes(mime)) throw problem('INVALID', 'Nieprawidłowy format obrazu.');
  validateImageBytes(bytes, mime);
}
export async function openJobStore({dataDir, config = SPINE_CONFIG, clock = () => new Date(), fsAdapter = fs, maxQueued = 10000}) {
  config = Object.freeze(structuredClone(validateProviderConfig(config)));
  const f = fsAdapter;
  await ensureDirectory(dataDir, f);
  const lock = await acquireDataLock(dataDir);
  try {
    const coversDir = path.join(dataDir, 'covers'), resultsDir = path.join(dataDir, 'results'), journal = path.join(dataDir, 'jobs.json');
    await ensureDirectory(coversDir, f); await ensureDirectory(resultsDir, f);
    let snapshot;
    const stat = await assertSafePath(journal, {missing: true, f});
    if (stat) {
      if (stat.size > 64 * 1024 * 1024) throw problem('CORRUPT_STORE', 'Dziennik usługi jest zbyt duży.');
      try {snapshot = validate(JSON.parse(await f.readFile(journal, 'utf8')));}
      catch (error) {if (error.code === 'CORRUPT_STORE') throw error; throw problem('CORRUPT_STORE', 'Nie można odczytać dziennika usługi.');}
      if (snapshot.version === 1) {
        const original = await f.readFile(journal), backup = path.join(dataDir, 'jobs.v1.backup.json');
        if (await assertSafePath(backup, {missing: true, f})) {
          if (!(await f.readFile(backup)).equals(original)) throw problem('CORRUPT_STORE', 'Kopia dziennika wymaga sprawdzenia operatora.');
        } else await atomicWrite(backup, original, f);
        if (!(await f.readFile(backup)).equals(original)) throw problem('CORRUPT_STORE', 'Nie udało się potwierdzić kopii dziennika.');
        const migrated = migrateJobSnapshotV1(snapshot, {now: clock()});
        await atomicWrite(journal, JSON.stringify(migrated), f); snapshot = migrated;
      }
    } else {
      snapshot = {version: 2, works: [], requests: [], days: {}, lastDay: null, attempts: [], providerPause: null, capacityFailures: 0};
      await atomicWrite(journal, JSON.stringify(snapshot), f);
    }
    // Only a published ready snapshot proves success. An orphan output file does not.
    if (snapshot.works.some(work => work.state === 'generating')) {
      const recovered = structuredClone(snapshot);
      for (const work of recovered.works) if (work.state === 'generating') {
        Object.assign(work, {state: 'uncertain', errorCode: 'INTERRUPTED', retryAt: null, updatedAt: clock().toISOString()});
        const attempt = recovered.attempts.findLast(attempt => attempt.workId === work.workId);
        if (attempt?.state === 'started') Object.assign(attempt, {state: 'uncertain', resolvedAt: clock().toISOString()});
      }
      await atomicWrite(journal, JSON.stringify(validate(recovered)), f); snapshot = recovered;
    }
    let queue = Promise.resolve(), closed = false;
    const now = () => clock().toISOString();
    const run = action => {
      if (closed) return Promise.reject(problem('CLOSED', 'Usługa jest zamknięta.'));
      const next = queue.then(action); queue = next.catch(() => {}); return next;
    };
    async function save(next) {validate(next); await atomicWrite(journal, JSON.stringify(next), f); snapshot = next;}
    const latest = (value, id) => value.attempts.findLast(attempt => attempt.workId === id);
    const day = () => clock().toISOString().slice(0, 10);
    const nextBudgetAt = () => new Date(Date.parse((snapshot.lastDay && snapshot.lastDay > day() ? snapshot.lastDay : day()) + 'T00:00:00Z') + 86400000).toISOString();
    const budgetBlocked = (limit = 10) => (snapshot.lastDay && day() < snapshot.lastDay) || (snapshot.days[day()]?.attempts ?? 0) >= limit;
    function gate() {
      const pause = snapshot.providerPause;
      if (pause?.kind === 'authorization') return {blocked: true, retryAt: null, errorCode: 'PROVIDER_AUTH'};
      let at = pause?.retryAt && Date.parse(pause.retryAt) > clock().getTime() ? pause.retryAt : null;
      let errorCode = at ? (pause.kind === 'quota' ? 'PROVIDER_QUOTA' : 'PROVIDER_CAPACITY') : null;
      if (budgetBlocked()) {const budgetAt = nextBudgetAt(); if (!at || budgetAt > at) at = budgetAt; errorCode ??= 'LOCAL_BUDGET';}
      return {blocked: !!at, retryAt: at, errorCode};
    }
    const view = work => {
      const blocked = work.state === 'queued' ? gate() : null;
      const retryAt = blocked?.blocked ? (blocked.retryAt === null ? null : [work.retryAt, blocked.retryAt].filter(Boolean).sort().at(-1)) : work.retryAt;
      return {id: work.workId, state: work.state, retryAt, errorCode: blocked?.blocked ? blocked.errorCode : work.errorCode, result: structuredClone(work.result)};
    };
    const internal = id => {
      const work = snapshot.works.find(work => work.workId === id);
      if (!work) throw problem('NOT_FOUND', 'Nie znaleziono zadania.'); return work;
    };
    function authorized({installationId, id}) {
      if (!snapshot.requests.some(request => request.installationId === installationId && request.workId === id))
        throw problem('NOT_FOUND', 'Nie znaleziono zadania.');
      return internal(id);
    }
    async function writeAsset(directory, bytes) {
      const id = hash(bytes), target = path.join(directory, id);
      await assertSafePath(target, {missing: true, f});
      let existing = await f.readFile(target).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
      if (!existing || hash(existing) !== id) await atomicWrite(target, bytes, f);
      existing = await f.readFile(target);
      if (hash(existing) !== id) throw problem('INVALID_IMAGE', 'Obraz nie przeszedł kontroli zapisu.');
      return id;
    }
    return {
      submit(input) {return run(async () => {
        if (!exactKeys(input, ['installationId', 'requestId', 'mime', 'bytes', 'priority']) ||
            !validInstallation(input.installationId) || !isUuid(input.requestId) || !priorities.includes(input.priority))
          throw problem('INVALID', 'Nieprawidłowe zgłoszenie.');
        checkImage(input.bytes, input.mime);
        const coverHash = hash(input.bytes), signature = configHash(config);
        const previous = snapshot.requests.find(request => request.installationId === input.installationId && request.requestId === input.requestId);
        if (previous) {
          const work = internal(previous.workId);
          // A retry across a service configuration upgrade still refers to the original work.
          if (work.coverHash !== coverHash || work.coverMime !== input.mime) throw problem('CONFLICT', 'Identyfikator zgłoszenia ma inne dane.');
          return view(work);
        }
        const next = structuredClone(snapshot);
        let work = next.works.find(work => work.coverHash === coverHash && work.configHash === signature);
        if (!work) {
          if (next.works.filter(work => ['queued', 'generating'].includes(work.state)).length >= maxQueued)
            throw problem('QUEUE_FULL', 'Kolejka jest pełna.');
          await writeAsset(coversDir, input.bytes);
          work = {workId: randomUUID(), coverHash, coverMime: input.mime, configHash: signature, config: structuredClone(config),
            priority: input.priority, state: 'queued', createdAt: now(), updatedAt: now(), retryAt: null, errorCode: null, result: null};
          next.works.push(work);
        } else if (input.priority === 'interactive' && work.state === 'queued') work.priority = 'interactive';
        next.requests.push({installationId: input.installationId, requestId: input.requestId, workId: work.workId});
        await save(next); return view(work);
      });},
      get(input) {return view(authorized(input));},
      work(id) {const work = internal(id); return {...structuredClone(work), coverPath: path.join(coversDir, work.coverHash)};},
      queued() {return snapshot.works.filter(work => work.state === 'queued').sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority) || a.createdAt.localeCompare(b.createdAt)).map(work => this.work(work.workId));},
      usage(day) {return {attempts: snapshot.days[day]?.attempts ?? 0};},
      reserveAttempt({workId, day: attemptDay, limit = 10}) {return run(async () => {
        if (attemptDay !== day() || !Number.isSafeInteger(limit) || limit < 1 || limit > 10)
          throw problem('INVALID', 'Nieprawidłowy limit lub dzień próby.');
        const current = internal(workId), previous = latest(snapshot, workId);
        if (current.state !== 'queued' || (previous && previous.state !== 'refused') || (current.retryAt && Date.parse(current.retryAt) > clock().getTime()) || gate().blocked || budgetBlocked(limit)) return null;
        const next = structuredClone(snapshot), work = next.works.find(work => work.workId === workId);
        const attemptId = randomUUID(); next.lastDay = attemptDay; next.days[attemptDay] ??= {attempts: 0, attemptIds: []};
        next.days[attemptDay].attempts++; next.days[attemptDay].attemptIds.push(attemptId);
        next.attempts.push({attemptId, workId, day: attemptDay, state: 'started', reason: null, createdAt: now(), resolvedAt: null});
        if (next.providerPause?.kind !== 'authorization') next.providerPause = null;
        Object.assign(work, {state: 'generating', updatedAt: now(), retryAt: null, errorCode: null});
        await save(next); return {attemptId};
      });},
      async beginAttempt(args) {return !!await this.reserveAttempt(args);},
      nextBudgetAt,
      nextWork() {
        const works = this.queued(); if (!works.length) return {workId: null, retryAt: null};
        const paused = gate(); if (paused.blocked) return {workId: null, retryAt: paused.retryAt};
        const work = works.find(work => !work.retryAt || Date.parse(work.retryAt) <= clock().getTime());
        return work ? {workId: work.workId, retryAt: null} : {workId: null, retryAt: works.map(work => work.retryAt).sort()[0]};
      },
      deferAttempt({workId, attemptId, kind, retryAfterMs = 0, uncertain = false}) {return run(async () => {
        if (!['quota', 'capacity', 'authorization'].includes(kind) || !Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86400000 * 365 || typeof uncertain !== 'boolean' || (uncertain && kind !== 'authorization')) throw problem('INVALID', 'Nieprawidłowe odroczenie próby.');
        const current = internal(workId), attempt = latest(snapshot, workId);
        if (current.state !== 'generating' || attempt?.state !== 'started' || attempt.attemptId !== attemptId) throw problem('CONFLICT', 'Próba nie jest wykonywana.');
        const next = structuredClone(snapshot), work = next.works.find(work => work.workId === workId), record = latest(next, workId);
        next.capacityFailures = kind === 'capacity' ? Math.min(Number.MAX_SAFE_INTEGER, next.capacityFailures + 1) : 0;
        const wait = kind === 'quota' ? Date.parse(nextBudgetAt()) + 60000 : clock().getTime() + Math.min(300000, 1000 * 2 ** Math.min(20, next.capacityFailures - 1));
        const retryAt = kind === 'authorization' ? null : new Date(Math.max(wait, clock().getTime() + retryAfterMs)).toISOString();
        Object.assign(record, {state: uncertain ? 'uncertain' : 'refused', reason: uncertain ? null : kind, resolvedAt: now()});
        next.providerPause = {kind, retryAt};
        Object.assign(work, {state: uncertain ? 'uncertain' : 'queued', errorCode: kind === 'quota' ? 'PROVIDER_QUOTA' : kind === 'capacity' ? 'PROVIDER_CAPACITY' : 'PROVIDER_AUTH', retryAt, updatedAt: now()});
        await save(next); return view(work);
      });},
      resumeAuthorization() {return run(async () => {
        if (snapshot.providerPause?.kind !== 'authorization') throw problem('CONFLICT', 'Połączenie nie wymaga odblokowania.');
        const next = structuredClone(snapshot); next.providerPause = null; await save(next);
      });},
      transition(workId, patch) {return run(async () => {
        if (!patch || Object.keys(patch).some(key => !['state', 'retryAt', 'errorCode'].includes(key)) || patch.state === 'ready') throw problem('INVALID', 'Nieprawidłowa zmiana zadania.');
        if (patch.state === 'generating') throw problem('CONFLICT', 'Próba wymaga atomowej rezerwacji.');
        internal(workId); const next = structuredClone(snapshot), work = next.works.find(work => work.workId === workId);
        if (['ready', 'failed'].includes(work.state)) throw problem('CONFLICT', 'Zadanie jest zakończone.');
        if (work.state === 'uncertain' && patch.state && patch.state !== 'failed') throw problem('CONFLICT', 'Niepewnej próby nie można powtórzyć.');
        if (work.state === 'generating' && patch.state === 'queued') throw problem('CONFLICT', 'Rozpoczętej próby nie można powtórzyć.');
        Object.assign(work, patch, {updatedAt: now()});
        const attempt = latest(next, workId);
        if (attempt?.state === 'started' && ['failed', 'uncertain'].includes(work.state)) Object.assign(attempt, {state: work.state, resolvedAt: now()});
        await save(next); return view(work);
      });},
      complete({workId, bytes, mime, attemptId}) {return run(async () => {
        const current = internal(workId);
        const attempt = latest(snapshot, workId);
        if (current.state !== 'generating' || attempt?.state !== 'started' || (attemptId !== undefined && attempt.attemptId !== attemptId)) throw problem('CONFLICT', 'Zadanie nie jest wykonywane.');
        checkImage(bytes, mime); const assetId = await writeAsset(resultsDir, bytes), next = structuredClone(snapshot);
        const work = next.works.find(work => work.workId === workId);
        Object.assign(work, {state: 'ready', updatedAt: now(), retryAt: null, errorCode: null,
          result: {assetId, mime, size: bytes.length, model: work.config.model, promptVersion: work.config.promptVersion}});
        Object.assign(latest(next, workId), {state: 'ready', resolvedAt: now()}); next.capacityFailures = 0;
        await save(next); return view(work);
      });},
      async readCover(workId) {
        const work = internal(workId), target = path.join(coversDir, work.coverHash);
        const stat = await assertSafePath(target, {f});
        if (stat.size > 5 * 1024 * 1024) throw problem('INVALID_IMAGE', 'Uszkodzona okładka.');
        const bytes = await f.readFile(target); checkImage(bytes, work.coverMime);
        if (hash(bytes) !== work.coverHash) throw problem('INVALID_IMAGE', 'Uszkodzona okładka.');
        return {bytes, mime: work.coverMime};
      },
      async readResult(input) {
        const {state, result} = authorized(input);
        if (state !== 'ready') throw problem('NOT_READY', 'Obraz nie jest gotowy.');
        const target = path.join(resultsDir, result.assetId), stat = await assertSafePath(target, {f});
        if (stat.size !== result.size) throw problem('INVALID_IMAGE', 'Uszkodzony wynik.');
        const bytes = await f.readFile(target);
        if (hash(bytes) !== result.assetId || imageMime(bytes) !== result.mime) throw problem('INVALID_IMAGE', 'Uszkodzony wynik.');
        return {bytes, mime: result.mime};
      },
      prune(date = clock()) {return run(async () => {
        const keep = new Set(snapshot.works.filter(work => ['queued', 'generating'].includes(work.state) ||
          (work.state === 'uncertain' && date - new Date(work.updatedAt) < 7 * 86400000)).map(work => work.coverHash));
        for (const work of snapshot.works) if (!keep.has(work.coverHash)) {
          const target = path.join(coversDir, work.coverHash);
          if (await assertSafePath(target, {missing: true, f})) await f.unlink(target);
        }
      });},
      async close() {if (closed) return; closed = true; await queue; await lock.release();}
    };
  } catch (error) {await lock.release(); throw error;}
}
