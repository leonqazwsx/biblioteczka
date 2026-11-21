import test from 'node:test';import assert from 'node:assert/strict';
import {createGoodreadsImportPanel,readGoodreadsFile} from '../public/manager/goodreads-import-panel.mjs';import {importDom} from './helpers/import-dom.mjs';import {importState,importPreview} from './helpers/goodreads-preview.mjs';
const pick=(root,tag,label)=>root.querySelectorAll(tag).find(n=>n.getAttribute('aria-label')===label);
async function panel(t,preview=importPreview()){
 const {doc,root}=importDom(),previousDocument=globalThis.document,previousConfirm=globalThis.confirm;globalThis.document=doc;globalThis.confirm=()=>true;t.after(()=>{globalThis.document=previousDocument;globalThis.confirm=previousConfirm;});let reads=0;
 const handle=createGoodreadsImportPanel({request:async route=>{reads++;return route.endsWith('preview')?structuredClone(preview):{...importState(),revision:8};},onImported(){},onDirtyChange(){},notice(){}});handle.mount(root,importState());
 const file=pick(root,'input','Plik Goodreads CSV');file.files=[{size:3,arrayBuffer:async()=>Uint8Array.from([65,44,66]).buffer}];await file.onchange();return {doc,root,handle,reads:()=>reads};
}
test('file reader bounds size/decoded bytes and base64 conversion works across chunks',async()=>{
 const bytes=Uint8Array.from({length:70000},(_,i)=>i%256);assert.equal(await readGoodreadsFile({size:bytes.length,arrayBuffer:async()=>bytes.buffer}),Buffer.from(bytes).toString('base64'));
 await assert.rejects(()=>readGoodreadsFile({size:10*1024*1024+1,arrayBuffer:()=>{throw new Error('Must not read');}}));await assert.rejects(()=>readGoodreadsFile({size:1,arrayBuffer:async()=>new ArrayBuffer(10*1024*1024+1)}));
});
test('preview uses literal text and at most50 rows, retaining selection/genre/focus through pages/remount',async t=>{
 const preview=importPreview();preview.rows[0].display.title='<img src=x onerror=alert(1)>';preview.rows[0].warnings=['Sprawdź autora'];const a=await panel(t,preview);assert.ok(a.root.textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(a.root.querySelectorAll('img').length,0);assert.equal(a.root.querySelectorAll('tbody')[0].children.length,50);
 const genre=pick(a.root,'select','Półka pozycji 1');genre.focus();genre.value='fantasy';genre.onchange();assert.equal(a.doc.activeElement.getAttribute('aria-label'),'Półka pozycji 1');assert.equal(a.doc.activeElement.value,'fantasy');assert.equal(pick(a.root,'select','Status pozycji 1'),undefined);
 const check=pick(a.root,'input','Wybierz pozycję 1');check.checked=false;check.onchange();pick(a.root,'button','Następna strona importu').onclick();assert.equal(a.root.querySelectorAll('tbody')[0].children.length,50);pick(a.root,'button','Następna strona importu').onclick();assert.equal(a.root.querySelectorAll('tbody')[0].children.length,1);
 const replacement=a.doc.createElement('section');replacement.connected=true;a.handle.unmount();a.handle.mount(replacement,importState());pick(replacement,'button','Poprzednia strona importu').onclick();pick(replacement,'button','Poprzednia strona importu').onclick();assert.equal(pick(replacement,'input','Wybierz pozycję 1').checked,false);assert.equal(pick(replacement,'select','Półka pozycji 1').value,'fantasy');assert.equal(a.handle.isDirty(),true);
});
test('cancelled new-file/discard confirmation preserves preview; conflict visibly blocks append',async t=>{
 const a=await panel(t,importPreview(1));globalThis.confirm=()=>false;const file=pick(a.root,'input','Plik Goodreads CSV');file.files=[{size:1,arrayBuffer:()=>{throw new Error('Do not read cancelled file');}}];await file.onchange();assert.equal(a.reads(),1);a.root.querySelectorAll('button').find(b=>b.textContent==='Odrzuć podgląd').onclick();assert.equal(a.handle.isDirty(),true);
 a.handle.receive({...importState(),revision:8});assert.match(a.root.textContent,/kolekcja.*zmieniła|wczytaj.*ponownie/i);assert.equal(a.root.querySelectorAll('button').find(b=>b.textContent.startsWith('Dołącz')).disabled,true);
});
