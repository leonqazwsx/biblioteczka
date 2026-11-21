import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialState,applyCommand} from '../src/domain.mjs';import {renderScene} from '../public/wallpaper/scene-renderer.mjs';
class Element{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(key,value){this[key]=value;}};this.classList={add(){}};}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this[key]=value;}addEventListener(){}}
function dom(t){const previous=globalThis.document;globalThis.document={body:new Element('body'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};t.after(()=>globalThis.document=previous);return new Element('main');}
test('day choice with dark panel uses one day photograph for the room and every front',t=>{
  const root=dom(t);let state=createInitialState();state=applyCommand(state,{type:'updateSettings',patch:{theme:'dark',lighting:'day'}});
  state=applyCommand(state,{type:'addBook',draft:{title:'Próba światła',authors:['Autor'],shelfId:'other',status:'read'}});
  renderScene(root,{state,page:0,width:1920,height:1080,onBook(){},onTooltip(){},onLeave(){}});
  const background=root.children.find(n=>n.className==='room-background'),fronts=root.children.filter(n=>n.className==='room-front');
  assert.equal(background.src,'/assets/room/day.png');assert.ok(fronts.length);assert.ok(fronts.every(n=>n.src===background.src));assert.equal(document.body.dataset.sceneLighting,'day');
  const buttons=root.children.flatMap(n=>n.children??[]).filter(n=>n.tagName==='button');assert.equal(buttons.length,1);assert.equal(buttons[0]['aria-label'],'Próba światła, Autor');
});
test('automatic renderer accepts the local clock value, independent of panel theme',t=>{
  const root=dom(t),state=createInitialState();state.settings.lighting='auto';state.settings.theme='dark';
  renderScene(root,{state,page:0,width:1920,height:1080,date:new Date(2026,9,5,7),onBook(){},onTooltip(){},onLeave(){}});
  assert.equal(root.children.find(n=>n.className==='room-background').src,'/assets/room/day.png');assert.equal(document.body.dataset.sceneLighting,'day');
});

test('a too-small preview keeps the room photograph behind its resize message',t=>{
  const root=dom(t),state=createInitialState();state.settings.lighting='day';
  const result=renderScene(root,{state,page:0,width:120,height:80,onBook(){},onTooltip(){},onLeave(){}});
  assert.equal(root.children.find(node=>node.className==='room-background')?.src,'/assets/room/day.png');
  assert.ok(root.children.some(node=>node.className==='room-error'));
  assert.deepEqual(result.books,[]);
});
