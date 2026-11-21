import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ANNUAL_SCENES} from '../public/shared/annual-scenes.mjs';
import {ROOM_SCENES,fitScene,validateScene} from '../public/shared/room-scene.mjs';

test('four selected concepts retain their numbers, twelve frontal monthly positions and both production assets',async()=>{
 assert.deepEqual(ANNUAL_SCENES.map(s=>s.conceptNumber),[1,4,5,6]);
 for(const scene of ANNUAL_SCENES){
  assert.equal(scene.annual,true);assert.ok(scene.name.startsWith(scene.conceptNumber+' · '));
  assert.equal(scene.slots.length,12);assert.equal(ROOM_SCENES.find(s=>s.id===scene.id),scene);validateScene(scene);
  const dimensions=[];
  for(const asset of Object.values(scene.assets)){const b=await fs.readFile(new URL('../public'+asset,import.meta.url));assert.equal(b.subarray(1,4).toString(),'PNG');dimensions.push([b.readUInt32BE(16),b.readUInt32BE(20)]);}
  assert.deepEqual(dimensions[0],[1672,941]);assert.deepEqual(dimensions[1],dimensions[0]);
 }
});
test('every annual month remains visible and outside the requested icon area across desktop ratios',()=>{
 for(const scene of ANNUAL_SCENES)for(const [width,height]of [[1366,768],[1920,1080],[1920,1200],[1600,1200],[3440,1440],[5120,1440]])for(const iconSpace of [.2,.3]){
  const fit=fitScene(scene,{width,height,iconSpace});
  assert.ok(Math.abs(fit.width/fit.height-scene.aspectRatio)<1e-9);
  for(const s of scene.slots){
   assert.ok(fit.x+s.books.x*fit.width>=width*iconSpace-.001,scene.id+' left margin');
   assert.ok((s.front.y+s.front.height)*fit.height+24<=height+.001,scene.id+' month below screen');
   assert.ok(fit.x+(s.books.x+s.books.width)*fit.width<=width+.001);
   assert.ok(s.books.height*fit.height>=48);
  }
 }
});
