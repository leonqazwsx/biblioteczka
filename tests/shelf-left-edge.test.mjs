import test from 'node:test';import assert from 'node:assert/strict';
import {getRoomScene,fitScene} from '../public/shared/room-scene.mjs';import {buildPages} from '../public/shared/layout.mjs';import {createInitialState} from '../src/domain.mjs';
// First fully wooden pixel after the aluminium jamb, checked in both photos.
const starts=[382,579,775,971,1167,1367],ends=[560,759,953,1149,1347,1561],fronts=[382,579,774,971,1168,1366];
test('panorama books touch the measured inner left edge on both shelf levels',()=>{
 const scene=getRoomScene('annual-panorama');
 for(const [i,slot]of scene.slots.entries())assert.ok(Math.abs(slot.books.x*1672-starts[i%6])<1e-8,`${slot.id}: extra gap ${(slot.books.x*1672-starts[i%6]).toFixed(2)}px from the photographed jamb`);
});
test('left-edge correction preserves shelf contact, right edge and photographic lip masks',()=>{
 const scene=getRoomScene('annual-panorama');for(const [i,slot]of scene.slots.entries()){
  assert.ok(Math.abs((slot.books.x+slot.books.width)*1672-ends[i%6])<1e-8);
  assert.ok(Math.abs((slot.books.y+slot.books.height)*941-(i<6?594:732))<1e-8);
  assert.ok(Math.abs(slot.front.x*1672-fronts[i%6])<1e-8);
  assert.ok(Math.abs((slot.front.x+slot.front.width)*1672-(ends[i%6]+6))<1e-8);
 }
});
test('genre, annual and custom plans begin at the calibrated left edge and respect desktop icon space',()=>{
 const scene=getRoomScene('annual-panorama');for(const mode of ['shelves','months','custom'])for(const [width,height]of [[1280,720],[1920,1080],[3440,1440]])for(const iconSpace of [.2,.3]){
  const s=createInitialState();s.settings.room=scene.id;s.settings.iconSpace=iconSpace;s.settings.grouping=mode==='months'?'months':'shelves';s.settings.readingYear=2026;
  s.shelves=[{id:'s',name:'Gatunek',order:0}];s.books=Array.from({length:12},(_,i)=>({id:'b'+i,title:'Książka '+i,authors:['Autor'],shelfId:'s',order:i,readDate:`2026-${String(i+1).padStart(2,'0')}-10`}));
  if(mode==='custom')s.settings.roomLayouts={[scene.id]:{enabled:true,cavities:{},placements:{}}};
  const fit=fitScene(scene,{width,height,iconSpace}),pages=buildPages(s,{width,height,scene});assert.equal(pages.flatMap(p=>p.rows.flatMap(r=>r.books)).length,12);
  for(const row of pages.flatMap(p=>p.rows)){const i=scene.slots.findIndex(slot=>slot.id===row.slotId),expected=Math.max(width*iconSpace,fit.x+starts[i%6]/1672*fit.width);assert.ok(Math.abs(fit.x+row.bounds.x*fit.width-expected)<1e-6);}
 }
});

