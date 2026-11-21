import test from 'node:test';import assert from 'node:assert/strict';
import {ROOM_SCENES,ROOM_SCENE,validateScene,fitScene} from '../public/shared/room-scene.mjs';
import {createInitialState} from '../src/domain.mjs';import {buildPages} from '../public/shared/layout.mjs';
test('every photographic shelf keeps the spine foot and contact shadow in front of its occlusion mask',()=>{
 let checked=0;
 for(const scene of ROOM_SCENES)for(const slot of scene.slots){
  const bottom=slot.books.y+slot.books.height;
  assert.ok(slot.front.y+1e-10>=bottom,`${scene.id}/${slot.id}: front mask erases ${(bottom-slot.front.y)*941}px of the foot`);
  assert.equal(typeof slot.contactY,'number');assert.ok(Math.abs(bottom-slot.contactY)<1e-10);
  assert.ok((slot.front.y-bottom)*941<=15,scene.id+' contact must stay on the shallow support, not far behind its edge');checked++;
 }
 assert.ok(checked>=93);
});
test('scene validation refuses a photographic mask above the declared book contact',()=>{
 const bad=structuredClone(ROOM_SCENE);bad.slots[0].front.y=bad.slots[0].books.y+bad.slots[0].books.height-1/941;
 assert.throws(()=>validateScene(bad),/contact/i);
});
test('sorting, scale, year mode and desktop resize retain a shared support line for every row',()=>{
 for(const scene of ROOM_SCENES)for(const [width,height]of [[1366,768],[1920,1080],[1920,1200],[3440,1440]])for(const scale of [.6,1.4]){
  const s=createInitialState();s.settings.room=scene.id;s.settings.bookScales={[scene.id]:scale};s.settings.readingYear=2026;s.settings.grouping=scene.annual?'months':'shelves';
  s.shelves=Array.from({length:12},(_,i)=>({id:'s'+i,name:'Półka '+i,order:i}));s.books=s.shelves.flatMap((shelf,i)=>Array.from({length:4},(_,j)=>({id:'b'+i+'-'+j,title:'Książka '+j,authors:['Autor'],shelfId:shelf.id,order:j,pageCount:100+j*200,readDate:'2026-'+String(i+1).padStart(2,'0')+'-10'})));
  const pages=buildPages(s,{width,height}),fit=fitScene(scene,{width,height,iconSpace:s.settings.iconSpace});
  assert.equal(pages.flatMap(p=>p.rows.flatMap(r=>r.books)).length,48);
  for(const row of pages.flatMap(p=>p.rows)){const slot=scene.slots.find(v=>v.id===row.slotId);assert.ok(Math.abs(row.bounds.y+row.bounds.height-slot.contactY)<1e-10);assert.ok(row.books.every(b=>b.height<=row.bounds.height*fit.height));}
 }
});
