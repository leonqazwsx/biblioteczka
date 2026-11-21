import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/manager/app.mjs',import.meta.url),'utf8');
const callback=source.slice(source.indexOf('function spineDraft('),source.indexOf('\nfunction previewColor'));
test('editor preview uses the current cover immediately and retains only an illustration for that cover',()=>{
 const cover='a'.repeat(64),replacement='b'.repeat(64),asset='c'.repeat(64),fields={title:'Tytuł',authors:'Autor',isbn:'', 'page-count':'300',publisher:'', 'spine-color':'#123456'};
 const book={id:'book',coverId:cover,spine:{kind:'ai',assetId:asset}};
 const context=vm.createContext({state:{books:[book]},editing:book.id,coverId:cover,currentSpineStyle:0,palette:[],frameEditor:{value:()=>({x:40,y:60,zoom:1.2})},$:id=>({value:fields[id]})});
 vm.runInContext(callback,context);const same=context.spineDraft();assert.equal(same.coverId,cover);assert.equal(same.spine.assetId,asset);assert.equal(same.spine.frame.zoom,1.2);
 context.coverId=replacement;const changed=context.spineDraft();assert.equal(changed.coverId,replacement);assert.equal(changed.spine,null);assert.equal(book.coverId,cover);assert.equal(book.spine.assetId,asset);
 context.editing=null;assert.equal(context.spineDraft().coverId,replacement);assert.equal(context.spineDraft().spine,null);
 context.coverId=null;assert.equal(context.spineDraft().coverId,null);
});
