import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runQualityProbe} from '../services/spine-service/quality-probe.mjs';
import {openJobStore} from '../services/spine-service/job-store.mjs';
import {cloudflareProfile} from '../services/spine-service/cloudflare-profiles.mjs';
import {png,variant} from './helpers/service-images.mjs';
const {readQualitySamples,runQualitySeries}=await import('../services/spine-service/quality-series.mjs').catch(()=>({}));
const config=cloudflareProfile('smooth-v4-9b').config,clock=()=>new Date('2026-10-19T12:00:00Z');
const appRoot=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,seed=async()=>{}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-variety-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:25}));const dataDir=path.join(root,'service'),outputDir=path.join(root,'results');const store=await openJobStore({dataDir,config,clock});try{await seed(store);}finally{await store.close();}return {root,dataDir,outputDir,snapshot:async()=>JSON.parse(await fs.readFile(path.join(dataDir,'jobs.json'),'utf8'))};}
const samples=()=>['rok-1984','quo-vadis'].map((sampleKey,i)=>{const coverBytes=variant(25+i);return {sampleKey,title:i?'Quo vadis':'Rok 1984',coverBytes,coverMime:'image/png',expectedCoverHash:hash(coverBytes)};});
const readyProvider=()=>({config,async generate(){return {bytes:png,mime:'image/png'};}});

test('named quality outputs preserve Diuna identity and give other books their own files',async t=>{
 const a=await fixture(t),provider=readyProvider(),base={...a,provider,clock,coverBytes:png,coverMime:'image/png',expectedCoverHash:hash(png)};
 const old=await runQualityProbe(base),again=await runQualityProbe({...base,sampleKey:'diuna'});assert.equal(again.requestId,old.requestId);assert.equal(again.requestsStarted,0);
 const other=samples()[0],result=await runQualityProbe({...base,...other,outputDir:path.join(a.outputDir,other.sampleKey)});
 assert.equal(result.file,'assets/rok-1984-cloudflare-9b-smooth.png');assert.notEqual(result.requestId,old.requestId);
 assert.deepEqual(await fs.readFile(path.join(a.outputDir,old.file)),png);
 const historicalCover=await fs.readFile(path.join(appRoot,'output/execution/spine-quality-20261017/assets/diuna-cover.jpg'));
 const historical=await runQualityProbe({...base,outputDir:path.join(a.outputDir,'historical'),coverBytes:historicalCover,coverMime:'image/jpeg',expectedCoverHash:'02670b485328a6e479ab690b2554f5280c123c2bae26ddea477e23fe3ac8df95'});
 assert.equal(historical.requestId,'4517edcb-6e12-4b3b-ad38-346b5fa8f891');
});

test('unsafe sample names are rejected before journal or transport changes',async t=>{
 const a=await fixture(t),before=await fs.readFile(path.join(a.dataDir,'jobs.json'));let calls=0;
 for(const sampleKey of ['../escape','a/b','a\\b','CON','','x'.repeat(65),null])await assert.rejects(runQualityProbe({...a,sampleKey,coverBytes:png,coverMime:'image/png',expectedCoverHash:hash(png),provider:{config,async generate(){calls++;return {bytes:png,mime:'image/png'};}},clock}),{code:'SERVICE_CONFIG'});
 assert.equal(calls,0);assert.deepEqual(await fs.readFile(path.join(a.dataDir,'jobs.json')),before);
});

test('the curated series pins both new inputs and does not regenerate the Diuna control',async t=>{
 assert.equal(typeof readQualitySamples,'function');const input=await readQualitySamples({appRoot});assert.deepEqual(input.map(x=>x.sampleKey),['rok-1984','quo-vadis']);
 for(const sample of input)assert.equal(hash(sample.coverBytes),sample.expectedCoverHash);
 const a=await fixture(t);await assert.rejects(readQualitySamples({appRoot:a.root}),{code:'QUALITY_REFERENCE_CHANGED'});
});

test('a complete series runs serially, preserves the shared counter and reuses both cached images',async t=>{
 assert.equal(typeof runQualitySeries,'function');const a=await fixture(t);let calls=0,active=0,maxActive=0;
 const provider={config,async generate(){calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,8));active--;return {bytes:variant(calls),mime:'image/png'};}};
 const args={...a,samples:samples(),provider,clock};const first=await runQualitySeries(args);
 assert.equal(first.state,'ready');assert.equal(first.requestsStarted,2);assert.equal(first.results.length,2);assert.equal(first.results[1].dayAttempts,2);assert.equal(maxActive,1);
 const second=await runQualitySeries(args);assert.equal(second.requestsStarted,0);assert.equal(calls,2);assert.equal((await a.snapshot()).attempts.length,2);
 assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'quality-series-result.json'),'utf8')).state,'ready');
});

test('an uncertain, failed or quota result stops the series and never submits its second image',async t=>{
 assert.equal(typeof runQualitySeries,'function');
 for(const code of ['PROVIDER_UNCERTAIN','AI_REJECTED','PROVIDER_QUOTA','PROVIDER_AUTH']){
  const a=await fixture(t);let calls=0;const provider={config,async generate(){calls++;throw Object.assign(new Error(code),{code});}};
  const args={...a,samples:samples(),provider,clock},first=await runQualitySeries(args);
  assert.equal(first.state,'stopped');assert.equal(first.results.length,1);assert.equal(calls,1);
  assert.equal((await a.snapshot()).works.length,1);
  const second=await runQualitySeries(args);assert.equal(second.requestsStarted,0);assert.equal(calls,1);
 }
});

test('a series with exhausted shared allowance starts no provider request',async t=>{
 assert.equal(typeof runQualitySeries,'function');const a=await fixture(t,async store=>{for(let i=0;i<10;i++){const job=await store.submit({installationId:'existing',requestId:randomUUID(),mime:'image/png',bytes:variant(50+i),priority:'interactive'});await store.reserveAttempt({workId:job.id,day:'2026-10-19'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
 let calls=0;const result=await runQualitySeries({...a,samples:samples(),provider:{config,async generate(){calls++;return {bytes:png,mime:'image/png'};}},clock});
 assert.equal(result.state,'stopped');assert.equal(result.results[0].errorCode,'LOCAL_BUDGET');assert.equal(calls,0);assert.equal((await a.snapshot()).attempts.length,10);
});

test('invalid later input blocks the whole series before the first sample is generated',async t=>{
 assert.equal(typeof runQualitySeries,'function');const a=await fixture(t),input=samples();input[1].expectedCoverHash='0'.repeat(64);let calls=0;
 await assert.rejects(runQualitySeries({...a,samples:input,provider:{config,async generate(){calls++;return {bytes:png,mime:'image/png'};}},clock}),{code:'QUALITY_REFERENCE_CHANGED'});assert.equal(calls,0);assert.equal((await a.snapshot()).works.length,0);
 await assert.rejects(runQualitySeries({...a,samples:samples(),provider:{async generate(){calls++;return {bytes:png,mime:'image/png'};}},clock}),{code:'SERVICE_CONFIG'});assert.equal(calls,0);
 const unexpected=path.join(a.root,'unexpected'),extra=samples().map(sample=>({...sample,dataDir:unexpected,outputDir:unexpected}));
 const safe=await runQualitySeries({...a,samples:extra,provider:readyProvider(),clock});assert.equal(safe.state,'ready');
 await assert.rejects(fs.stat(unexpected),{code:'ENOENT'});assert.equal((await a.snapshot()).works.length,2);
});

test('series CLI requires the existing pilot before credentials and rejects conflicting flags',async t=>{
 const a=await fixture(t),env={LOCALAPPDATA:a.root,SystemRoot:process.env.SystemRoot??''},base=['services/spine-service/pilot.mjs','--free-confirmed','--quality-covers-9b'];
 const missing=spawnSync(process.execPath,base,{cwd:appRoot,env,encoding:'utf8',timeout:10000});assert.equal(missing.status,1);assert.match(missing.stderr,/Brak dziennika dotychczasowej proby/);assert.doesNotMatch(missing.stdout,/Account ID|Token Workers AI/);
 const mixed=spawnSync(process.execPath,[...base,'--quality-diuna-9b-textless'],{cwd:appRoot,env,encoding:'utf8',timeout:10000});assert.equal(mixed.status,1);assert.match(mixed.stderr,/Nieprawidlowa konfiguracja lokalna/);
});
