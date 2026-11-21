import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createInitialState,applyCommand,validateState,appendImportedBooks} from '../src/domain.mjs';
import {createBackup,validateBackup} from '../src/backup.mjs';
const draft=(patch={})=>({title:'Nowa',authors:['Autor'],isbn:null,goodreadsId:null,publisher:null,publicationYear:null,pageCount:null,status:'read',readDate:'2024-02-29',subjects:['biography'],provider:null,providerId:null,language:null,coverId:null,palette:[],spineStyle:0,spine:null,spineGeneration:0,shelfId:'other',newShelfName:null,...patch});
const fixture=()=>applyCommand(createInitialState(),{type:'addBook',draft:{title:'Ręczna',authors:['Własny autor'],shelfId:'fantasy',status:'reading',provider:'openlibrary',providerId:'/books/OL123M',subjects:['fantasy']}});
test('Goodreads ID is additive, immutable to ordinary edits and bounded as a digit string',()=>{
 const old=fixture();delete old.books[0].goodreadsId;const copy=structuredClone(old);assert.equal(validateState(old).books[0].goodreadsId,null);assert.deepEqual(old,copy);
 for(const value of ['1','0','1'.repeat(32)]){const s=structuredClone(old);s.books[0].goodreadsId=value;assert.equal(validateState(s).books[0].goodreadsId,value);assert.equal(applyCommand(s,{type:'updateBook',id:s.books[0].id,patch:{title:'Poprawiona'}}).books[0].goodreadsId,value);}
 for(const value of [12,'x','1'.repeat(33),' 1 ']){const s=structuredClone(old);s.books[0].goodreadsId=value;assert.throws(()=>validateState(s),{code:'INVALID'});}
 const s=fixture();s.books[0].goodreadsId='1';s.books.push({...s.books[0],id:'another',providerId:null});assert.throws(()=>validateState(s),{code:'INVALID'});
});
test('append creates/reuses one shelf, preserves existing books/settings/identity and increments once',()=>{
 let before=fixture();before.books[0].order=10;before=applyCommand(before,{type:'setRoomLayout',roomId:'green-library',layout:{enabled:true,cavities:{'green-top-left':{source:{kind:'shelf',id:'fantasy'},decoration:'plant'}},placements:{[before.books[0].id]:{slotId:'green-top-left',order:0}}}});
 const snapshot=structuredClone(before),next=appendImportedBooks(before,[draft({title:'A',goodreadsId:'1',shelfId:null,newShelfName:'Biografie'}),draft({title:'B',goodreadsId:'2',shelfId:null,newShelfName:' biografie '}),draft({title:'C',shelfId:'fantasy'})]);
 assert.deepEqual(before,snapshot);assert.equal(next.collectionId,before.collectionId);assert.equal(next.revision,before.revision+1);assert.deepEqual(next.settings,before.settings);assert.deepEqual(next.books[0],before.books[0]);assert.equal(next.shelves.length,before.shelves.length+1);assert.equal(next.books[1].shelfId,next.books[2].shelfId);assert.deepEqual(next.books.slice(1).map(b=>b.order),[0,1,11]);assert.equal(new Set(next.books.map(b=>b.id)).size,4);
 for(const b of next.books.slice(1)){assert.equal(b.coverId,null);assert.equal(b.spine,null);assert.equal(b.spineGeneration,0);assert.deepEqual(b.palette,[]);assert.equal(b.readDate,'2024-02-29');}
});
test('any invalid draft rejects the whole append and cannot replace reserved book fields',()=>{
 const state=fixture(),copy=structuredClone(state);
 for(const drafts of [[],[draft(),draft({title:''})],[draft({shelfId:'missing'})],[draft({shelfId:null})],[draft({newShelfName:'Nowa'})],[draft({status:'invalid'})],[draft({id:state.books[0].id})],[draft({coverId:'a'.repeat(64)})],[draft({spine:{kind:'manual',assetId:'a'.repeat(64)}})]]){assert.throws(()=>appendImportedBooks(state,drafts),{code:'INVALID'});assert.deepEqual(state,copy);}
 assert.throws(()=>applyCommand(state,{type:'appendImported',drafts:[draft()]}),{code:'INVALID'});
});
test('append rejects canonical ISBN/Goodreads/text duplicates and keeps distinct identified editions',()=>{
 const state=fixture();state.books[0].isbn='0140328726';state.books[0].goodreadsId='1';
 for(const patch of [{isbn:'9780140328721'},{goodreadsId:'1'},{title:state.books[0].title,authors:state.books[0].authors}])assert.throws(()=>appendImportedBooks(state,[draft(patch)]),{code:'DUPLICATE'});
 const next=appendImportedBooks(state,[draft({title:state.books[0].title,authors:state.books[0].authors,isbn:'9780553386790',goodreadsId:'2'})]);assert.equal(next.books.length,2);
 assert.throws(()=>appendImportedBooks(state,[draft({title:'A',goodreadsId:'2'}),draft({title:'B',goodreadsId:'2'})]),{code:'DUPLICATE'});
});
test('historical ISBN10/13 pair stays readable but cannot be imported again',()=>{
 const state=fixture();state.books[0].isbn='0140328726';state.books.push({...state.books[0],id:'legacy-pair',isbn:'9780140328721',providerId:null,order:1});assert.equal(validateState(state).books.length,2);assert.throws(()=>appendImportedBooks(state,[draft({isbn:'9780140328721'})]),{code:'DUPLICATE'});
});
test('append checks total book/shelf caps before changing previous state',()=>{
 const state=fixture();state.books=Array.from({length:10000},(_,i)=>({...state.books[0],id:'b'+i,title:'T'+i,providerId:null,order:i}));assert.throws(()=>appendImportedBooks(state,[draft()]),{code:'TOO_LARGE'});assert.equal(state.books.length,10000);
 const shelves=fixture();shelves.shelves=Array.from({length:200},(_,i)=>({id:i===0?'fantasy':'s'+i,name:'Półka '+i,order:i}));assert.throws(()=>appendImportedBooks(shelves,[draft({shelfId:null,newShelfName:'Nowa półka'})]),{code:'TOO_LARGE'});assert.equal(shelves.shelves.length,200);
});
test('full backup retains Goodreads ID and existing manual cover/spine/metadata/layout',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=','base64'),hash=createHash('sha256').update(png).digest('hex'),state=fixture();state.books[0].goodreadsId='12345678901234567890123456789012';state.books[0].coverId=hash;state.books[0].spine={kind:'manual',assetId:hash,sourceCoverId:hash,model:null,promptVersion:null};
 const before=validateState(state),next=appendImportedBooks(before,[draft({goodreadsId:'2'})]);assert.deepEqual(next.books[0],before.books[0]);const images={read:async()=>({bytes:png,mime:'image/png'})};const restored=validateBackup(await createBackup(next,images,images));assert.deepEqual(restored.state,next);
});
