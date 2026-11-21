import * as fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import { createInitialState, validateState, applyCommand, appendImportedBooks, problem } from './domain.mjs';
import {migrateState} from './migrations.mjs';
import {bookIdentityFingerprint} from './cover-resolver.mjs';
export async function openStore(dataDir,{fsAdapter=fs,requireExisting=false}={}){
  const f=fsAdapter;await f.mkdir(dataDir,{recursive:true});const primary=path.join(dataDir,'library.json'),backup=path.join(dataDir,'library.backup.json');
  let state,recovery='none',queue=Promise.resolve(),legacyBytes=null;
  async function readFile(p){const bytes=await f.readFile(p,'utf8'),raw=JSON.parse(bytes),next=migrateState(raw);legacyBytes=raw.schemaVersion===1?bytes:null;return next;}
  async function atomic(p,bytes){const temp=p+'.'+crypto.randomUUID()+'.tmp';try{await f.writeFile(temp,bytes);for(let attempt=0;;attempt++){try{await f.rename(temp,p);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=5)throw e;await delay(40*2**attempt);}}}finally{await f.unlink(temp).catch(()=>{});}}
  try{state=await readFile(primary);}catch(err){
    try{state=await readFile(backup);recovery='backup';}catch(second){
      if(err.code==='ENOENT'&&second.code==='ENOENT'&&!requireExisting){state=createInitialState();await atomic(primary,JSON.stringify(state,null,2));}
      else{state=createInitialState();recovery='unrecoverable';}
    }
  }
  if(legacyBytes!==null&&recovery!=='unrecoverable'){const original=path.join(dataDir,'library.schema1.backup.json');try{await f.writeFile(original,legacyBytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}await atomic(primary,JSON.stringify(state,null,2));}
  function schedule(operation){const pending=queue.then(operation);queue=pending.catch(()=>{});return pending;}
  async function persist(next,expectedRevision,restore=false){
    if(recovery==='unrecoverable'&&!restore)throw problem('RECOVERY_REQUIRED','Nie można odczytać kolekcji. Przywróć poprawną kopię.');
    if(expectedRevision!==state.revision)throw problem('CONFLICT','Kolekcja zmieniła się w innym oknie. Odśwież widok.');
    const validated=validateState(next);
    if(recovery!=='unrecoverable')await atomic(backup,JSON.stringify(state,null,2));
    await atomic(primary,JSON.stringify(validated,null,2));state=validated;recovery='none';return structuredClone(state);
  }
  return {read:()=>structuredClone(state),get recovery(){return recovery;},commit:(cmd,expected)=>schedule(()=>{if(expected!==state.revision)throw problem('CONFLICT','Kolekcja zmieniła się w innym oknie.');return persist(applyCommand(state,cmd),expected);}),replace:(next,expected,expectedCollectionId)=>schedule(()=>{if(expectedCollectionId!==undefined&&expectedCollectionId!==state.collectionId)throw problem('CONFLICT','Kolekcja zmieniła się. Wczytaj kopię ponownie.');return persist({...next,collectionId:crypto.randomUUID(),revision:state.revision+1},expected,true);}),
    appendImported:(drafts,{expectedRevision,expectedCollectionId}={})=>schedule(()=>{if(expectedCollectionId!==state.collectionId||expectedRevision!==state.revision)throw problem('CONFLICT','Kolekcja zmieniła się. Wczytaj CSV ponownie.');return persist(appendImportedBooks(state,drafts),expectedRevision);}),
    attachCoverIfCurrent:({collectionId,bookId,identity},coverId)=>schedule(async()=>{
      const book=state.books.find(b=>b.id===bookId);
      if(state.collectionId!==collectionId||!book||book.coverId||book.spine||bookIdentityFingerprint(book)!==identity)return null;
      const next=structuredClone(state),updated=next.books.find(b=>b.id===bookId);updated.coverId=coverId;updated.spineGeneration++;next.revision++;
      return persist(next,state.revision);
    }),
    claimAutomaticSpine:({collectionId,bookId,coverId,expectedGeneration})=>schedule(async()=>{
      const book=state.books.find(b=>b.id===bookId);
      if(state.collectionId!==collectionId||!book||book.spine||!coverId||book.coverId!==coverId||book.spineGeneration!==expectedGeneration)return null;
      const next=structuredClone(state),updated=next.books.find(b=>b.id===bookId);updated.spineGeneration++;next.revision++;
      const saved=await persist(next,state.revision);
      return {state:saved,ticket:{collectionId,bookId,coverId,generation:updated.spineGeneration}};
    }),
    beginSpine:(bookId,{expectedRevision})=>schedule(async()=>{if(expectedRevision!==state.revision)throw problem('CONFLICT','Kolekcja zmieniła się w innym oknie.');const next=structuredClone(state),b=next.books.find(b=>b.id===bookId);if(!b)throw problem('NOT_FOUND','Nie znaleziono książki.');if(!b.coverId)throw problem('INVALID','Dodaj okładkę przed generowaniem.');b.spineGeneration++;next.revision++;const saved=await persist(next,expectedRevision);return {state:saved,ticket:{collectionId:saved.collectionId,bookId,coverId:b.coverId,generation:b.spineGeneration}};}),
    attachSpineIfCurrent:(ticket,image)=>schedule(async()=>{const b=state.books.find(b=>b.id===ticket.bookId);if(state.collectionId!==ticket.collectionId||!b||b.coverId!==ticket.coverId||b.spineGeneration!==ticket.generation)return null;const next=structuredClone(state);next.books.find(x=>x.id===ticket.bookId).spine=image;next.revision++;return persist(next,state.revision);})};
}
