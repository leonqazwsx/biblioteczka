import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {openJobStore} from '../services/spine-service/job-store.mjs';
import {createCloudflareProvider} from '../services/spine-service/cloudflare-provider.mjs';
import {CLOUDFLARE_SPINE_CONFIG, providerConfigHash} from '../services/spine-service/provider-config.mjs';
import {SPINE_PROMPT} from '../src/spine-provider.mjs';
import {png, variant} from './helpers/service-images.mjs';
import {loadSharp} from './helpers/cloudflare-images.mjs';
const {runQualityProbe, assertQualityProbeReady}=await import('../services/spine-service/quality-probe.mjs').catch(()=>({}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const qualityConfig={...CLOUDFLARE_SPINE_CONFIG,promptVersion:'cover-motif-cf-quality-v2'};
const quality9bConfig={...qualityConfig,model:'cf-flux-2-klein-9b',remoteModel:'@cf/black-forest-labs/flux-2-klein-9b'};
const style9bConfig={...quality9bConfig,promptVersion:'cover-motif-cf-style-v3',referenceVersion:'sharp-480-style-v1-b494e96d36efb33378a45d85f0a99a621cedec773f4755702349cf4a2d78c5e2'};
const smooth9bConfig={...quality9bConfig,promptVersion:'cover-motif-cf-smooth-v4',width:320,height:1600};
const clock=()=>new Date('2026-10-17T12:00:00Z');
const options={accountId:'0123456789abcdef0123456789abcdef',apiToken:'synthetic-quality-only-private-token',freeConfirmed:true};
async function fixture(t,seed=async()=>{}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-quality-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:25}));
  const dataDir=path.join(root,'service'),outputDir=path.join(root,'study');
  const store=await openJobStore({dataDir,config:CLOUDFLARE_SPINE_CONFIG,clock});
  try {await seed(store);}finally {await store.close();}
  const args={dataDir,outputDir,coverBytes:png,coverMime:'image/png',expectedCoverHash:hash(png),clock};
  return {root,dataDir,outputDir,args,snapshot:async()=>JSON.parse(await fs.readFile(path.join(dataDir,'jobs.json'),'utf8'))};
}
async function submit(store,bytes=png) {return store.submit({installationId:'existing-pilot',requestId:randomUUID(),mime:'image/png',bytes,priority:'backfill'});}
function run(args) {assert.equal(typeof runQualityProbe,'function','The isolated quality probe is available');return runQualityProbe(args);}
const error=code=>Object.assign(new Error('private provider detail'),{code});

test('quality profile sends different instructions with a distinct cache identity while default stays unchanged',async()=>{
  let body;
  const provider=createCloudflareProvider({...options,profile:'quality-v2',fetchImpl:async(_url,request)=>{body=request.body;return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});}});
  await provider.generate({coverBytes:png,coverMime:'image/png'});
  assert.notEqual(body.get('prompt'),SPINE_PROMPT);
  assert.notEqual(providerConfigHash(provider.config),providerConfigHash(CLOUDFLARE_SPINE_CONFIG));
  assert.equal(provider.config.promptVersion,'cover-motif-cf-quality-v2');
  assert.deepEqual(createCloudflareProvider(options).config,CLOUDFLARE_SPINE_CONFIG);
  assert.throws(()=>createCloudflareProvider({...options,profile:'unknown'}),{code:'SERVICE_CONFIG'});
});

test('private provider diagnostics retain only HTTP and numeric codes, never raw replies or credentials',async()=>{
  const provider=createCloudflareProvider({...options,profile:'quality-v2',fetchImpl:async()=>Response.json({success:false,result:null,errors:[{code:5018,message:options.apiToken,extra:'private'}],secret:options.accountId},{status:403})});
  await assert.rejects(provider.generate({coverBytes:png,coverMime:'image/png'}),failure=>{
    assert.deepEqual(failure.providerDiagnostic,{http:403,codes:[5018]});
    assert.equal(JSON.stringify(failure.providerDiagnostic).includes(options.apiToken),false);return true;
  });
});

test('one new profile attempt is durable before transport, preserves other works, and cached rerun does not generate',async t=>{
  const a=await fixture(t,async store=>{
    const ready=await submit(store),attempt=await store.reserveAttempt({workId:ready.id,day:'2026-10-17'});
    await store.complete({workId:ready.id,...attempt,bytes:png,mime:'image/png'});
    const uncertain=await submit(store,variant(2));await store.reserveAttempt({workId:uncertain.id,day:'2026-10-17'});
    await store.transition(uncertain.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});
    await submit(store,variant(3));
  });
  const before=await a.snapshot();let calls=0;
  const provider={config:qualityConfig,async generate(){calls++;const during=await a.snapshot();assert.equal(during.attempts.length,3);assert.equal(during.attempts.at(-1).state,'started');return {bytes:png,mime:'image/png'};}};
  const first=await run({...a.args,provider});assert.equal(first.state,'ready');assert.equal(first.requestsStarted,1);
  assert.deepEqual(await fs.readFile(path.join(a.outputDir,first.file)),png);
  const after=await a.snapshot();for(const old of before.works)assert.deepEqual(after.works.find(work=>work.workId===old.workId),old);
  assert.equal(after.works.length,4);assert.equal(after.attempts.length,3);
  const second=await run({...a.args,provider});assert.equal(second.state,'ready');assert.equal(second.requestsStarted,0);assert.equal(calls,1);
  assert.equal((await a.snapshot()).attempts.length,3);
});

test('uncertain quality response remains uncertain across launches without repeating the request',async t=>{
  const a=await fixture(t);let calls=0;
  const provider={config:qualityConfig,async generate(){calls++;throw error('PROVIDER_UNCERTAIN');}};
  const first=await run({...a.args,provider});assert.equal(first.state,'uncertain');
  const second=await run({...a.args,provider});assert.equal(second.state,'uncertain');assert.equal(calls,1);
  assert.equal((await a.snapshot()).attempts.length,1);
});

test('quality probe shares the existing ten-attempt budget instead of opening another budget',async t=>{
  const a=await fixture(t,async store=>{for(let n=0;n<10;n++){const job=await submit(store,variant(n));await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
  let calls=0;const result=await run({...a.args,provider:{config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}}});
  assert.equal(result.state,'queued');assert.equal(result.errorCode,'LOCAL_BUDGET');assert.equal(calls,0);assert.equal((await a.snapshot()).attempts.length,10);
});

test('quality probe cannot clear an existing authorization pause',async t=>{
  const a=await fixture(t,async store=>{const job=await submit(store);const attempt=await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.deferAttempt({workId:job.id,...attempt,kind:'authorization'});});
  let calls=0;const result=await run({...a.args,provider:{config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}}});
  assert.equal(result.state,'queued');assert.equal(result.errorCode,'PROVIDER_AUTH');assert.equal(calls,0);assert.equal((await a.snapshot()).providerPause.kind,'authorization');
});

test('running service blocks preflight and the probe before transport or journal mutation',async t=>{
  const a=await fixture(t),before=await fs.readFile(path.join(a.dataDir,'jobs.json'));
  const owner=await openJobStore({dataDir:a.dataDir,config:CLOUDFLARE_SPINE_CONFIG,clock});let calls=0;
  try {
    assert.equal(typeof assertQualityProbeReady,'function');await assert.rejects(assertQualityProbeReady({dataDir:a.dataDir}),{code:'DATA_IN_USE'});
    await assert.rejects(run({...a.args,provider:{config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}}}),{code:'DATA_IN_USE'});
    assert.equal(calls,0);assert.deepEqual(await fs.readFile(path.join(a.dataDir,'jobs.json')),before);
  }finally {await owner.close();}
});

test('changed cover is rejected without a new work or provider request',async t=>{
  const a=await fixture(t),before=await fs.readFile(path.join(a.dataDir,'jobs.json'));let calls=0;
  await assert.rejects(run({...a.args,expectedCoverHash:'0'.repeat(64),provider:{config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}}}),{code:'QUALITY_COVER_CHANGED'});
  assert.equal(calls,0);assert.deepEqual(await fs.readFile(path.join(a.dataDir,'jobs.json')),before);
});

test('cancellation after reservation releases the store and never retries an unconfirmed attempt',async t=>{
  const a=await fixture(t),controller=new AbortController();let started;
  const entered=new Promise(resolve=>{started=resolve;});let calls=0;
  const provider={config:qualityConfig,generate(){calls++;started();return new Promise(()=>{});}};
  const pending=run({...a.args,provider,signal:controller.signal});await entered;controller.abort();
  assert.equal((await pending).state,'uncertain');assert.equal((await run({...a.args,provider})).state,'uncertain');assert.equal(calls,1);
});

test('artifact write conflict preserves a ready result and re-export reuses it without generation',async t=>{
  const a=await fixture(t);await fs.mkdir(path.join(a.outputDir,'assets'),{recursive:true});await fs.writeFile(path.join(a.outputDir,'assets/diuna-cloudflare-v2.png'),'existing file');
  let calls=0;const provider={config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}};
  await assert.rejects(run({...a.args,provider}),{code:'QUALITY_OUTPUT_CONFLICT'});
  assert.equal((await a.snapshot()).works[0].state,'ready');
  await fs.unlink(path.join(a.outputDir,'assets/diuna-cloudflare-v2.png'));
  assert.equal((await run({...a.args,provider})).state,'ready');assert.equal(calls,1);
});

test('quota refusal is recorded once and stops without an automatic repeat',async t=>{
  const a=await fixture(t);let calls=0;
  const provider={config:qualityConfig,async generate(){calls++;throw Object.assign(error('PROVIDER_QUOTA'),{providerDiagnostic:{http:429,codes:[3036]}});}};
  const result=await run({...a.args,provider});assert.equal(result.state,'queued');assert.equal(result.errorCode,'PROVIDER_QUOTA');assert.equal(calls,1);
  assert.deepEqual(result.diagnostic,{http:429,codes:[3036]});assert.equal((await a.snapshot()).attempts[0].state,'refused');
});

test('success after a deferred quota refusal clears the historical error from fresh and cached reports',async t=>{
  const a=await fixture(t);
  const refused=await run({...a.args,provider:{config:qualityConfig,async generate(){throw Object.assign(error('PROVIDER_QUOTA'),{providerDiagnostic:{http:429,codes:[4006]}});}}});
  assert.equal(refused.state,'queued');assert.deepEqual(refused.diagnostic,{http:429,codes:[4006]});
  let calls=0;const next={...a.args,clock:()=>new Date('2026-10-18T00:01:00Z'),provider:{config:qualityConfig,async generate(){calls++;return {bytes:png,mime:'image/png'};}}};
  const ready=await run(next);assert.equal(ready.state,'ready');assert.equal(ready.diagnostic,null);assert.equal(ready.requestsStarted,1);
  const cached=await run(next);assert.equal(cached.state,'ready');assert.equal(cached.diagnostic,null);assert.equal(cached.requestsStarted,0);assert.equal(calls,1);
  assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-quality-result.json'),'utf8')).diagnostic,null);
});

test('9B comparison changes only the model endpoint and keeps the exact 4B input payload',async()=>{
  const sent=[];
  const fetchImpl=async(url,request)=>{sent.push({url,body:request.body});return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});};
  for(const profile of ['quality-v2','quality-v2-9b'])await createCloudflareProvider({...options,profile,fetchImpl}).generate({coverBytes:png,coverMime:'image/png'});
  assert.equal(sent[1].url,'https://api.cloudflare.com/client/v4/accounts/'+options.accountId+'/ai/run/@cf/black-forest-labs/flux-2-klein-9b');
  assert.deepEqual([...sent[1].body.keys()],['prompt','width','height','input_image_0']);
  for(const key of ['prompt','width','height'])assert.equal(sent[1].body.get(key),sent[0].body.get(key));
  assert.deepEqual(Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()));
  assert.deepEqual(createCloudflareProvider({...options,profile:'quality-v2-9b'}).config,quality9bConfig);
  assert.deepEqual(createCloudflareProvider(options).config,CLOUDFLARE_SPINE_CONFIG);
});

test('9B probe has a separate cached work and artifact without overwriting the 4B result',async t=>{
  const a=await fixture(t);let calls=0;
  const first=await run({...a.args,provider:{config:qualityConfig,async generate(){return {bytes:png,mime:'image/png'};}}});
  const before=await a.snapshot(),beforeImage=await fs.readFile(path.join(a.outputDir,first.file));
  const provider={config:quality9bConfig,async generate(){calls++;const during=await a.snapshot();assert.equal(during.attempts.length,2);assert.equal(during.attempts.at(-1).state,'started');return {bytes:variant(8),mime:'image/png'};}};
  const result=await run({...a.args,provider});
  assert.equal(result.state,'ready');assert.equal(result.file,'assets/diuna-cloudflare-9b.png');
  assert.equal(result.result.model,'cf-flux-2-klein-9b');assert.notEqual(result.requestId,first.requestId);
  assert.deepEqual(await fs.readFile(path.join(a.outputDir,first.file)),beforeImage);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-quality-result.json'),'utf8')),first);
  assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-quality-9b-result.json'),'utf8')).result.model,'cf-flux-2-klein-9b');
  const after=await a.snapshot();assert.deepEqual(after.works[0],before.works[0]);
  assert.equal((await run({...a.args,provider})).requestsStarted,0);assert.equal(calls,1);
  assert.equal((await a.snapshot()).attempts.length,2);
});

test('9B probe respects the shared budget and does not repeat an uncertain model call',async t=>{
  const blocked=await fixture(t,async store=>{for(let n=0;n<10;n++){const job=await submit(store,variant(n));await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
  let calls=0;
  const provider={config:quality9bConfig,async generate(){calls++;throw error('PROVIDER_UNCERTAIN');}};
  const result=await run({...blocked.args,provider});assert.equal(result.errorCode,'LOCAL_BUDGET');assert.equal(calls,0);
  const a=await fixture(t);
  assert.equal((await run({...a.args,provider})).state,'uncertain');
  assert.equal((await run({...a.args,provider})).state,'uncertain');assert.equal(calls,1);
});

test('style profile sends the original cover first and a bounded neutral material reference second',async()=>{
  const sent=[];
  const fetchImpl=async(url,request)=>{sent.push({url,body:request.body});return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});};
  for(const profile of ['quality-v2-9b','style-v3-9b'])await createCloudflareProvider({...options,profile,fetchImpl}).generate({coverBytes:png,coverMime:'image/png'});
  assert.equal(sent[1].url,sent[0].url);
  assert.deepEqual([...sent[1].body.keys()],['prompt','width','height','input_image_0','input_image_1']);
  assert.deepEqual(Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()));
  const material=sent[1].body.get('input_image_1');assert.equal(material.type,'image/jpeg');
  const meta=await loadSharp()(Buffer.from(await material.arrayBuffer())).metadata();
  assert.equal(meta.width,480);assert.equal(meta.height,480);assert.equal(meta.exif,undefined);
  assert.notEqual(sent[1].body.get('prompt'),sent[0].body.get('prompt'));
  assert.deepEqual(createCloudflareProvider({...options,profile:'style-v3-9b'}).config,style9bConfig);
  assert.deepEqual(createCloudflareProvider(options).config,CLOUDFLARE_SPINE_CONFIG);
});

test('a replaced material reference is rejected at provider creation before transport or budget reservation',async()=>{
  let calls=0;
  assert.throws(()=>createCloudflareProvider({...options,profile:'style-v3-9b',styleReferenceBytes:variant(7),fetchImpl:async()=>{calls++;throw new Error('must not send');}}),{code:'QUALITY_MATERIAL_CHANGED'});
  assert.equal(calls,0);
});

test('style probe keeps the baseline 9B artifact and caches its own one-shot result separately',async t=>{
  const a=await fixture(t);
  const baseline=await run({...a.args,provider:{config:quality9bConfig,async generate(){return {bytes:png,mime:'image/png'};}}});
  const before=await a.snapshot();let calls=0;
  const provider={config:style9bConfig,async generate(){calls++;const during=await a.snapshot();assert.equal(during.attempts.at(-1).state,'started');return {bytes:variant(9),mime:'image/png'};}};
  const result=await run({...a.args,provider});assert.equal(result.state,'ready');assert.equal(result.file,'assets/diuna-cloudflare-9b-style.png');
  assert.notEqual(result.requestId,baseline.requestId);
  assert.deepEqual(await fs.readFile(path.join(a.outputDir,baseline.file)),png);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-quality-9b-result.json'),'utf8')),baseline);
  assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-style-9b-result.json'),'utf8')).result.promptVersion,'cover-motif-cf-style-v3');
  assert.deepEqual((await a.snapshot()).works[0],before.works[0]);
  assert.equal((await run({...a.args,provider})).requestsStarted,0);assert.equal(calls,1);assert.equal((await a.snapshot()).attempts.length,2);
});

test('style probe cannot use an unrecognized material identity or bypass an existing authorization pause',async t=>{
  const a=await fixture(t,async store=>{const job=await submit(store);const attempt=await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.deferAttempt({workId:job.id,...attempt,kind:'authorization'});});
  let calls=0;const generate=async()=>{calls++;return {bytes:png,mime:'image/png'};};
  await assert.rejects(run({...a.args,provider:{config:{...style9bConfig,referenceVersion:'changed-material'},generate}}),{code:'SERVICE_CONFIG'});
  const result=await run({...a.args,provider:{config:style9bConfig,generate}});
  assert.equal(result.errorCode,'PROVIDER_AUTH');assert.equal(calls,0);assert.equal((await a.snapshot()).attempts.length,1);
});

test('style probe never retries an uncertain result on a later launch',async t=>{
  const a=await fixture(t);let calls=0;
  const provider={config:style9bConfig,async generate(){calls++;throw error('PROVIDER_UNCERTAIN');}};
  assert.equal((await run({...a.args,provider})).state,'uncertain');
  assert.equal((await run({...a.args,provider})).state,'uncertain');assert.equal(calls,1);
});

test('smooth 9B requests a native 1:5 image with only the unchanged book cover reference',async()=>{
  const sent=[];
  const fetchImpl=async(url,request)=>{sent.push({url,body:request.body});return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});};
  for(const profile of ['quality-v2-9b','smooth-v4-9b'])await createCloudflareProvider({...options,profile,fetchImpl}).generate({coverBytes:png,coverMime:'image/png'});
  assert.equal(sent[1].url,sent[0].url);
  assert.deepEqual([...sent[1].body.keys()],['prompt','width','height','input_image_0']);
  assert.equal(sent[1].body.get('width'),'320');assert.equal(sent[1].body.get('height'),'1600');
  assert.deepEqual(Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()));
  assert.notEqual(sent[1].body.get('prompt'),sent[0].body.get('prompt'));
  assert.deepEqual(createCloudflareProvider({...options,profile:'smooth-v4-9b'}).config,smooth9bConfig);
  assert.deepEqual(createCloudflareProvider(options).config,CLOUDFLARE_SPINE_CONFIG);
});

test('smooth probe uses the last shared attempt once and retains the cloth result and cache',async t=>{
  const a=await fixture(t,async store=>{for(let n=0;n<8;n++){const job=await submit(store,variant(n));await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
  const baseline=await run({...a.args,provider:{config:style9bConfig,async generate(){return {bytes:png,mime:'image/png'};}}});
  const before=await a.snapshot();let calls=0;
  const provider={config:smooth9bConfig,async generate(){calls++;const during=await a.snapshot();assert.equal(during.attempts.length,10);assert.equal(during.attempts.at(-1).state,'started');return {bytes:variant(11),mime:'image/png'};}};
  const result=await run({...a.args,provider});assert.equal(result.state,'ready');assert.equal(result.file,'assets/diuna-cloudflare-9b-smooth.png');
  assert.notEqual(result.requestId,baseline.requestId);
  assert.deepEqual(await fs.readFile(path.join(a.outputDir,baseline.file)),png);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-style-9b-result.json'),'utf8')),baseline);
  assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-smooth-9b-result.json'),'utf8')).result.promptVersion,'cover-motif-cf-smooth-v4');
  const after=await a.snapshot();for(const work of before.works)assert.deepEqual(after.works.find(current=>current.workId===work.workId),work);
  assert.equal((await run({...a.args,provider})).requestsStarted,0);assert.equal(calls,1);assert.equal((await a.snapshot()).attempts.length,10);
});

test('smooth probe neither bypasses the budget nor retries an uncertain result',async t=>{
  const blocked=await fixture(t,async store=>{for(let n=0;n<10;n++){const job=await submit(store,variant(n));await store.reserveAttempt({workId:job.id,day:'2026-10-17'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
  let calls=0;const provider={config:smooth9bConfig,async generate(){calls++;throw error('PROVIDER_UNCERTAIN');}};
  assert.equal((await run({...blocked.args,provider})).errorCode,'LOCAL_BUDGET');assert.equal(calls,0);
  const a=await fixture(t);assert.equal((await run({...a.args,provider})).state,'uncertain');
  assert.equal((await run({...a.args,provider})).state,'uncertain');assert.equal(calls,1);
});
