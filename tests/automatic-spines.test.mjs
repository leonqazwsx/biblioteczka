import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {openCoverStore} from '../src/covers.mjs';
import {openSpineStore} from '../src/spine-assets.mjs';
import {openAutomaticSpineJournal} from '../src/automatic-spine-journal.mjs';
const {openAutomaticSpines} = await import('../src/automatic-spines.mjs').catch(() => ({}));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=', 'base64');
const result = {assetId: createHash('sha256').update(png).digest('hex'), mime: 'image/png', size: png.length, model: 'fixture', promptVersion: 'cover-motif-v1'};
const queued = id => ({id, state: 'queued', retryAt: null, errorCode: null, result: null});
async function setup(t, client, extra = {}) {
  assert.equal(typeof openAutomaticSpines, 'function');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automatic-spines-')); t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const store = await openStore(dataDir), covers = await openCoverStore(dataDir), spines = await openSpineStore(dataDir), {coverId} = await covers.put(png, 'image/png');
  const options = {dataDir, store, covers, spines, catalog: {search: async () => []}, client, ...extra};
  const jobs = await openAutomaticSpines(options); t.after(() => jobs.close());
  async function add(title, withCover = true) {return store.commit({type: 'addBook', draft: {title, authors: ['Author'], status: 'read', shelfId: 'other', coverId: withCover ? coverId : null}}, store.read().revision);}
  return {dataDir, store, covers, spines, coverId, options, jobs, add};
}

test('quota survives client restart and resumes original remote job without a second claim',async t=>{
  let submits=0,gets=0,date=new Date('2026-10-15T12:00:00.000Z');const id=randomUUID();
  const client={origin:'http://127.0.0.1:47842',submit:async()=>{submits++;return {...queued(id),retryAt:'2026-10-16T00:01:00.000Z',errorCode:'PROVIDER_QUOTA'};},get:async()=>{gets++;return {...queued(id),state:'ready',result};},download:async()=>({bytes:png,mime:'image/png'})};
  const a=await setup(t,client,{clock:()=>date});await a.add('Quota');await a.jobs.schedule();
  assert.equal(a.jobs.status().jobs[0].message,'Ilustracja czeka na odnowienie limitu');const before=JSON.parse(await fs.readFile(path.join(a.dataDir,'automatic-spines.json'))).entries[0];
  await a.jobs.close();const resumed=await openAutomaticSpines(a.options);t.after(()=>resumed.close());await resumed.schedule();assert.equal(submits,1);assert.equal(gets,0);assert.equal(resumed.status().jobs[0].message,'Ilustracja czeka na odnowienie limitu');
  date=new Date('2026-10-16T00:01:00.000Z');await resumed.schedule();assert.equal(submits,1);assert.equal(gets,1);assert.equal(a.store.read().books[0].spineGeneration,1);assert.equal(a.store.read().books[0].spine.assetId,result.assetId);
  const after=JSON.parse(await fs.readFile(path.join(a.dataDir,'automatic-spines.json'))).entries[0];assert.equal(after.requestId,before.requestId);assert.equal(after.remoteJobId,before.remoteJobId);assert.deepEqual(after.ticket,before.ticket);
});

test('manual spine chosen after quota remains current when late ready result arrives',async t=>{
  let date=new Date('2026-10-15T12:00:00.000Z'),started,finish;const start=new Promise(resolve=>started=resolve),id=randomUUID();
  const a=await setup(t,{origin:'http://127.0.0.1:47842',submit:async()=>({...queued(id),retryAt:'2026-10-16T00:01:00.000Z',errorCode:'PROVIDER_QUOTA'}),get:async()=>{started();return new Promise(resolve=>finish=()=>resolve({...queued(id),state:'ready',result}));},download:async()=>assert.fail('late result must not download')},{clock:()=>date});
  await a.add('Manual');await a.jobs.schedule();date=new Date('2026-10-16T00:01:00.000Z');const pending=a.jobs.schedule();await start;
  const book=a.store.read().books[0];await a.store.commit({type:'setBookSpine',id:book.id,spine:{assetId:'b'.repeat(64),kind:'manual',frame:{x:0.35,y:0.6,zoom:1.5}}},a.store.read().revision);const manual=a.store.read().books[0].spine;
  finish();await pending;assert.deepEqual(a.store.read().books[0].spine,manual);
});
test('one automatic submission, immediate local state, eventual image and offline persistence', async t => {
  let submits = 0, ready = false; const id = randomUUID();
  const client = {origin: 'http://127.0.0.1:47842', submit: async () => {submits++; return queued(id);}, get: async () => ready ? {...queued(id), state: 'ready', result} : queued(id), download: async () => ({bytes: png, mime: 'image/png'})};
  const a = await setup(t, client); await a.add('A'); assert.equal(a.store.read().books[0].spine, null);
  await a.jobs.schedule({newBookIds: [a.store.read().books[0].id]}); assert.equal(submits, 1); assert.equal(a.store.read().books[0].spineGeneration, 1);
  ready = true; await a.jobs.schedule(); assert.equal(submits, 1); assert.equal(a.store.read().books[0].spine.kind, 'ai');
  await a.jobs.close(); const local = await openAutomaticSpines({...a.options, client: null}); t.after(() => local.close()); assert.equal(local.status().connection, 'unconfigured'); assert.equal(a.store.read().books[0].spine.assetId, result.assetId);
});
for (const change of ['manual', 'cover', 'delete', 'collection', 'generation']) test(`old result is rejected after ${change}`, async t => {
  let finish, started; const start = new Promise(r => started = r), id = randomUUID();
  const a = await setup(t, {origin: 'http://127.0.0.1:47842', submit: async () => {started(); return new Promise(r => finish = () => r({...queued(id), state: 'ready', result}));}, download: async () => ({bytes: png, mime: 'image/png'})});
  await a.add('A'); const before = a.store.read(), b = before.books[0]; const pending = a.jobs.schedule(); await start;
  if (change === 'manual') await a.store.commit({type: 'setBookSpine', id: b.id, spine: {assetId: 'a'.repeat(64), kind: 'manual'}}, a.store.read().revision);
  if (change === 'cover') await a.store.commit({type: 'updateBook', id: b.id, patch: {coverId: 'b'.repeat(64)}}, a.store.read().revision);
  if (change === 'delete') await a.store.commit({type: 'deleteBook', id: b.id}, a.store.read().revision);
  if (change === 'collection') await a.store.replace(a.store.read(), a.store.read().revision);
  if (change === 'generation') await a.store.commit({type: 'setBookSpine', id: b.id, spine: null}, a.store.read().revision);
  finish(); await pending;
  assert.notEqual(a.store.read().books[0]?.spine?.assetId, result.assetId);
});
for (const claimed of [false, true]) test(`restart ${claimed ? 'after' : 'before'} claim uses original UUID and exactly one generation`, async t => {
  let request; const client = {origin: 'http://127.0.0.1:47842', submit: async input => {request = input; return queued(randomUUID());}};
  const a = await setup(t, client); await a.add('A'); await a.jobs.close(); const state = a.store.read(), b = state.books[0];
  const entry = {collectionId: state.collectionId, bookId: b.id, coverId: b.coverId, expectedGeneration: 0, requestId: randomUUID(), ticket: null, remoteJobId: null, origin: client.origin, phase: 'prepared', retryAt: null};
  const journal = await openAutomaticSpineJournal({dataDir: a.dataDir}); await journal.put(entry); await journal.close();
  if (claimed) await a.store.claimAutomaticSpine({collectionId: state.collectionId, bookId: b.id, coverId: b.coverId, expectedGeneration: 0});
  const resumed = await openAutomaticSpines(a.options); t.after(() => resumed.close()); await resumed.schedule();
  assert.equal(request.requestId, entry.requestId); assert.equal(a.store.read().books[0].spineGeneration, 1);
});
test('restart after lost POST retains UUID; offline close is bounded; current refs are protected', async t => {
  const ids = []; const a = await setup(t, {origin: 'http://127.0.0.1:47842', submit: async input => {ids.push(input.requestId); throw Object.assign(new Error('lost'), {code: 'SERVICE_OFFLINE'});}});
  await a.add('A'); await a.jobs.schedule(); assert.equal(a.jobs.status().connection, 'offline'); assert.equal(a.jobs.references().covers[0], a.coverId);
  await a.jobs.close(); let date = new Date(Date.now() + 10000); const resumed = await openAutomaticSpines({...a.options, clock: () => date}); t.after(() => resumed.close()); await resumed.schedule(); assert.deepEqual(ids, [ids[0], ids[0]]); assert.equal(a.store.read().books[0].spineGeneration, 1);
  await resumed.close(); let started; const start = new Promise(r => started = r);
  const hanging = await openAutomaticSpines({...a.options, clock: () => new Date(date.getTime() + 10000), client: {origin: 'http://127.0.0.1:47842', submit: async () => {started(); return new Promise(() => {});}}});
  hanging.schedule(); await start; await Promise.race([hanging.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('close hung')), 500))]);
});
test('new books precede backlog; terminal failure and cover miss never loop; metadata/crop never regenerate', async t => {
  const priorities = [], submitted = [], client = {origin: 'http://127.0.0.1:47842', submit: async input => {priorities.push(input.priority); submitted.push(input.requestId); return {...queued(randomUUID()), state: 'failed', errorCode: 'AI_REJECTED'};}};
  let lookups = 0; const a = await setup(t, client, {catalog: {search: async () => {lookups++; return [];}}}); await a.add('Old'); await a.add('New'); await a.add('Missing', false);
  await a.jobs.schedule({newBookIds: [a.store.read().books[1].id]}); assert.equal(priorities[0], 'interactive'); assert.equal(priorities[1], 'backfill'); await a.jobs.schedule(); assert.equal(submitted.length, 2); assert.equal(lookups, 1);
  await a.jobs.close(); const reopened = await openAutomaticSpines(a.options); t.after(() => reopened.close()); await reopened.schedule(); assert.equal(submitted.length, 2); assert.equal(lookups, 1);
});
for (const damage of ['missing', 'corrupt']) test(`downloaded restart retrieves ${damage} local result from its original remote job`, async t => {
  let gets = 0, downloads = 0, submits = 0, offline = true; const id = randomUUID();
  const a = await setup(t, {origin: 'http://127.0.0.1:47842', submit: async () => {submits++; return queued(id);},
    get: async input => {gets++; assert.equal(input.id, id); if (offline) throw Object.assign(new Error('offline'), {code: 'SERVICE_OFFLINE'}); return {...queued(id), state: 'ready', result};},
    download: async () => {downloads++; return {bytes: png, mime: 'image/png'};}});
  await a.add('Downloaded'); await a.jobs.close(); const state = a.store.read(), b = state.books[0], claimed = await a.store.claimAutomaticSpine({collectionId: state.collectionId, bookId: b.id, coverId: b.coverId, expectedGeneration: 0});
  const journal = await openAutomaticSpineJournal({dataDir: a.dataDir}), requestId = randomUUID();
  await journal.put({collectionId: state.collectionId, bookId: b.id, coverId: b.coverId, expectedGeneration: 0, ticket: claimed.ticket,
    requestId, remoteJobId: id, origin: a.options.client.origin, phase: 'downloaded', retryAt: null, state: 'ready', localAssetId: result.assetId, result}); await journal.close();
  if (damage === 'corrupt') await fs.writeFile(path.join(a.dataDir, 'spines', result.assetId), 'broken');
  let date = new Date(); const resumed = await openAutomaticSpines({...a.options, clock: () => date}); t.after(() => resumed.close()); await resumed.schedule();
  assert.equal(resumed.status().connection, 'offline'); assert.equal(submits, 0); offline = false; date = new Date(Date.now() + 10000); await resumed.schedule();
  assert.equal(downloads, 1); assert.ok(gets >= 2); assert.equal(submits, 0); assert.equal(a.store.read().books[0].spine.assetId, result.assetId); assert.equal(a.store.read().books[0].spineGeneration, 1);
});
