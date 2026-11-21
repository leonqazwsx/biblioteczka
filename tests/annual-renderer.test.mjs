import test from 'node:test';
import assert from 'node:assert/strict';
import {importDom} from './helpers/import-dom.mjs';
import {createInitialState} from '../src/domain.mjs';
import {renderScene} from '../public/wallpaper/scene-renderer.mjs';
function setup(t){
 const {doc,root}=importDom(),previous=globalThis.document,create=doc.createElement;
 doc.createElement=tag=>{const e=create(tag);e.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};e.listeners={};e.addEventListener=(name,fn)=>e.listeners[name]=fn;e.getBoundingClientRect=()=>({right:50,top:50});return e;};
 doc.createElementNS=(_,tag)=>doc.createElement(tag);doc.body=doc.createElement('body');root.style={};globalThis.document=doc;t.after(()=>globalThis.document=previous);return root;
}
function nodes(root,cls){const found=[];function walk(n){if(n.className.split(' ').includes(cls))found.push(n);for(const child of n.children)walk(child);}walk(root);return found;}
function state(){const s=createInitialState();s.settings.room='annual-niches';s.settings.grouping='months';s.settings.readingYear=2026;s.books=[{id:'a',title:'Solaris',authors:['Stanisław Lem'],readDate:'2026-02-10',shelfId:'fantasy',order:0}];return s;}
test('annual scene renders the real book and accessible months without visual month plaques',t=>{
 const root=setup(t),s=state();let selected;const callbacks={onBook:b=>selected=b,onTooltip(){},onLeave(){}};
 const r=renderScene(root,{state:s,page:0,width:1920,height:1080,...callbacks});
 assert.equal(nodes(root,'room-cavity').length,12);assert.equal(nodes(root,'cavity-label').length,0);assert.equal(r.books[0].id,'a');
 assert.equal(nodes(root,'room-cavity')[1].getAttribute('aria-label'),'Luty');
 const button=nodes(root,'book')[0];button.listeners.click();assert.equal(selected.id,'a');assert.equal(button.getAttribute('aria-describedby'),'tooltip');
});
test('nonstandard desktop fills exposed room edges and updates their lighting with the photo',t=>{
 const root=setup(t),s=state(),callbacks={onBook(){},onTooltip(){},onLeave(){}};
 renderScene(root,{state:s,page:0,width:5120,height:1440,...callbacks});
 const fragments=nodes(root,'room-extension');assert.ok(fragments.length>0);
 assert.ok(fragments.flatMap(n=>n.children).every(img=>img.src.endsWith('-day.png')));
 s.settings.theme='dark';renderScene(root,{state:s,page:0,width:5120,height:1440,...callbacks});
 assert.ok(nodes(root,'room-extension').flatMap(n=>n.children).every(img=>img.src.endsWith('-night.png')));
});
