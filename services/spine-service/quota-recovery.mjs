import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireDataLock} from '../../src/data-lock.mjs';
import {assertSafePath,ensureDirectory,atomicWrite,exactKeys,isHash,isIso} from '../../src/durable-files.mjs';
import {problem} from '../../src/domain.mjs';
import {validateJobSnapshot} from './job-schema.mjs';
import {FRAMED_9B_CONFIG} from './cloudflare-profiles.mjs';
import {providerConfigHash} from './provider-config.mjs';
import {qualityRequestId} from './quality-probe.mjs';

const coverHash='3f3d25811f4904e3ff0ab248153a25ad9df814b8aef4f1daf754365122368542';
const configHash=providerConfigHash(FRAMED_9B_CONFIG),requestId=qualityRequestId(coverHash,FRAMED_9B_CONFIG);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>problem('QUALITY_RECOVERY_'+code,'Nie mozna potwierdzic bezpiecznego wznowienia tej proby.');
const receiptKeys=['version','kind','requestId','workId','attemptId','coverHash','configHash','beforeHash','afterHash','confirmedAt','notBefore'];

// This operator-only exception is deliberately limited to the one pinned framed
// Diuna experiment. It is never called by the worker or the normal retry path.
export async function recoverFramedQuota({dataDir,outputDir,confirmed=false,clock=()=>new Date(),fsAdapter: f=fs}){
  if(confirmed!==true)throw fail('CONFIRMATION');
  if(!path.isAbsolute(dataDir??'')||!path.isAbsolute(outputDir??''))throw fail('SCOPE');
  const now=clock().toISOString(),journal=path.join(dataDir,'jobs.json');
  async function read(file,max){const stat=await assertSafePath(file,{f});if(stat.size>max)throw fail('CONFLICT');return f.readFile(file);}
  async function optional(file,max){try{return await read(file,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  const lock=await acquireDataLock(dataDir);
  try{
    const report=JSON.parse(await read(path.join(outputDir,'cloudflare-framed-9b-result.json'),16384));
    if(report.source!=='cloudflare-free-quality-probe'||report.state!=='uncertain'||report.errorCode!=='PROVIDER_UNCERTAIN'||report.requestId!==requestId||report.file!==null||report.result!==null||report.diagnostic?.http!==429||!Array.isArray(report.diagnostic.codes)||report.diagnostic.codes.length!==1||report.diagnostic.codes[0]!==4006)throw fail('SCOPE');
    const currentBytes=await read(journal,64*1024*1024),current=validateJobSnapshot(JSON.parse(currentBytes));
    if(current.version!==2)throw fail('SCOPE');
    const backups=path.join(path.dirname(dataDir),'backups'),stem='framed-quota-'+requestId;
    await assertSafePath(backups,{directory:true,missing:true,f});
    const backupFile=path.join(backups,stem+'.before.json'),receiptFile=path.join(backups,stem+'.recovery.json');
    const savedReceipt=await optional(receiptFile,16384);
    let beforeBytes=currentBytes,confirmedAt=now,receipt;
    if(savedReceipt){
      try{receipt=JSON.parse(savedReceipt);}catch{throw fail('CONFLICT');}
      if(!exactKeys(receipt,receiptKeys)||receipt.version!==1||receipt.kind!=='operator-confirmed-quota-4006'||receipt.requestId!==requestId||receipt.coverHash!==coverHash||receipt.configHash!==configHash||!isHash(receipt.beforeHash)||!isHash(receipt.afterHash)||!isIso(receipt.confirmedAt)||!isIso(receipt.notBefore))throw fail('CONFLICT');
      beforeBytes=await read(backupFile,64*1024*1024);if(hash(beforeBytes)!==receipt.beforeHash)throw fail('CONFLICT');confirmedAt=receipt.confirmedAt;
    }
    const before=validateJobSnapshot(JSON.parse(beforeBytes));if(before.version!==2)throw fail('SCOPE');
    const binding=before.requests.find(item=>item.installationId==='pilot-quality-diuna'&&item.requestId===requestId);
    const work=binding&&before.works.find(item=>item.workId===binding.workId),attempts=work&&before.attempts.filter(item=>item.workId===work.workId),attempt=attempts?.[0];
    if(!work||work.coverHash!==coverHash||work.coverMime!=='image/jpeg'||work.configHash!==configHash||work.state!=='uncertain'||work.errorCode!=='PROVIDER_UNCERTAIN'||work.result!==null||attempts.length!==1||attempt.state!=='uncertain')throw fail('SCOPE');
    const notBefore=new Date(Date.parse(attempt.day+'T00:00:00Z')+86400000+60000).toISOString();
    if(before.lastDay>now.slice(0,10))throw fail('CONFLICT');
    // No backup, credential read, or provider call is made before the quota reset.
    if(now<notBefore)return {blocked:true,recovered:false,notBefore};
    const next=structuredClone(before),nextWork=next.works.find(item=>item.workId===work.workId),nextAttempt=next.attempts.find(item=>item.attemptId===attempt.attemptId);
    Object.assign(nextWork,{state:'queued',errorCode:'PROVIDER_QUOTA',retryAt:notBefore,updatedAt:confirmedAt});
    Object.assign(nextAttempt,{state:'refused',reason:'quota',resolvedAt:confirmedAt});
    const afterBytes=Buffer.from(JSON.stringify(validateJobSnapshot(next)));
    const planned={version:1,kind:'operator-confirmed-quota-4006',requestId,workId:work.workId,attemptId:attempt.attemptId,coverHash,configHash,beforeHash:hash(beforeBytes),afterHash:hash(afterBytes),confirmedAt,notBefore};
    if(receipt&&JSON.stringify(receiptKeys.map(key=>receipt[key]))!==JSON.stringify(receiptKeys.map(key=>planned[key])))throw fail('CONFLICT');
    if(savedReceipt&&hash(currentBytes)===planned.afterHash)return {blocked:false,recovered:false,notBefore};
    if(hash(currentBytes)!==planned.beforeHash)throw fail('CONFLICT');
    await ensureDirectory(backups,f);
    const existingBackup=await optional(backupFile,64*1024*1024);
    if(existingBackup){if(hash(existingBackup)!==planned.beforeHash)throw fail('CONFLICT');}
    else{
      const file=await f.open(backupFile,'wx');try{await file.writeFile(beforeBytes);await file.sync();}finally{await file.close();}
    }
    if(hash(await read(backupFile,64*1024*1024))!==planned.beforeHash)throw fail('CONFLICT');
    // Publish the recovery receipt first. After a crash the exact before/after
    // hashes allow finishing this transaction, never creating another attempt.
    if(!savedReceipt)await atomicWrite(receiptFile,JSON.stringify(planned,null,2),f);
    await atomicWrite(journal,afterBytes,f);
    if(hash(await read(journal,64*1024*1024))!==planned.afterHash)throw fail('CONFLICT');
    return {blocked:false,recovered:true,notBefore};
  }finally{await lock.release();}
}
