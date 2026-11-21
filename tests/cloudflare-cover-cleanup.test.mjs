import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCloudflareProvider} from '../services/spine-service/cloudflare-provider.mjs';
import {cloudflareProfile} from '../services/spine-service/cloudflare-profiles.mjs';
import {providerConfigHash} from '../services/spine-service/provider-config.mjs';
import {openJobStore} from '../services/spine-service/job-store.mjs';
import {runQualityProbe} from '../services/spine-service/quality-probe.mjs';
import {png,variant} from './helpers/service-images.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const config={...cloudflareProfile('quality-v2-9b').config,promptVersion:'cover-clean-cf-v1',width:512,height:768};
const clock=()=>new Date('2026-10-19T12:00:00Z'),appRoot=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t,seed=async()=>{}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-cleanup-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:25}));
  const dataDir=path.join(root,'service'),outputDir=path.join(root,'result');
  const store=await openJobStore({dataDir,config,clock});try{await seed(store);}finally{await store.close();}
  return {dataDir,outputDir,coverBytes:png,coverMime:'image/png',expectedCoverHash:hash(png),clock,root};
}

test('cover cleanup sends a cover-shaped edit to 9B with a cache distinct from spine generation',async()=>{
  let sent;
  const provider=createCloudflareProvider({accountId:'0123456789abcdef0123456789abcdef',apiToken:'synthetic-cover-cleanup-token',freeConfirmed:true,profile:'cover-clean-v1-9b',fetchImpl:async(url,request)=>{sent={url,body:request.body};return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});}});
  const result=await provider.generate({coverBytes:png,coverMime:'image/png'});
  assert.deepEqual(result.bytes,png);assert.equal(sent.url,'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/black-forest-labs/flux-2-klein-9b');
  assert.equal(sent.body.get('width'),'512');assert.equal(sent.body.get('height'),'768');
  assert.deepEqual([...sent.body.keys()],['prompt','width','height','input_image_0']);
  assert.notEqual(sent.body.get('prompt'),cloudflareProfile('smooth-v4-9b').prompt);
  assert.notEqual(providerConfigHash(provider.config),providerConfigHash(cloudflareProfile('smooth-v4-9b').config));
  assert.deepEqual(provider.config,config);
});

test('cleanup exports one separate result and reuses it without spending a second attempt',async t=>{
  const a=await fixture(t);let calls=0;
  const args={...a,provider:{config,async generate(){calls++;return {bytes:variant(8),mime:'image/png'};}}};
  const first=await runQualityProbe(args);assert.equal(first.state,'ready');assert.equal(first.requestsStarted,1);assert.equal(first.dayAttempts,1);
  assert.equal(first.file,'assets/diuna-cloudflare-9b-cover-cleaned.png');
  assert.deepEqual(await fs.readFile(path.join(a.outputDir,first.file)),variant(8));
  const second=await runQualityProbe(args);assert.equal(second.requestsStarted,0);assert.equal(calls,1);assert.equal(second.requestId,first.requestId);
  assert.equal(JSON.parse(await fs.readFile(path.join(a.outputDir,'cloudflare-cover-cleanup-result.json'),'utf8')).result.promptVersion,'cover-clean-cf-v1');
});

test('uncertain cleanup is never retried and provider refusal retains the shared pause',async t=>{
  for(const code of ['PROVIDER_UNCERTAIN','PROVIDER_QUOTA']){
    const a=await fixture(t);let calls=0;
    const args={...a,provider:{config,async generate(){calls++;throw Object.assign(Error('fixture'),{code});}}};
    const first=await runQualityProbe(args);assert.equal(first.state,code==='PROVIDER_UNCERTAIN'?'uncertain':'queued');
    await runQualityProbe(args);assert.equal(calls,1);
    const saved=JSON.parse(await fs.readFile(path.join(a.dataDir,'jobs.json'),'utf8'));assert.equal(saved.attempts.length,1);
    if(code==='PROVIDER_QUOTA')assert.equal(saved.providerPause.kind,'quota');
  }
});

test('cleanup cannot open another budget when ten existing attempts were spent',async t=>{
  const a=await fixture(t,async store=>{for(let i=0;i<10;i++){const job=await store.submit({installationId:'existing',requestId:randomUUID(),mime:'image/png',bytes:variant(50+i),priority:'interactive'});const reservation=await store.reserveAttempt({workId:job.id,day:'2026-10-19'});await store.transition(job.id,{state:'uncertain',errorCode:'PROVIDER_UNCERTAIN',retryAt:null});}});
  let calls=0;const result=await runQualityProbe({...a,provider:{config,async generate(){calls++;return {bytes:png,mime:'image/png'};}}});
  assert.equal(result.errorCode,'LOCAL_BUDGET');assert.equal(calls,0);assert.equal(result.dayAttempts,10);
});

test('cleanup CLI stops before credentials without the existing journal and rejects mixed modes',async t=>{
  const a=await fixture(t),base=['services/spine-service/pilot.mjs','--free-confirmed','--quality-diuna-9b-cleanup'],env={LOCALAPPDATA:a.root,SystemRoot:process.env.SystemRoot??''};
  const missing=spawnSync(process.execPath,base,{cwd:appRoot,env,encoding:'utf8',timeout:10000});
  assert.equal(missing.status,1);assert.match(missing.stderr,/Brak dziennika dotychczasowej proby/);assert.doesNotMatch(missing.stdout,/Account ID|Token Workers AI/);
  const mixed=spawnSync(process.execPath,[...base,'--quality-covers-9b'],{cwd:appRoot,env,encoding:'utf8',timeout:10000});
  assert.equal(mixed.status,1);assert.match(mixed.stderr,/Nieprawidlowa konfiguracja lokalna/);
});
