import test from 'node:test';import assert from 'node:assert/strict';
import {createGoodreadsImportController} from '../public/manager/goodreads-import-controller.mjs';import {importState,importPreview} from './helpers/goodreads-preview.mjs';
async function setup(preview=importPreview(),options={}){const calls=[],c=createGoodreadsImportController({request:async(route,input)=>{calls.push({route,input});return route.endsWith('preview')?structuredClone(preview):{...importState(),revision:8};},...options});c.receive(importState());await c.load('QSwK');return {c,calls};}
test('controller selects only valid new rows across all pages and preserves choices/overrides',async()=>{
 const p=importPreview();p.rows.push({...p.rows[0],rowId:'duplicate',selectable:false,duplicate:{kind:'file'}},{...p.rows[0],rowId:'invalid',selectable:false,candidate:null,errors:['Błąd']});const {c}=await setup(p);
 assert.equal(c.snapshot.selectedRowIds.length,101);assert.equal(c.snapshot.pageCount,3);assert.equal(c.snapshot.rows.length,50);c.select('row49',false);c.override('row50',{status:'read',shelfId:'fantasy',newShelfName:null});c.setPage(1);assert.equal(c.snapshot.rows[0].rowId,'row50');assert.equal(c.snapshot.overrides.row50.status,'read');c.setPage(0);assert.equal(c.snapshot.selectedRowIds.includes('row49'),false);
 assert.throws(()=>c.select('invalid',true));assert.throws(()=>c.override('duplicate',{status:'read'}));c.selectAll(false);assert.equal(c.snapshot.selectedRowIds.length,0);c.setPage(2);c.selectAll(true);assert.equal(c.snapshot.selectedRowIds.length,101);assert.equal(c.isDirty,true);
});
test('confirm carries captured revision and only overrides for selected rows, then clears draft',async()=>{
 let imported,dirty=[];const {c,calls}=await setup(importPreview(2),{onImported:s=>imported=s,onDirtyChange:value=>dirty.push(value)});c.override('row0',{status:'read',shelfId:'fantasy',newShelfName:null});c.override('row1',{status:'read',shelfId:'other',newShelfName:null});c.select('row1',false);const next=await c.confirm();assert.equal(next.revision,8);assert.equal(imported.revision,8);
 assert.deepEqual(calls[1],{route:'/api/goodreads/confirm',input:{method:'POST',body:{importId:'preview',expectedRevision:7,selectedRowIds:['row0'],overrides:{row0:{status:'read',shelfId:'fantasy',newShelfName:null}}}}});assert.equal(c.isDirty,false);assert.equal(c.snapshot.preview,null);assert.equal(dirty.at(-1),false);
});
test('saving locks every mutation and failed save preserves choices for review',async()=>{
 let reject,started;const begin=new Promise(r=>started=r);const {c}=await setup(importPreview(2),{request:async route=>route.endsWith('preview')?importPreview(2):(started(),new Promise((_,r)=>reject=r))});const pending=c.confirm();await begin;assert.equal(c.saving,true);
 for(const action of [()=>c.select('row0',false),()=>c.selectAll(false),()=>c.override('row0',{status:'read'}),()=>c.setPage(0),()=>c.discard()])assert.throws(action);
 reject(Object.assign(new Error('Kolekcja zmieniła się'),{code:'CONFLICT'}));await assert.rejects(()=>pending,{code:'CONFLICT'});assert.equal(c.saving,false);assert.equal(c.isDirty,true);assert.equal(c.stale,true);assert.equal(c.snapshot.selectedRowIds.length,2);
});
test('any revision or same-revision collection replacement invalidates without rebasing',async()=>{
 for(const next of [{...importState(),revision:8},{...importState(),collectionId:'replaced'}]){const {c,calls}=await setup(importPreview(1));c.receive(next);assert.equal(c.stale,true);assert.equal(c.snapshot.preview.revision,7);assert.equal(c.snapshot.selectedRowIds[0],'row0');await assert.rejects(()=>c.confirm());assert.equal(calls.length,1);c.discard();assert.equal(c.isDirty,false);}
});
test('failed new read retains previous draft and unknown save result asks to check collection',async()=>{
 let calls=0;const {c}=await setup(importPreview(1),{request:async route=>{calls++;if(calls===1)return importPreview(1);if(route.endsWith('preview'))throw new Error('Błędny plik');throw new Error('Brak odpowiedzi');}});await assert.rejects(()=>c.load('bad'));assert.equal(c.isDirty,true);assert.equal(c.snapshot.selectedRowIds.length,1);await assert.rejects(()=>c.confirm());assert.match(c.snapshot.message,/sprawdź.*kolekcj/i);assert.equal(c.isDirty,true);
});
test('expired preview and zero selection do not send a confirmation',async()=>{
 let now=0;const p=importPreview(1);p.expiresAt=600000;const {c,calls}=await setup(p,{now:()=>now});c.selectAll(false);await assert.rejects(()=>c.confirm());assert.equal(calls.length,1);c.selectAll(true);now=600000;assert.equal(c.stale,true);await assert.rejects(()=>c.confirm());assert.equal(calls.length,1);assert.equal(c.isDirty,true);
});
