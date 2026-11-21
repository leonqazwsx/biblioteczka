import test from 'node:test';
import assert from 'node:assert/strict';
import {importDom} from './helpers/import-dom.mjs';
import {createInitialState} from '../src/domain.mjs';
import {createRoomLayoutPanel} from '../public/manager/room-layout-panel.mjs';
test('annual preview preserves pager focus after both repaint and ResizeObserver notification',async t=>{
 const {doc,root}=importDom(),oldDocument=globalThis.document,oldObserver=globalThis.ResizeObserver,create=doc.createElement;let observer;
 doc.createElement=tag=>{const e=create(tag);e.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};e.addEventListener=()=>{};e.getBoundingClientRect=()=>({right:50,top:50});Object.defineProperties(e,{clientWidth:{get:()=>e.className==='layout-map'?960:0},clientHeight:{get:()=>e.className==='layout-map'?540:0}});return e;};
 doc.createElementNS=(_,tag)=>doc.createElement(tag);doc.body=doc.createElement('body');globalThis.document=doc;globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observer=this;}observe(){}disconnect(){}};
 t.after(()=>{globalThis.document=oldDocument;globalThis.ResizeObserver=oldObserver;});
 const state=createInitialState();Object.assign(state.settings,{room:'annual-niches',grouping:'months',readingYear:2026});state.books=Array.from({length:60},(_,i)=>({id:'b'+i,title:'Książka '+i,authors:['Autor'],readDate:'2026-01-10',shelfId:'fantasy',order:i}));
 const panel=createRoomLayoutPanel({state,onSave:async()=>{},onDirtyChange(){},notice(){}});panel.mount(root,state);
 const next=()=>root.querySelectorAll('button').find(e=>e.getAttribute('aria-label')==='Następna strona podglądu');
 next().focus();await next().onclick();assert.ok(root.contains(doc.activeElement),'focus after full repaint');
 observer.callback();assert.ok(root.contains(doc.activeElement),'focus after observer repaint');assert.equal(doc.activeElement.getAttribute('aria-label'),'Następna strona podglądu');panel.unmount();
});
