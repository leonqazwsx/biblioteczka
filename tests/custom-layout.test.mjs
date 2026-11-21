import test from 'node:test';import assert from 'node:assert/strict';import {createInitialState} from '../src/domain.mjs';import {buildPages} from '../public/shared/layout.mjs';import {getRoomScene,ROOM_SCENES,fitScene} from '../public/shared/room-scene.mjs';
const custom=await import('../public/shared/custom-layout.mjs').catch(()=>({}));
const scene=getRoomScene('green-library'),left='green-top-left',right='green-top-center-left',fit={width:1000,height:941,x:0,y:0};
const slots=scene.slots.slice(0,2).map(slot=>({...slot,books:{x:.1,y:.1,width:.1,height:.5}}));
function fixture(n=5){const s=createInitialState();s.settings.room=scene.id;s.books=Array.from({length:n},(_,i)=>({id:'book-'+i,title:String.fromCharCode(65+i),authors:['Reader'],shelfId:'fantasy',status:'read',order:i,pageCount:300,palette:['#32556a']}));s.settings.roomLayouts={[scene.id]:{enabled:true,cavities:{[left]:{source:{kind:'shelf',id:'fantasy'},decoration:null}},placements:{}}};return s;}
const pack=(s,visible=slots,size=()=>({width:40,height:100}))=>custom.buildCustomPages(s,{scene,slots:visible,fit,size});
const row=(pages,page,slot)=>pages[page].rows.find(r=>r.slotId===slot);
const ids=pages=>pages.flatMap(p=>p.rows.flatMap(r=>r.books.map(item=>item.book.id)));
test('manual placement wins over its category source without duplicating the book',()=>{
 const s=fixture(2);s.settings.roomLayouts[scene.id].placements={'book-0':{slotId:right,order:0}};const pages=pack(s);assert.deepEqual(row(pages,0,left).books.map(x=>x.book.id),['book-1']);assert.deepEqual(row(pages,0,right).books.map(x=>x.book.id),['book-0']);assert.deepEqual(ids(pages).toSorted(),['book-0','book-1']);
});
test('category overflow fills matching cavities in order and continues on another page',()=>{
 const s=fixture();s.settings.roomLayouts[scene.id].cavities[right]={source:{kind:'shelf',id:'fantasy'},decoration:null};const pages=pack(s);assert.equal(pages.length,2);assert.deepEqual(row(pages,0,left).books.map(x=>x.book.id),['book-0','book-1']);assert.deepEqual(row(pages,0,right).books.map(x=>x.book.id),['book-2','book-3']);assert.deepEqual(row(pages,1,left).books.map(x=>x.book.id),['book-4']);
});
test('an unavailable placement falls back visibly without changing the saved configuration',()=>{
 const s=fixture(1);s.settings.roomLayouts[scene.id].placements={'book-0':{slotId:'green-bottom-left',order:0}};const original=structuredClone(s);const pages=pack(s);assert.deepEqual(ids(pages),['book-0']);assert.deepEqual(s,original);
});
test('manual order is retained while automatic books follow title ordering',()=>{
 const s=fixture(4);s.settings.sort='title-desc';s.settings.roomLayouts[scene.id].placements={'book-0':{slotId:right,order:1},'book-1':{slotId:right,order:0}};const pages=pack(s);assert.deepEqual(row(pages,0,right).books.map(x=>x.book.id),['book-1','book-0']);assert.deepEqual(row(pages,0,left).books.map(x=>x.book.id),['book-3','book-2']);
});
test('legacy decoration no longer reserves capacity or spills books onto another page',()=>{
 const s=fixture(2);s.settings.roomLayouts[scene.id].cavities[left].decoration='plant';const pages=pack(s,slots,()=>({width:30,height:100}));assert.equal(pages.length,1);assert.deepEqual(ids(pages),['book-0','book-1']);assert.equal(row(pages,0,left).decoration,undefined);
 const narrow=slots.map(slot=>({...slot,books:{...slot.books,width:.024}})),decorated=fixture(1);decorated.settings.roomLayouts[scene.id].cavities[left].decoration='plant';const tiny=pack(decorated,narrow,()=>({width:14,height:100}));assert.deepEqual(ids(tiny),['book-0']);assert.equal(row(tiny,0,left).decoration,undefined);
});
test('empty custom rooms stay navigable and decorations do not invent books',()=>{
 const s=fixture(0);s.settings.roomLayouts[scene.id].cavities[left].decoration='vase';const pages=pack(s);assert.equal(pages.length,1);assert.deepEqual(ids(pages),[]);assert.equal(row(pages,0,left).decoration,undefined);
});
test('enabled custom layout is used by the wallpaper and disabling it restores the automatic layout',()=>{
 const s=fixture(1);s.settings.roomLayouts[scene.id].placements={'book-0':{slotId:'green-top-right',order:0}};const pages=buildPages(s,{width:1920,height:1080});assert.equal(pages.flatMap(p=>p.rows).find(r=>r.books.length).slotId,'green-top-right');s.settings.roomLayouts[scene.id].enabled=false;const disabled=buildPages(s,{width:1920,height:1080});s.settings.roomLayouts={};assert.deepEqual(buildPages(s,{width:1920,height:1080}),disabled);
});
test('10000 books across rooms, scale extremes and cropped screens remain visible exactly once',()=>{
 for(const room of ROOM_SCENES)for(const [width,height]of [[1366,768],[1920,1080],[1920,1200],[3440,1440]])for(const scale of [.6,1.4])for(const iconSpace of [0,.3]){
  const s=fixture(10000);s.settings.room=room.id;s.settings.bookScales={[room.id]:scale};s.settings.iconSpace=iconSpace;const first=room.slots[0].id,last=room.slots.at(-1).id;s.settings.roomLayouts={[room.id]:{enabled:true,cavities:{[first]:{source:{kind:'status',id:'read'},decoration:'plant'}},placements:{'book-0':{slotId:last,order:0}}}};
  const pages=buildPages(s,{width,height}),all=ids(pages);assert.equal(all.length,10000);assert.equal(new Set(all).size,10000);const fitted=fitScene(room,{width,height,iconSpace});
  for(const r of pages.flatMap(p=>p.rows)){const available=r.bounds.width*fitted.width;const booksWidth=r.books.reduce((n,item)=>n+item.width,0)+Math.max(0,r.books.length-1)*2;assert.ok(booksWidth+(r.decoration?r.decoration.width+(r.books.length?2:0):0)<=available+.001);assert.ok(fitted.x+r.bounds.x*fitted.width>=width*iconSpace-.001);assert.ok(r.books.every(b=>b.height<=r.bounds.height*fitted.height));}
 }
});
