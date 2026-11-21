import test from 'node:test';import assert from 'node:assert/strict';import {createInitialState,applyCommand,validateState} from '../src/domain.mjs';import {createBackup,validateBackup} from '../src/backup.mjs';
function fixture(){let s=createInitialState();for(const title of ['A','B'])s=applyCommand(s,{type:'addBook',draft:{title,authors:['Reader'],shelfId:'fantasy',status:'read'}});return s;}
const layout=(id,slot='green-top-left')=>({enabled:true,cavities:{[slot]:{source:{kind:'shelf',id:'fantasy'},decoration:'plant'}},placements:{[id]:{slotId:slot,order:0}}});
const save=(s,roomId,value)=>applyCommand(s,{type:'setRoomLayout',roomId,layout:value});
test('older collections default to an empty room layout without mutating their stored state',()=>{
 const old=fixture();delete old.settings.roomLayouts;const copy=structuredClone(old),next=validateState(old);assert.deepEqual(next.settings.roomLayouts,{});assert.deepEqual(old,copy);assert.equal(next.revision,copy.revision);
});
test('saving one room retains the other room and changing room/status/category retains book placements',()=>{
 const old=fixture(),original=structuredClone(old),id=old.books[0].id;let s=save(old,'green-library',layout(id));s=save(s,'oak-library',layout(id,'oak-top-left'));const green=structuredClone(s.settings.roomLayouts['green-library']);
 s=save(s,'oak-library',{enabled:false,cavities:{},placements:{}});assert.deepEqual(s.settings.roomLayouts['green-library'],green);assert.deepEqual(old,original);
 s=applyCommand(s,{type:'updateSettings',patch:{room:'green-library'}});s=applyCommand(s,{type:'updateBook',id,patch:{shelfId:'crime',status:'reading'}});assert.deepEqual(s.settings.roomLayouts['green-library'].placements[id],{slotId:'green-top-left',order:0});
});
test('invalid layout references and geometry are rejected before changing collection state',()=>{
 const s=fixture(),before=structuredClone(s),id=s.books[0].id,valid=layout(id);
 const cases=[['unknown-room',valid],['green-library',{...valid,enabled:'yes'}],['green-library',{...valid,cavities:{'oak-top-left':valid.cavities['green-top-left']}}],['green-library',{...valid,placements:{missing:{slotId:'green-top-left',order:0}}}],['green-library',{...valid,placements:{[id]:{slotId:'oak-top-left',order:0}}}],['green-library',{...valid,placements:{[id]:{slotId:'green-top-left',order:-1}}}],['green-library',{...valid,placements:{[id]:{slotId:'green-top-left',order:.5}}}],['green-library',{...valid,cavities:{'green-top-left':{source:{kind:'shelf',id:'missing'},decoration:null}}}],['green-library',{...valid,cavities:{'green-top-left':{source:{kind:'status',id:'unfinished'},decoration:null}}}],['green-library',{...valid,cavities:{'green-top-left':{source:null,decoration:'chair'}}}],['green-library',{...valid,unexpected:true}]];
 for(const [roomId,value]of cases){assert.throws(()=>save(s,roomId,value),{code:'INVALID'});assert.deepEqual(s,before);}
});
test('deleting a book clears its placements from every room and retains remaining placements',()=>{
 let s=fixture();const [a,b]=s.books;s=save(s,'green-library',{...layout(a.id),placements:{[a.id]:{slotId:'green-top-left',order:0},[b.id]:{slotId:'green-top-left',order:1}}});s=save(s,'oak-library',layout(a.id,'oak-top-left'));
 s=applyCommand(s,{type:'deleteBook',id:a.id});assert.deepEqual(Object.keys(s.settings.roomLayouts['green-library'].placements),[b.id]);assert.deepEqual(s.settings.roomLayouts['oak-library'].placements,{});assert.equal(s.books[0].id,b.id);
});
test('deleting a category clears its cavity sources while retaining books and manual placement',()=>{
 let s=fixture();const id=s.books[0].id;s=save(s,'green-library',layout(id));s=applyCommand(s,{type:'deleteShelf',id:'fantasy',targetId:'other'});
 assert.deepEqual(s.settings.roomLayouts['green-library'].cavities['green-top-left'],{source:null,decoration:null});assert.deepEqual(s.settings.roomLayouts['green-library'].placements[id],{slotId:'green-top-left',order:0});assert.equal(s.books.length,2);assert.ok(s.books.every(b=>b.shelfId==='other'));
});
test('legacy status sources are cleared while disabled configuration and placements survive export/import',async()=>{
 let s=fixture(),id=s.books[0].id;const value={enabled:false,cavities:{'green-top-left':{source:{kind:'status',id:'read'},decoration:'vase'}},placements:{[id]:{slotId:'green-top-left',order:3}}};s=save(s,'green-library',value);
 const backup=await createBackup(s,null,null);assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))).state.settings.roomLayouts,{'green-library':{...value,cavities:{'green-top-left':{source:null,decoration:null}}}});
});
test('room selection accepts a string rather than coercing an array into a valid room',()=>{
 const s=fixture();assert.throws(()=>save(s,['green-library'],layout(s.books[0].id)),{code:'INVALID'});
});
