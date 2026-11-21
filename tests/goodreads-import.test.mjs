import {completedCsv} from './helpers/completed-csv.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {openStore} from '../src/store.mjs';import {createGoodreadsImports} from '../src/goodreads-import.mjs';
const csv=title=>completedCsv('Title,Author,Book Id,Bookshelves,Exclusive Shelf,Date Read,Private Notes\n'+title+',Autor,1,biography,read,2024/02/29,PRIVATE_SECRET\n');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'goodreads-import-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=await openStore(dir);return {dir,store};}
const input=(p,extra={})=>({importId:p.importId,expectedRevision:p.revision,selectedRowIds:p.rows.filter(r=>r.selectable).map(r=>r.rowId),overrides:{},...extra});
test('preview captures identity/revision and marks collection/file duplicates and row errors',async t=>{
 const {store}=await fixture(t);await store.commit({type:'addBook',draft:{title:'Istniejąca',authors:['Autor'],isbn:'0140328726',shelfId:'other',status:'read'}},0);const before=store.read(),service=createGoodreadsImports({store,now:()=>100});
 const p=service.preview(completedCsv('Title,Author,ISBN13,Book Id,Bookshelves,Private Notes\nNowa,Autor,,1,biography,SECRET\nInna,Autor,9780140328721,2,,SECRET\nPowtórka,Autor,,1,,SECRET\n,Autor,,3,,SECRET\n'));
 assert.equal(p.collectionId,before.collectionId);assert.equal(p.revision,1);assert.equal(p.expiresAt,600100);assert.deepEqual(p.summary,{total:4,addable:1,duplicates:2,invalid:1,skipped:0,warningRows:0,newShelves:1});assert.deepEqual(p.rows[0].category,{shelfId:null,newShelfName:'Biografie'});assert.equal(p.rows[1].duplicate.kind,'collection');assert.equal(p.rows[1].duplicate.id,before.books[0].id);assert.equal(p.rows[2].duplicate.kind,'file');assert.equal(p.rows[2].duplicate.recordNumber,1);assert.equal(p.rows[3].candidate,null);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.deepEqual(store.read(),before);
});
test('confirm selected server candidates plus category overrides appends once without raw fields',async t=>{
 const {store}=await fixture(t),service=createGoodreadsImports({store});const p=service.preview(csv('Nowa'));
 const next=await service.confirm(input(p,{overrides:{[p.rows[0].rowId]:{status:'read',shelfId:'fantasy',newShelfName:null}}}));assert.equal(next.books.length,1);assert.equal(next.books[0].status,'read');assert.equal(next.books[0].shelfId,'fantasy');assert.equal(next.books[0].readDate,'2024-02-29');assert.equal(next.books[0].goodreadsId,'1');assert.ok(!JSON.stringify(next).includes('PRIVATE_SECRET'));
 await assert.rejects(()=>service.confirm(input(p)),{code:'INVALID'});const reread=service.preview(csv('Nowa'));assert.equal(reread.summary.duplicates,1);assert.equal(reread.summary.addable,0);
});
test('invalid selections and arbitrary overrides never write or consume a valid preview',async t=>{
 const {store}=await fixture(t),service=createGoodreadsImports({store}),p=service.preview(completedCsv('Title,Author\nA,B\nA,B\n,B\n')),row=p.rows[0].rowId;
 const bad=[{selectedRowIds:[]},{selectedRowIds:[row,row]},{selectedRowIds:['missing']},{selectedRowIds:[p.rows[1].rowId]},{selectedRowIds:[p.rows[2].rowId]},{books:[]},{expectedRevision:'0'},{overrides:{missing:{status:'read',shelfId:'other'}}},{overrides:{[row]:{status:'wrong',shelfId:'other'}}},{overrides:{[row]:{status:'read',shelfId:'missing'}}},{overrides:{[row]:{status:'read',shelfId:'other',newShelfName:'New'}}},{overrides:{[row]:{status:'read'}}},{overrides:{[row]:{status:'read',shelfId:'other',title:'Injected'}}},{overrides:[]},{selectedRowIds:'bad'}];
 for(const patch of bad){await assert.rejects(()=>service.confirm(input(p,patch)),{code:'INVALID'});assert.equal(store.read().revision,0);}
 assert.equal((await service.confirm(input(p))).books.length,1);
});
test('any edit or collection replacement conflicts without implicit rebase',async t=>{
 const {store}=await fixture(t),service=createGoodreadsImports({store}),p=service.preview(csv('Nowa'));await store.commit({type:'updateSettings',patch:{theme:'dark'}},0);await assert.rejects(()=>service.confirm(input(p)),{code:'CONFLICT'});await assert.rejects(()=>service.confirm(input(p,{expectedRevision:1})),{code:'CONFLICT'});
 const state=store.read(),proxy={read:()=>({...state,collectionId:'different'}),appendImported:()=>{throw new Error('Must not write');}},other=createGoodreadsImports({store:{...proxy,read:()=>state}}),q=other.preview(csv('Nowa'));proxy.read=()=>({...state,collectionId:'different'});
 let replacement=state;const mutable=createGoodreadsImports({store:{read:()=>replacement,appendImported:proxy.appendImported}}),r=mutable.preview(csv('Nowa'));replacement={...state,collectionId:'different'};await assert.rejects(()=>mutable.confirm(input(r)),{code:'CONFLICT'});assert.equal(q.revision,state.revision);
});
test('expiry at ten minutes rejects and a fourth idle preview evicts the oldest',async t=>{
 const {store}=await fixture(t);let now=0;const service=createGoodreadsImports({store,now:()=>now}),p=service.preview(csv('A'));now=600000;await assert.rejects(()=>service.confirm(input(p)),{code:'INVALID'});
 now=0;const previews=['A','B','C','D'].map(title=>service.preview(csv(title)));await assert.rejects(()=>service.confirm(input(previews[0])),{code:'INVALID'});assert.equal((await service.confirm(input(previews[3]))).books[0].title,'D');
});
test('busy entries cannot be evicted or expired; simultaneous same confirm writes once',async t=>{
 const {store}=await fixture(t);let release,now=0,calls=0;const gate=new Promise(r=>release=r),proxy={read:store.read,appendImported:async(...args)=>{calls++;await gate;return store.appendImported(...args);}},service=createGoodreadsImports({store:proxy,now:()=>now});
 const p=service.preview(csv('A')),first=service.confirm(input(p));await assert.rejects(()=>service.confirm(input(p)),{code:'CONFLICT'});assert.equal(calls,1);
 const q=service.preview(csv('B')),r=service.preview(csv('C'));const second=service.confirm(input(q)),third=service.confirm(input(r)),all=Promise.allSettled([first,second,third]);now=700000;assert.throws(()=>service.preview(csv('D')),{code:'CONFLICT'});release();const results=await all;assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.read().books.length,1);assert.equal(store.read().revision,1);
});
test('failed persistence retains preview, while lost successful response is recognized on reread',async t=>{
 const {store}=await fixture(t);let fail=true;const service=createGoodreadsImports({store:{read:store.read,appendImported:async(...args)=>{if(fail)throw Object.assign(new Error('disk'),{code:'EIO'});return store.appendImported(...args);}}}),p=service.preview(csv('A'));
 await assert.rejects(()=>service.confirm(input(p)),{code:'EIO'});assert.equal(store.read().books.length,0);fail=false;await service.confirm(input(p));const q=service.preview(csv('A'));assert.equal(q.rows[0].selectable,false);assert.equal(q.rows[0].duplicate.kind,'collection');
});
test('10000 actual records preview and append in an isolated store once',async t=>{
 const {store,dir}=await fixture(t),service=createGoodreadsImports({store}),source=completedCsv('Title,Author,Book Id,Bookshelves\n'+Array.from({length:10000},(_,i)=>`Tytuł ${i},Autor,${i+1},fantasy`).join('\n'));const start=performance.now(),preview=service.preview(source),previewMs=performance.now()-start;assert.equal(preview.summary.addable,10000);const next=await service.confirm(input(preview));assert.equal(next.books.length,10000);assert.equal(next.revision,1);assert.equal((await openStore(dir)).read().books.length,10000);console.log(JSON.stringify({goodreadsStress:{records:10000,previewMs,totalMs:performance.now()-start,revision:next.revision}}));
});
test('excluded identifierless duplicates do not exclude a later distinct identified edition',async t=>{
 const {store}=await fixture(t),service=createGoodreadsImports({store}),source=completedCsv('Title,Author,ISBN,Book Id\nMatylda,Autor,0140328726,1\nMatylda,Autor,,\nMatylda,Autor,9780553386790,2\n');
 const p=service.preview(source);assert.deepEqual(p.rows.map(r=>r.selectable),[true,false,true]);assert.equal(p.rows[1].duplicate.recordNumber,1);const saved=await service.confirm(input(p));assert.equal(saved.books.length,2);assert.deepEqual(saved.books.map(b=>b.goodreadsId),['1','2']);
});
test('rows matching an existing edition cannot poison a new distinct edition',async t=>{
 const {store}=await fixture(t);await store.commit({type:'addBook',draft:{title:'Matylda',authors:['Autor'],isbn:'0140328726',goodreadsId:'1',shelfId:'other',status:'read'}},0);const before=store.read(),service=createGoodreadsImports({store}),p=service.preview(completedCsv('Title,Author,ISBN,Book Id\nMatylda,Autor,0140328726,1\nMatylda,Autor,,\nMatylda,Autor,9780553386790,2\n'));
 assert.deepEqual(p.rows.map(r=>r.selectable),[false,false,true]);assert.ok(p.rows.slice(0,2).every(r=>r.duplicate.kind==='collection'));const next=await service.confirm(input(p));assert.equal(next.books.length,2);assert.deepEqual(next.books[0],before.books[0]);assert.equal(next.books[1].goodreadsId,'2');
});
