import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {importDom} from './helpers/import-dom.mjs';
import {makeSpine} from '../public/shared/spines.mjs';
import {sortBooks,SORT_OPTIONS} from '../public/shared/book-order.mjs';
import {formatReadDate} from '../public/shared/calendar-date.mjs';
import {collectionView} from '../public/manager/collection-view.mjs';

const source=await fs.readFile(new URL('../public/manager/app.mjs',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function renderBooks('),source.indexOf('\nfunction renderShelves'));
const cardModule=await import('../public/manager/book-card.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function descendants(root){return root.children.flatMap(node=>[node,...descendants(node)]);}
function byClass(root,name){return descendants(root).filter(node=>node.className.split(/\s+/).includes(name));}
function library(books,{sort='manual',shelves=[{id:'fantasy',name:'Fantastyka',order:0}],query='',page=0}={}){
 const {doc,root}=importDom(),create=doc.createElement.bind(doc);
 doc.createElement=tag=>{const node=create(tag);node.style={setProperty(){}};return node;};
 globalThis.document=doc;
 const calls=[];
 const el=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
 const state={settings:{sort},shelves,books};
 const button=(text,fn,cls='secondary')=>{const node=el('button',cls,text);node.onclick=fn;return node;};
 const select=(options,value)=>{const node=el('select');node.value=value;for(const [id,label] of options){const option=el('option','',label);option.value=id;node.append(option);}return node;};
 const context=vm.createContext({state,selectionMode:false,selectedBooks:new Set(),bulkDraft:{},collectionView,collectionQuery:query,galleryPage:page,collectionMode:'gallery',shelfFilter:null,statusFilter:'',labels:{read:'Przeczytane',reading:'Czytam','to-read':'Do przeczytania'},el,button,select,heading(){},makeSpine,formatReadDate,sortBooks,SORT_OPTIONS,createBookCard:cardModule.createBookCard,showEditor:book=>calls.push(['edit',book?.id]),showBookDetails:book=>calls.push(['inspect',book?.id]),command:async cmd=>calls.push(['command',cmd]),notice(){},render(){},confirm:()=>true});
 vm.runInContext(renderer,context);context.main=root;vm.runInContext('renderBooks(main)',context);return {root,calls};
}
const book=(patch={})=>({id:'b1',title:'Książka <bez HTML>',authors:['Autor'],shelfId:'fantasy',order:0,status:'read',readDate:'2026-10-04',coverId:'abc.png',...patch});

test('clicking a gallery cover opens lightweight details for the matching book',()=>{
 const {root,calls}=library([book()]);
 const cover=byClass(root,'book-cover-button')[0];
 assert.ok(cover,'Cover must be a keyboard-operable editing button');
 cover.onclick();assert.deepEqual(calls,[['inspect','b1']]);
 assert.match(cover.getAttribute('aria-label'),/Książka <bez HTML>/);
 assert.equal(byClass(root,'book-info')[0].querySelector('strong').textContent,'Książka <bez HTML>');
});
test('gallery shows a retained completion date without a status badge',()=>{
 const {root}=library([book({status:'reading'})]);
 assert.equal(byClass(root,'read-date-label')[0]?.textContent,'Przeczytano: 04.10.2026');
 const read=library([book()]);
 assert.match(byClass(read.root,'read-date-label')[0].textContent,/04\.10\.2026/);
});
test('a missing or failed local cover still presents the full title and allows editing',()=>{
 const missing=library([book({coverId:null})]);
 const fallback=byClass(missing.root,'cover-fallback')[0];assert.ok(fallback);
 assert.match(fallback.textContent,/Książka <bez HTML>/);
 const loaded=library([book()]),image=loaded.root.querySelector('img');
 assert.equal(typeof image.onerror,'function');
 image.onerror();
 const errorFallback=byClass(loaded.root,'cover-fallback')[0];assert.ok(errorFallback);
 byClass(loaded.root,'book-cover-button')[0].onclick();assert.deepEqual(loaded.calls,[['inspect','b1']]);
});
test('gallery preserves manual movement boundaries and disables movement when sorted by title',async()=>{
 const books=[book(),book({id:'b2',order:1,title:'A'})];
 const manual=library(books);
 const movement=descendants(manual.root).filter(node=>node.tagName==='BUTTON'&&node.title?.startsWith('Przesuń'));
 assert.equal(movement.length,4);assert.equal(movement[0].disabled,true);assert.equal(movement[1].disabled,false);
 await movement[1].onclick();assert.deepEqual(JSON.parse(JSON.stringify(manual.calls[0])),['command',{type:'moveBook',id:'b1',shelfId:'fantasy',index:1}]);
 const sorted=library(books,{sort:'title-asc'});
 assert.ok(descendants(sorted.root).filter(node=>node.tagName==='BUTTON'&&node.title?.startsWith('Przesuń')).every(node=>node.disabled));
});

test('theme controls persist the selected theme through existing settings commands without changing books',async()=>{
 const {applyCommand,createInitialState}=await import('../src/domain.mjs');
 let state=applyCommand(createInitialState(),{type:'addBook',draft:{title:'Solaris',authors:['Lem'],shelfId:'fantasy',status:'to-read'}});
 const originalBooks=JSON.stringify(state.books),fields=new Map();
 const $=id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);};
 const context=vm.createContext({$,navigate(){},showEditor(){},closeEditor(){},notice(){},suggestions:{cancel(){}},cancelEditorWork(){},command:async cmd=>{state=applyCommand(state,cmd);return state;}});
 const bindings=source.slice(source.indexOf("$('all-books').onclick="),source.indexOf("document.addEventListener('keydown'",source.indexOf("$('all-books').onclick=")));
 vm.runInContext(bindings,context);
 assert.equal(typeof $('theme-dark').onclick,'function','Dark control must save the selected theme');
 await $('theme-dark').onclick();assert.equal(state.settings.theme,'dark');
 await $('theme-light').onclick();assert.equal(state.settings.theme,'light');
 assert.equal(JSON.stringify(state.books),originalBooks);
});

test('gallery title sort is global when two shelves are visible',()=>{
 const {root}=library([book({id:'b',title:'B',shelfId:'fantasy'}),book({id:'a',title:'A',shelfId:'crime'})],{sort:'title-asc',shelves:[{id:'fantasy',name:'Fantastyka',order:0},{id:'crime',name:'Kryminał',order:1}]});
 assert.deepEqual(byClass(root,'book-info').map(node=>node.querySelector('strong').textContent),['A','B']);
});
test('gallery exposes local search and bounded pagination to the user',()=>{
 const many=Array.from({length:91},(_,i)=>book({id:'id'+i,title:'Title '+i,order:i}));
 const {root}=library(many);
 assert.equal(byClass(root,'book-card').length,60);
 assert.ok(descendants(root).some(node=>node.tagName==='INPUT'&&node.getAttribute('aria-label')==='Szukaj w biblioteczce'));
 assert.match(root.textContent,/1 \/ 2/);
 const search=library(many,{query:'Title 90'});
 assert.equal(byClass(search.root,'book-card').length,1);
});

test('secondary book actions stay inside an accessible disclosure',()=>{
 const {root}=library([book()]);
 const actions=byClass(root,'row-actions')[0],menu=actions.querySelector('details');
 assert.ok(menu,'Deletion should not be permanently exposed beside every cover');
 assert.match(menu.querySelector('summary').getAttribute('aria-label'),/Książka <bez HTML>/);
 assert.ok(menu.querySelectorAll('button').some(button=>button.getAttribute('aria-label')==='Usuń: Książka <bez HTML>'));
});
