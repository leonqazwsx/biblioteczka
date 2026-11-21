import {problem} from './domain.mjs';
import {parseGoodreadsCsv,proposeGoodreadsCategory} from './goodreads-csv.mjs';
import {createBookIdentityIndex} from '../public/shared/book-identity.mjs';
const invalid=message=>{throw problem('INVALID',message);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function createGoodreadsImports({store,now=Date.now}){
 const entries=new Map();
 function preview(bytes){
  const parsed=parseGoodreadsCsv(bytes),state=store.read(),timestamp=now();
  for(const [id,entry]of entries)if(!entry.busy&&entry.expiresAt<=timestamp)entries.delete(id);
  if(entries.size>=3){const idle=[...entries].find(([,entry])=>!entry.busy);if(!idle)throw problem('CONFLICT','Inne importy są zapisywane. Spróbuj ponownie.');entries.delete(idle[0]);}
  const existing=createBookIdentityIndex(state.books),within=createBookIdentityIndex(),byId=new Map(),newShelves=new Set();
  const rows=parsed.records.map(row=>{
   let duplicate=null,category=null,candidate=null;
   if(row.candidate){
    const collectionMatch=existing.find(row.candidate),fileMatch=within.find(row.candidate);
    if(collectionMatch)duplicate={kind:'collection',...collectionMatch};else if(fileMatch)duplicate={kind:'file',...fileMatch,recordNumber:byId.get(fileMatch.id).recordNumber};
    category=proposeGoodreadsCategory(row.candidate.subjects,state.shelves);candidate={...row.candidate,...category};
    if(!duplicate&&candidate.status==='read')within.add({...candidate,id:row.rowId});
    if(!duplicate&&candidate.status==='read'&&category.newShelfName)newShelves.add(category.newShelfName.toLocaleLowerCase('pl'));
   }
   const skipped=!!candidate&&candidate.status!=='read';
   const result={...row,warnings:skipped?[...row.warnings,'Pominięto książkę bez oznaczenia przeczytania w Goodreads.']:row.warnings,candidate,category,duplicate,selectable:!!candidate&&!duplicate&&!skipped};byId.set(row.rowId,result);return result;
  });
  const importId=crypto.randomUUID(),expiresAt=timestamp+600000,summary={total:rows.length,addable:rows.filter(r=>r.selectable).length,duplicates:rows.filter(r=>r.duplicate).length,invalid:rows.filter(r=>!r.candidate).length,skipped:rows.filter(r=>r.candidate&&r.candidate.status!=='read').length,warningRows:rows.filter(r=>r.warnings.length).length,newShelves:newShelves.size};
  const response={importId,collectionId:state.collectionId,revision:state.revision,expiresAt,summary,rows,notices:parsed.notices};
  entries.set(importId,{...response,byId,busy:false});return structuredClone(response);
 }
 async function confirm(input){
  if(!object(input)||Object.keys(input).some(k=>!['importId','expectedRevision','selectedRowIds','overrides'].includes(k)))invalid('Nieprawidłowe potwierdzenie importu.');
  const entry=typeof input.importId==='string'?entries.get(input.importId):null;
  if(!entry)invalid('Podgląd CSV wygasł. Wczytaj plik ponownie.');
  if(entry.busy)throw problem('CONFLICT','Ten import jest już zapisywany.');
  if(entry.expiresAt<=now()){entries.delete(input.importId);invalid('Podgląd CSV wygasł. Wczytaj plik ponownie.');}
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)invalid('Nieprawidłowa wersja podglądu.');
  const current=store.read();if(input.expectedRevision!==entry.revision||current.revision!==entry.revision||current.collectionId!==entry.collectionId)throw problem('CONFLICT','Kolekcja zmieniła się. Wczytaj CSV ponownie.');
  const selected=input.selectedRowIds,overrides=input.overrides??{};
  if(!Array.isArray(selected)||!selected.length||selected.length>10000||selected.some(id=>typeof id!=='string')||new Set(selected).size!==selected.length)invalid('Wybierz poprawne książki do dołączenia.');
  const selectedSet=new Set(selected);if(!object(overrides)||Object.keys(overrides).some(id=>!selectedSet.has(id)))invalid('Nieprawidłowe zmiany importu.');
  const drafts=selected.map(id=>{
   const row=entry.byId.get(id);if(!row?.selectable)invalid('Pozycja nie może zostać dołączona.');
   if(!Object.hasOwn(overrides,id))return structuredClone(row.candidate);
   const patch=overrides[id];if(!object(patch)||Object.keys(patch).some(k=>!['status','shelfId','newShelfName'].includes(k))||patch.status!==undefined&&patch.status!=='read')invalid('Wybierz gatunek przeczytanej książki.');
   const hasShelf=typeof patch.shelfId==='string'&&!!patch.shelfId,hasNew=typeof patch.newShelfName==='string'&&!!patch.newShelfName.trim();
   if(hasShelf===hasNew||patch.shelfId!=null&&!hasShelf||patch.newShelfName!=null&&!hasNew||hasShelf&&!current.shelves.some(s=>s.id===patch.shelfId)||hasNew&&patch.newShelfName.trim().length>100)invalid('Wybierz jedną istniejącą lub nową półkę.');
   return {...structuredClone(row.candidate),status:'read',shelfId:hasShelf?patch.shelfId:null,newShelfName:hasNew?patch.newShelfName.trim():null};
  });
  entry.busy=true;
  try{const result=await store.appendImported(drafts,{expectedRevision:entry.revision,expectedCollectionId:entry.collectionId});entries.delete(input.importId);return result;}
  catch(error){entry.busy=false;throw error;}
 }
 return {preview,confirm};
}
