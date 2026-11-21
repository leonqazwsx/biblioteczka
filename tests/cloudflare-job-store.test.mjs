import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {openJobStore} from '../services/spine-service/job-store.mjs';import {CLOUDFLARE_SPINE_CONFIG} from '../services/spine-service/provider-config.mjs';import {png,variant} from './helpers/service-images.mjs';
async function setup(t,extra={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'cf-store-'));let date=new Date('2026-10-15T12:00:00.000Z');
  const options={dataDir,config:CLOUDFLARE_SPINE_CONFIG,clock:()=>date,...extra};let store=await openJobStore(options);
  t.after(async()=>{await store.close();await fs.rm(dataDir,{recursive:true,force:true});});
  return {get store(){return store;},dataDir,options,date(value){date=new Date(value);},async reopen(){await store.close();store=await openJobStore(options);return store;},submit(n){return store.submit({installationId:'one',requestId:randomUUID(),mime:'image/png',bytes:variant(n),priority:'backfill'});},async snapshot(){return JSON.parse(await fs.readFile(path.join(dataDir,'jobs.json')));}};
}
test('new journal reserves unique attempts and counts repeated confirmed refusals toward ten UTC calls',async t=>{
  const a=await setup(t);assert.equal(typeof a.store.reserveAttempt,'function');const job=await a.submit('repeat');
  const ids=[];for(let i=0;i<10;i++){
    const attempt=await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});assert.ok(attempt);ids.push(attempt.attemptId);
    const view=await a.store.deferAttempt({workId:job.id,attemptId:attempt.attemptId,kind:'capacity'});assert.equal(view.id,job.id);assert.equal(view.state,'queued');
    a.date(a.store.work(job.id).retryAt);
  }
  assert.equal(new Set(ids).size,10);assert.equal(a.store.usage('2026-10-15').attempts,10);
  assert.equal(await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'}),null);
  assert.equal(a.store.nextWork().workId,null);assert.equal(a.store.nextWork().retryAt,'2026-10-16T00:00:00.000Z');
  const snapshot=await a.snapshot();assert.equal(snapshot.version,2);assert.equal(snapshot.attempts.length,10);assert.equal(snapshot.days['2026-10-15'].attemptIds.length,10);
});
test('quota gate covers other books and persists through restart and clock rollback',async t=>{
  const a=await setup(t);assert.equal(typeof a.store.deferAttempt,'function');const first=await a.submit(1),other=await a.submit(2);
  const {attemptId}=await a.store.reserveAttempt({workId:first.id,day:'2026-10-15'});
  const deferred=await a.store.deferAttempt({workId:first.id,attemptId,kind:'quota'});
  assert.equal(deferred.retryAt,'2026-10-16T00:01:00.000Z');assert.equal(a.store.get({installationId:'one',id:other.id}).retryAt,deferred.retryAt);
  assert.equal(a.store.get({installationId:'one',id:other.id}).errorCode,'PROVIDER_QUOTA');await a.reopen();
  assert.equal(a.store.nextWork().workId,null);a.date('2026-10-14T12:00:00.000Z');assert.equal(a.store.nextWork().workId,null);
  a.date('2026-10-16T00:00:59.999Z');assert.equal(a.store.nextWork().workId,null);
  a.date('2026-10-16T00:01:00.000Z');assert.equal(a.store.nextWork().workId,first.id);
  const retry=await a.store.reserveAttempt({workId:first.id,day:'2026-10-16'});assert.notEqual(retry.attemptId,attemptId);
});
test('capacity doubles its delay and honors longer Retry-After across restart',async t=>{
  const a=await setup(t);assert.equal(typeof a.store.deferAttempt,'function');const job=await a.submit(1);
  let attempt=await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});
  assert.equal((await a.store.deferAttempt({workId:job.id,...attempt,kind:'capacity'})).retryAt,'2026-10-15T12:00:01.000Z');
  a.date('2026-10-15T12:00:01.000Z');await a.reopen();attempt=await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});
  assert.equal((await a.store.deferAttempt({workId:job.id,...attempt,kind:'capacity',retryAfterMs:20000})).retryAt,'2026-10-15T12:00:21.000Z');
  await a.store.prune(new Date('2026-11-01'));assert.ok(await fs.stat(a.store.work(job.id).coverPath));
});
test('crash before refusal commit recovers uncertain and cannot reserve again',async t=>{
  let failing=false;const adapter={...fs,rename:async(from,to)=>{if(failing&&to.endsWith('jobs.json'))throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return fs.rename(from,to);}};
  const a=await setup(t,{fsAdapter:adapter});assert.equal(typeof a.store.deferAttempt,'function');const job=await a.submit(1),attempt=await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});
  failing=true;await assert.rejects(a.store.deferAttempt({workId:job.id,...attempt,kind:'quota'}),{code:'ENOSPC'});failing=false;await a.reopen();
  assert.equal(a.store.work(job.id).state,'uncertain');assert.equal(await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'}),null);assert.equal(a.store.usage('2026-10-15').attempts,1);
});
test('stale refusal and direct transition cannot bypass an atomic reservation',async t=>{
  const a=await setup(t);assert.equal(typeof a.store.reserveAttempt,'function');const job=await a.submit(1);
  await assert.rejects(a.store.transition(job.id,{state:'generating'}),{code:'CONFLICT'});
  const attempt=await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});
  await assert.rejects(a.store.deferAttempt({workId:job.id,attemptId:randomUUID(),kind:'quota'}),{code:'CONFLICT'});
  await assert.rejects(a.store.complete({workId:job.id,attemptId:randomUUID(),bytes:png,mime:'image/png'}),{code:'CONFLICT'});
  await a.store.complete({workId:job.id,...attempt,bytes:png,mime:'image/png'});
  await assert.rejects(a.store.deferAttempt({workId:job.id,...attempt,kind:'capacity'}),{code:'CONFLICT'});
});
test('v1 migration preserves ready assets bindings config hashes budget and uncertain work with exact backup',async t=>{
  const a=await setup(t);await a.store.close();const fixture=path.resolve('tests/fixtures/spine-service-v1');
  await fs.cp(fixture,a.dataDir,{recursive:true});const beforeBytes=await fs.readFile(path.join(a.dataDir,'jobs.json')),before=JSON.parse(beforeBytes);
  await a.reopen();const after=await a.snapshot();assert.equal(after.version,2);assert.deepEqual(after.requests,before.requests);assert.equal(after.lastDay,'2026-10-14');assert.equal(a.store.usage('2026-10-14').attempts,3);
  for(const work of before.works){const migrated=a.store.work(work.workId);assert.equal(migrated.configHash,work.configHash);assert.deepEqual(migrated.result,work.result);assert.equal(migrated.state,work.state==='generating'?'uncertain':work.state);}
  assert.deepEqual(await fs.readFile(path.join(a.dataDir,'jobs.v1.backup.json')),beforeBytes);
  const ready=before.works.find(w=>w.state==='ready');assert.deepEqual((await a.store.readResult({installationId:'legacy',id:ready.workId})).bytes,png);
  assert.equal(await a.store.reserveAttempt({workId:before.works.find(w=>w.state==='uncertain').workId,day:'2026-10-15'}),null);
  await a.reopen();assert.deepEqual(await fs.readFile(path.join(a.dataDir,'jobs.v1.backup.json')),beforeBytes);
});
test('migration refuses a different preexisting backup without modifying the v1 journal',async t=>{
  const a=await setup(t);await a.store.close();await fs.cp(path.resolve('tests/fixtures/spine-service-v1'),a.dataDir,{recursive:true});
  const file=path.join(a.dataDir,'jobs.json'),before=await fs.readFile(file);await fs.writeFile(path.join(a.dataDir,'jobs.v1.backup.json'),'wrong backup');
  await assert.rejects(openJobStore(a.options),{code:'CORRUPT_STORE'});assert.deepEqual(await fs.readFile(file),before);
});
test('corrupt attempt linkage counters and unknown config shape fail closed and preserve bytes',async t=>{
  const a=await setup(t);assert.equal(typeof a.store.reserveAttempt,'function');const job=await a.submit(1);await a.store.reserveAttempt({workId:job.id,day:'2026-10-15'});await a.store.close();
  const file=path.join(a.dataDir,'jobs.json'),snapshot=JSON.parse(await fs.readFile(file));
  for(const mutate of [value=>value.days['2026-10-15'].attempts++,value=>value.days['2026-10-15'].attemptIds[0]=randomUUID(),value=>value.works[0].config.apiToken='not accepted',value=>value.attempts.push({...value.attempts[0]}),value=>value.providerPause={kind:'quota',retryAt:null}]){
    const corrupt=structuredClone(snapshot);mutate(corrupt);const bytes=JSON.stringify(corrupt);await fs.writeFile(file,bytes);
    await assert.rejects(openJobStore(a.options),{code:'CORRUPT_STORE'});assert.equal(await fs.readFile(file,'utf8'),bytes);
  }
});
