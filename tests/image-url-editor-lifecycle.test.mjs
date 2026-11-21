// Exercise the actual app callbacks in isolation; no collection or browser is used.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/manager/app.mjs',import.meta.url),'utf8');
const callback=name=>{const line=source.split('\n').find(line=>line.startsWith('function '+name+'('));assert.ok(line,'app callback '+name);return line;};
function editor(){
 const fields=new Map(),uploads=[],book={id:'a',coverId:'existing-cover'},root={};
 const context=vm.createContext({coverPicker:null,operation:0,uploading:false,editing:'a',coverId:'existing-cover',spineControls:root,aiStatus:{},state:{books:[book],revision:3},
  $:id=>{if(!fields.has(id))fields.set(id,{disabled:false,hidden:false});return fields.get(id);},
  suggestions:{cancel(){}},coverUrlImport:{cancel(){},setDisabled(){}},cancelSpineImageImport(){},
  renderSpineControls(_root,params){context.params=params;},request:async(route,body)=>uploads.push({route,body}),refresh:async()=>{},refreshAi:async()=>{}});
 vm.runInContext(['updateSpineControls','beginCoverImport','finishCoverImport','cancelEditorWork'].map(callback).join('\n'),context);
 context.updateSpineControls();return {context,uploads,book};
}
test('failed cover import preserves the cover and leaves manual spine import usable',async()=>{
 const {context,uploads,book}=editor(),obsolete=context.params,current=context.beginCoverImport();context.finishCoverImport(current);
 await obsolete.onUpload(book.id,{mime:'image/png',base64:'old'});assert.equal(uploads.length,0);
 await context.params.onUpload(book.id,{mime:'image/png',base64:'new'});assert.equal(uploads.length,1);assert.equal(uploads[0].route,'/api/spines/upload');assert.equal(context.coverId,'existing-cover');
});
test('cancelling a cover attempt refreshes the surviving editor callback',async()=>{
 const {context,uploads,book}=editor();context.beginCoverImport();context.cancelEditorWork();
 await context.params.onUpload(book.id,{mime:'image/png',base64:'new'});assert.equal(uploads.length,1);
});

