import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openJobStore} from '../services/spine-service/job-store.mjs';
import {runQualityProbe} from '../services/spine-service/quality-probe.mjs';
import {createCloudflareProvider} from '../services/spine-service/cloudflare-provider.mjs';
import {cloudflareProfile} from '../services/spine-service/cloudflare-profiles.mjs';
import {png,variant} from './helpers/service-images.mjs';
const {readQualityCover}=await import('../services/spine-service/quality-cover.mjs').catch(()=>({}));
const appRoot=fileURLToPath(new URL('../',import.meta.url));
const textlessPath='output/execution/spine-textless-9b-20261019/assets/diuna-reference-textless.png';
const textlessHash='41977fb72cbee18c7addcb2b92de2fd8d8698211b3091d7efb4ad421c7703fdf';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const config=cloudflareProfile('smooth-v4-9b').config;
const clock=()=>new Date('2026-10-19T12:00:00Z');
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-textless-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:25}));return root;}

test('quality input pins the approved textless illustration and preserves the original cover option',async()=>{
  assert.equal(typeof readQualityCover,'function');
  const original=await readQualityCover({appRoot}),textless=await readQualityCover({appRoot,textless:true});
  assert.equal(original.coverMime,'image/jpeg');assert.equal(original.expectedCoverHash,'02670b485328a6e479ab690b2554f5280c123c2bae26ddea477e23fe3ac8df95');
  assert.equal(hash(original.coverBytes),original.expectedCoverHash);
  assert.equal(textless.coverMime,'image/png');assert.equal(textless.expectedCoverHash,textlessHash);
  assert.deepEqual(textless.coverBytes,await fs.readFile(path.join(appRoot,textlessPath)));
});

test('missing or changed textless artwork fails before it can be used as the reference',async t=>{
  assert.equal(typeof readQualityCover,'function');const root=await temporary(t);
  await assert.rejects(readQualityCover({appRoot:root,textless:true}),{code:'QUALITY_REFERENCE_CHANGED'});
  const file=path.join(root,textlessPath);await fs.mkdir(path.dirname(file),{recursive:true});
  const changed=await fs.readFile(path.join(appRoot,textlessPath));changed[changed.length-1]^=1;await fs.writeFile(file,changed);
  await assert.rejects(readQualityCover({appRoot:root,textless:true}),{code:'QUALITY_REFERENCE_CHANGED'});
});

test('textless flag requires the existing pilot before credentials and rejects mixed quality flags',async t=>{
  const root=await temporary(t),env={LOCALAPPDATA:root,SystemRoot:process.env.SystemRoot??''};
  const base=['services/spine-service/pilot.mjs','--free-confirmed','--quality-diuna-9b-textless'];
  const missing=spawnSync(process.execPath,base,{cwd:appRoot,env,encoding:'utf8',timeout:10000});
  assert.equal(missing.status,1);assert.match(missing.stderr,/Brak dziennika dotychczasowej proby/);assert.doesNotMatch(missing.stdout,/Account ID|Token Workers AI/);
  const mixed=spawnSync(process.execPath,[...base,'--quality-diuna-9b-smooth'],{cwd:appRoot,env,encoding:'utf8',timeout:10000});
  assert.equal(mixed.status,1);assert.match(mixed.stderr,/Nieprawidlowa konfiguracja lokalna/);
});

test('changing only the input separates the smooth cache and output while sharing its budget',async t=>{
  const root=await temporary(t),dataDir=path.join(root,'service');
  const initial=await openJobStore({dataDir,config,clock});await initial.close();
  let calls=0;const provider={config,async generate(){calls++;return {bytes:variant(5+calls),mime:'image/png'};}};
  const baselineDir=path.join(root,'baseline'),newDir=path.join(root,'textless');
  const base={dataDir,outputDir:baselineDir,coverBytes:png,coverMime:'image/png',expectedCoverHash:hash(png),provider,clock};
  const old=await runQualityProbe(base),before=await fs.readFile(path.join(baselineDir,old.file));
  const other=variant(13),next={...base,outputDir:newDir,coverBytes:other,expectedCoverHash:hash(other)};
  const result=await runQualityProbe(next);
  assert.equal(result.state,'ready');assert.equal(result.dayAttempts,2);assert.notEqual(result.requestId,old.requestId);
  assert.deepEqual(await fs.readFile(path.join(baselineDir,old.file)),before);
  assert.equal(result.result.promptVersion,old.result.promptVersion);assert.equal(result.result.model,old.result.model);
  assert.equal((await runQualityProbe(next)).requestsStarted,0);assert.equal(calls,2);
  const journal=JSON.parse(await fs.readFile(path.join(dataDir,'jobs.json'),'utf8'));assert.equal(journal.attempts.length,2);
});

test('textless input keeps the exact smooth prompt, dimensions, endpoint and one-reference transport',async()=>{
  assert.equal(typeof readQualityCover,'function');
  const sent=[];const fetchImpl=async(url,request)=>{sent.push({url,body:request.body});return Response.json({success:true,errors:[],result:{image:png.toString('base64')}});};
  const provider=createCloudflareProvider({accountId:'0123456789abcdef0123456789abcdef',apiToken:'synthetic-textless-test-token',freeConfirmed:true,profile:'smooth-v4-9b',fetchImpl});
  for(const textless of [false,true])await provider.generate(await readQualityCover({appRoot,textless}));
  assert.equal(sent[0].url,sent[1].url);assert.deepEqual([...sent[1].body.keys()],['prompt','width','height','input_image_0']);
  for(const field of ['prompt','width','height'])assert.equal(sent[1].body.get(field),sent[0].body.get(field));
  assert.notDeepEqual(Buffer.from(await sent[1].body.get('input_image_0').arrayBuffer()),Buffer.from(await sent[0].body.get('input_image_0').arrayBuffer()));
});
