import {randomUUID} from 'node:crypto';
import {problem} from '../../src/domain.mjs';
import {exactKeys,isUuid,isHash,isIso,imageTypes} from '../../src/durable-files.mjs';
import {SPINE_CONFIG} from '../../src/spine-provider.mjs';
import {validateProviderConfig,providerConfigHash} from './provider-config.mjs';

const invalid=()=>{throw problem('CORRUPT_STORE','Dziennik usługi wymaga naprawy operatora.');};
const states=['queued','generating','ready','failed','uncertain'];
export const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validInstallation=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
export function validateJobSnapshot(snapshot){
  const v1=snapshot?.version===1;
  if(!exactKeys(snapshot,v1?['version','works','requests','days','lastDay']:['version','works','requests','days','lastDay','attempts','providerPause','capacityFailures'])||![1,2].includes(snapshot.version)||!Array.isArray(snapshot.works)||!Array.isArray(snapshot.requests)||!exactKeys(snapshot.days,Object.keys(snapshot.days??{}))||(snapshot.lastDay!==null&&!isDay(snapshot.lastDay)))invalid();
  const ids=new Set(),cache=new Set(),bindings=new Set();
  for(const work of snapshot.works){
    if(!exactKeys(work,['workId','coverHash','coverMime','configHash','config','priority','state','createdAt','updatedAt','retryAt','errorCode','result'])||!isUuid(work.workId)||!isHash(work.coverHash)||!isHash(work.configHash)||!imageTypes.includes(work.coverMime)||!['interactive','backfill'].includes(work.priority)||!states.includes(work.state)||!isIso(work.createdAt)||!isIso(work.updatedAt)||(work.retryAt!==null&&!isIso(work.retryAt))||(work.errorCode!==null&&!(typeof work.errorCode==='string'&&/^[A-Z_]{1,64}$/.test(work.errorCode)))||ids.has(work.workId))invalid();
    try{validateProviderConfig(work.config);}catch{invalid();}
    if(v1&&!exactKeys(work.config,Object.keys(SPINE_CONFIG)))invalid();
    if(providerConfigHash(work.config)!==work.configHash)invalid();
    const key=work.coverHash+work.configHash;if(cache.has(key))invalid();cache.add(key);ids.add(work.workId);
    if(work.state==='ready'){
      const r=work.result;if(!exactKeys(r,['assetId','mime','size','model','promptVersion'])||!isHash(r.assetId)||!imageTypes.includes(r.mime)||!Number.isSafeInteger(r.size)||r.size<=0||r.size>5*1024*1024||r.model!==work.config.model||r.promptVersion!==work.config.promptVersion)invalid();
    }else if(work.result!==null)invalid();
  }
  for(const request of snapshot.requests){
    if(!exactKeys(request,['installationId','requestId','workId'])||!validInstallation(request.installationId)||!isUuid(request.requestId)||!ids.has(request.workId))invalid();
    const key=request.installationId+':'+request.requestId;if(bindings.has(key))invalid();bindings.add(key);
  }
  const indexed=new Map();
  for(const [day,record] of Object.entries(snapshot.days)){
    const key=v1?'workIds':'attemptIds';
    if(!isDay(day)||!exactKeys(record,['attempts',key])||!Number.isSafeInteger(record.attempts)||record.attempts<0||record.attempts>10||!Array.isArray(record[key])||record.attempts!==record[key].length||snapshot.lastDay===null||day>snapshot.lastDay)invalid();
    for(const id of record[key]){if(!isUuid(id)||indexed.has(id)||(v1&&!ids.has(id)))invalid();indexed.set(id,day);}
  }
  if(v1)return snapshot;
  const pause=snapshot.providerPause;
  if(pause!==null&&(!exactKeys(pause,['kind','retryAt'])||!['quota','capacity','authorization'].includes(pause.kind)||(pause.kind==='authorization'?pause.retryAt!==null:!isIso(pause.retryAt))))invalid();
  if(!Number.isSafeInteger(snapshot.capacityFailures)||snapshot.capacityFailures<0||!Array.isArray(snapshot.attempts)||snapshot.attempts.length!==indexed.size)invalid();
  const seen=new Set(),latest=new Map();
  for(const attempt of snapshot.attempts){
    if(!exactKeys(attempt,['attemptId','workId','day','state','reason','createdAt','resolvedAt'])||!isUuid(attempt.attemptId)||seen.has(attempt.attemptId)||!ids.has(attempt.workId)||!isDay(attempt.day)||indexed.get(attempt.attemptId)!==attempt.day||!['started','ready','failed','uncertain','refused'].includes(attempt.state)||!isIso(attempt.createdAt)||(attempt.state==='started'?attempt.resolvedAt!==null:!isIso(attempt.resolvedAt))||(attempt.state==='refused'?!['quota','capacity','authorization'].includes(attempt.reason):attempt.reason!==null))invalid();
    const previous=latest.get(attempt.workId);if(previous&&(previous.state!=='refused'||previous.day>attempt.day))invalid();
    seen.add(attempt.attemptId);latest.set(attempt.workId,attempt);
  }
  for(const work of snapshot.works){
    const last=latest.get(work.workId);
    if(work.state==='generating'&&last?.state!=='started')invalid();
    if(last?.state==='started'&&work.state!=='generating')invalid();
    if(last&&((last.state==='ready'&&work.state!=='ready')||(last.state==='failed'&&work.state!=='failed')||(last.state==='uncertain'&&!['uncertain','failed'].includes(work.state))||(last.state==='refused'&&!['queued','failed','uncertain'].includes(work.state))))invalid();
  }
  return snapshot;
}
export function migrateJobSnapshotV1(snapshot,{now}){
  validateJobSnapshot(snapshot);if(snapshot.version!==1)invalid();
  const next=structuredClone(snapshot),byId=new Map(next.works.map(work=>[work.workId,work]));
  Object.assign(next,{version:2,attempts:[],providerPause:null,capacityFailures:0,days:{}});
  for(const [day,record] of Object.entries(snapshot.days).sort(([a],[b])=>a.localeCompare(b))){
    const attemptIds=[];
    for(const id of record.workIds){
      const work=byId.get(id),attemptId=randomUUID();attemptIds.push(attemptId);
      const state=['ready','failed','uncertain'].includes(work.state)?work.state:'uncertain';
      next.attempts.push({attemptId,workId:id,day,state,reason:null,createdAt:day+'T00:00:00.000Z',resolvedAt:now.toISOString()});
      if(['queued','generating'].includes(work.state))Object.assign(work,{state:'uncertain',errorCode:'INTERRUPTED',retryAt:null,updatedAt:now.toISOString()});
    }
    next.days[day]={attempts:record.attempts,attemptIds};
  }
  for(const work of next.works)if(work.state==='generating')Object.assign(work,{state:'uncertain',errorCode:'INTERRUPTED',retryAt:null,updatedAt:now.toISOString()});
  return validateJobSnapshot(next);
}
