import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {importDom} from './helpers/import-dom.mjs';
import {makeSpine} from '../public/shared/spines.mjs';
import {CATEGORY_PRESETS} from '../public/shared/categories.mjs';
import {editorCategory,resolveCategoryChoice} from '../public/manager/editor-category.mjs';
import {createSearchController} from '../public/manager/search.mjs';
const source=await fs.readFile(new URL('../public/manager/app.mjs',import.meta.url),'utf8');
const populate=source.slice(source.indexOf('function populate('),source.indexOf('\nfunction showEditor'));
function setup(draft){
 const {doc}=importDom(),fields=new Map(),$=id=>{if(!fields.has(id))fields.set(id,doc.createElement('input'));return fields.get(id);};
 const el=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
 const context=vm.createContext({coverPicker:null,catalogImageId:null,connectionSession:'fixture',editorSession:null,coverUrlImport:{reset(){},setDisabled(){}},spineControls:{},cancelSpineImageImport(){},frameEditor:{reset(){},patch(){return null;}},$,el,makeSpine,CATEGORY_PRESETS,editorCategory,resolveCategoryChoice,bookSnapshot:b=>JSON.stringify(b),state:{revision:4,shelves:[{id:'fantasy',name:'Fantastyka'}]},shelfFilter:null,categoryNote:doc.createElement('p'),provider:null,providerId:null,updateCover(){},updateSpineControls(){}});
 context.localCalendarDate=()=> '2026-11-04';
 vm.runInContext(populate,context);context.draft=draft;vm.runInContext('populate(draft)',context);return {context,fields,$};
}
test('new editor prefills today and an existing undated book opens blank',()=>{
 assert.equal(setup().$('read-date').value,'2026-11-04');
 assert.equal(setup({id:'legacy',title:'Bez daty',readDate:null}).$('read-date').value,'');
});
test('editor population preserves selected catalog edition identity',()=>{
 const {context}=setup({title:'Solaris',authors:['Lem'],provider:'openlibrary',providerId:'/books/OL123M',subjects:['Science fiction']});
 assert.equal(context.provider,'openlibrary');assert.equal(context.providerId,'/books/OL123M');
});
test('BN metadata keeps its identity and suggests a genre in the existing editor',()=>{
 const {context,$}=setup({title:'Dziwne obrazki',authors:['Uketsu'],provider:'bn',providerId:'bn:1000006179873',subjects:['Kryminał']});
 assert.equal(context.provider,'bn');assert.equal(context.providerId,'bn:1000006179873');assert.equal($('shelf').value,'new:Kryminał');
});
test('manual book editor offers new category presets without creating empty shelves',()=>{
 const {context,$}=setup({title:'A',authors:['B']});
 const options=[];function walk(node){if(node.tagName==='OPTION')options.push(node);for(const child of node.children)walk(child);}walk($('shelf'));
 assert.ok(options.some(o=>o.value==='new:Horror'));assert.ok(options.some(o=>o.value==='new:Poezja'));
 assert.equal(options.filter(o=>o.value==='fantasy').length,1);assert.equal(context.state.shelves.length,1);
});
test('opening a fresh editor resets the old query, pagination and a cancelled loading-more request',async()=>{
 const states=[];let release;const suggestions=createSearchController({onState:s=>states.push(s),search:async(q,signal,cursor)=>cursor?new Promise(r=>release=r):{items:[{id:'old',title:'Old'}],nextCursor:'next'}});
 await suggestions.submit('Old query');const pending=suggestions.more();suggestions.cancel();
 const fields=new Map(),$=id=>{if(!fields.has(id))fields.set(id,{hidden:id==='editor',disabled:false,value:'Old query',replaceChildren(){},focus(){}});return fields.get(id);};
 const context=vm.createContext({coverPicker:null,catalogImageId:null,$,suggestions,draftGuard:{start(){},canClose(){return true;}},editorFields:()=>({}),confirm:()=>true,uploading:false,reloadLatest:{hidden:false},operation:0,shelfTouched:false,populate(){},fitSpineTitles(){},spinePreview:{},document:{querySelector:()=>({inert:false})}});
 vm.runInContext(source.slice(source.indexOf('function showEditor('),source.indexOf('\nfunction cancelEditorWork')),context);context.showEditor();
 assert.equal(states.at(-1).status,'idle');assert.equal(states.at(-1).nextCursor,null);assert.deepEqual(states.at(-1).items,[]);
 release({items:[{id:'late',title:'Late'}],nextCursor:null});await pending;assert.equal(states.at(-1).status,'idle');
 await suggestions.submit('New query');assert.equal(states.at(-1).status,'ready');
});

