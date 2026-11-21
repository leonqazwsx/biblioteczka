import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {openJobStore} from '../services/spine-service/job-store.mjs';import {createWorker} from '../services/spine-service/worker.mjs';import {CLOUDFLARE_SPINE_CONFIG} from '../services/spine-service/provider-config.mjs';import {png,variant} from './helpers/service-images.mjs';
import {createCloudflareProvider} from '../services/spine-service/cloudflare-provider.mjs';
const {resolveAuthorizationPause}=await import('../services/spine-service/admin.mjs').catch(()=>({}));
const reject=code=>Object.assign(new Error('test provider detail'),{code});
async function setup(t,generate,extra={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'cf-worker-'));let date=new Date('2026-10-15T23:59:59.000Z');
  const options={dataDir,config:CLOUDFLARE_SPINE_CONFIG,clock:()=>date,...extra};let store=await openJobStore(options),worker=createWorker({store,provider:{config:CLOUDFLARE_SPINE_CONFIG,generate},clock:options.clock});
  t.after(async()=>{await worker.close();await store.close();await fs.rm(dataDir,{recursive:true,force:true});});
  return {get store(){return store;},get worker(){return worker;},dataDir,options,date(v){date=new Date(v);},async reopen(){await worker.close();await store.close();store=await openJobStore(options);worker=createWorker({store,provider:{config:CLOUDFLARE_SPINE_CONFIG,generate},clock:options.clock});},submit(n){return store.submit({installationId:'one',requestId:randomUUID(),bytes:variant(n),mime:'image/png',priority:'interactive'});},async drain(){worker.wake();await worker.idle();}};
}
test('quota pauses every book over restart and rollback then resumes the same work after UTC reset',async t=>{
  const seen=[];const a=await setup(t,async({coverBytes})=>{seen.push(coverBytes.toString('base64'));if(seen.length===1)throw reject('PROVIDER_QUOTA');return {bytes:png,mime:'image/png'};});
  const first=await a.submit('first'),second=await a.submit('second');await a.drain();assert.equal(seen.length,1);assert.equal(a.store.work(first.id).state,'queued');assert.equal(a.store.get({installationId:'one',id:second.id}).retryAt,'2026-10-16T00:01:00.000Z');
  await a.reopen();a.date('2026-10-14T12:00:00.000Z');await a.drain();assert.equal(seen.length,1);
  a.date('2026-10-16T00:00:59.999Z');await a.drain();assert.equal(seen.length,1);
  a.date('2026-10-16T00:01:00.000Z');await a.drain();assert.equal(seen.length,3);assert.equal(seen[1],seen[0]);assert.equal(a.store.work(first.id).state,'ready');
  const snapshot=JSON.parse(await fs.readFile(path.join(a.dataDir,'jobs.json')));const attempts=snapshot.attempts.filter(v=>v.workId===first.id);assert.equal(attempts.length,2);assert.notEqual(attempts[0].attemptId,attempts[1].attemptId);
});
test('capacity delay and local ten attempt ceiling prevent a hot loop across books',async t=>{
  let calls=0,active=0,max=0;const a=await setup(t,async()=>{calls++;active++;max=Math.max(max,active);await Promise.resolve();active--;throw Object.assign(reject('PROVIDER_CAPACITY'),{retryAfterMs:2000});});
  a.date('2026-10-15T12:00:00.000Z');const first=await a.submit(1);await a.submit(2);
  for(let n=0;n<10;n++){await a.drain();assert.equal(calls,n+1);const raw=a.store.work(first.id);await a.drain();assert.equal(calls,n+1);a.date(raw.retryAt);}
  await a.drain();assert.equal(calls,10);assert.equal(max,1);assert.equal(a.store.nextWork().retryAt,'2026-10-16T00:00:00.000Z');
});
test('unknown 429 timeout and abort stay uncertain over worker and store restart',async t=>{
  for(const code of ['PROVIDER_UNCERTAIN','AI_TIMEOUT','INTERRUPTED']){
    let calls=0;const a=await setup(t,async()=>{calls++;throw reject(code);});const job=await a.submit(code);await a.drain();assert.equal(a.store.work(job.id).state,'uncertain');await a.reopen();await a.drain();assert.equal(calls,1);
  }
});
test('failed refusal commit halts all work and recovers the attempt as uncertain',async t=>{
  let failing=false,calls=0;const fsAdapter={...fs,rename:async(from,to)=>{if(failing&&to.endsWith('jobs.json'))throw Object.assign(new Error('disk'),{code:'ENOSPC'});return fs.rename(from,to);}};
  const a=await setup(t,async()=>{calls++;failing=true;throw reject('PROVIDER_QUOTA');},{fsAdapter});const first=await a.submit(1);await a.submit(2);await a.drain();await a.drain();assert.equal(calls,1);
  failing=false;await a.worker.close();await a.store.close();const recovered=await openJobStore(a.options);try{assert.equal(recovered.work(first.id).state,'uncertain');}finally{await recovered.close();}
});
test('authorization pause requires a stopped-service operator action and does not reset daily attempts',async t=>{
  assert.equal(typeof resolveAuthorizationPause,'function');let calls=0;const a=await setup(t,async()=>{if(++calls===1)throw reject('PROVIDER_AUTH');return {bytes:png,mime:'image/png'};});
  const job=await a.submit(1);await a.drain();assert.equal(calls,1);assert.equal(a.store.work(job.id).state,'queued');
  await assert.rejects(resolveAuthorizationPause({dataDir:a.dataDir}),{code:'DATA_IN_USE'});await a.reopen();a.date('2026-11-01T00:00:00.000Z');await a.drain();assert.equal(calls,1);
  await a.worker.close();await a.store.close();await resolveAuthorizationPause({dataDir:a.dataDir});await a.reopen();await a.drain();assert.equal(calls,2);assert.equal(a.store.work(job.id).state,'ready');assert.equal(a.store.usage('2026-10-15').attempts,1);
});
test('provider config mismatch fails queued work without another model call while ready results remain readable',async t=>{
  let calls=0;const a=await setup(t,async()=>{calls++;return {bytes:png,mime:'image/png'};});const ready=await a.submit('ready');await a.drain();assert.equal(calls,1);
  await a.worker.close();const pending=await a.submit('pending');const worker=createWorker({store:a.store,provider:{config:{...CLOUDFLARE_SPINE_CONFIG,promptVersion:'new-prompt'},generate:async()=>{calls++;return {bytes:png,mime:'image/png'};}},clock:a.options.clock});
  t.after(()=>worker.close());worker.wake();await worker.idle();assert.equal(calls,1);assert.equal(a.store.work(pending.id).errorCode,'CONFIG_CHANGED');assert.deepEqual((await a.store.readResult({installationId:'one',id:ready.id})).bytes,png);
});
test('closing a worker bounds an ignoring provider and preserves uncertain state',async t=>{
  let started;const ready=new Promise(resolve=>started=resolve);const a=await setup(t,async()=>{started();return new Promise(()=>{});});const job=await a.submit(1);a.worker.wake();
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('not started')),1000))]);await a.worker.close();assert.equal(a.store.work(job.id).state,'uncertain');
});

for(const status of [401,403])test(`contradictory ${status} image result pauses authorization but is never retried after operator resume`,async t=>{
  let calls=0;const provider=createCloudflareProvider({accountId:'0123456789abcdef0123456789abcdef',apiToken:'fixture-auth-conflict-test-token',freeConfirmed:true,fetchImpl:async()=>{calls++;return Response.json({success:true,result:{image:png.toString('base64')},errors:[],messages:[]},{status});}});
  const a=await setup(t,input=>provider.generate(input)),job=await a.submit('auth conflict');await a.drain();assert.equal(calls,1);assert.equal(a.store.work(job.id).state,'uncertain');
  let snapshot=JSON.parse(await fs.readFile(path.join(a.dataDir,'jobs.json')));assert.equal(snapshot.providerPause.kind,'authorization');assert.equal(snapshot.attempts[0].state,'uncertain');assert.equal(snapshot.attempts[0].reason,null);
  await a.worker.close();await a.store.close();await resolveAuthorizationPause({dataDir:a.dataDir});await a.reopen();await a.drain();assert.equal(calls,1);assert.equal(a.store.work(job.id).state,'uncertain');
  snapshot=JSON.parse(await fs.readFile(path.join(a.dataDir,'jobs.json')));assert.equal(snapshot.attempts.length,1);
});
