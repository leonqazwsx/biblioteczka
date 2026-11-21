import test from 'node:test';import assert from 'node:assert/strict';
const {watchLighting}=await import('../public/shared/lighting-clock.mjs').catch(()=>({}));
test('lighting clock changes presentation at boundaries and cleans up its timer and listener',()=>{
  assert.equal(typeof watchLighting,'function');let date=new Date(2026,9,5,18,59),tick,visibility,cleared;let settings={theme:'light',lighting:'auto'};const changes=[];
  const target={hidden:false,addEventListener(name,fn){assert.equal(name,'visibilitychange');visibility=fn;},removeEventListener(name,fn){assert.equal(name,'visibilitychange');assert.equal(fn,visibility);visibility=null;}};
  const clock=watchLighting({getSettings:()=>settings,onChange:light=>changes.push(light),now:()=>date,schedule:fn=>{tick=fn;return 17;},cancel:id=>cleared=id,visibilityTarget:target});
  tick();assert.deepEqual(changes,[]);date=new Date(2026,9,5,19,0);tick();tick();assert.deepEqual(changes,['evening']);
  date=new Date(2026,9,6,7,0);target.hidden=true;visibility();assert.deepEqual(changes,['evening']);target.hidden=false;visibility();assert.deepEqual(changes,['evening','day']);
  settings={theme:'dark',lighting:'day'};clock.sync();date=new Date(2026,9,6,23);tick();assert.deepEqual(changes,['evening','day']);
  clock.dispose();assert.equal(cleared,17);assert.equal(visibility,null);
});
test('sync keeps an already-rendered theme or explicit choice from causing duplicate work',()=>{
  assert.equal(typeof watchLighting,'function');let settings={theme:'light',lighting:'day'},date=new Date(2026,9,5,20),tick;const changes=[];
  const clock=watchLighting({getSettings:()=>settings,onChange:x=>changes.push(x),now:()=>date,schedule:fn=>{tick=fn;return 1;},cancel:()=>{},visibilityTarget:null});
  settings={theme:'light',lighting:'auto'};clock.sync();tick();assert.deepEqual(changes,[]);date=new Date(2026,9,6,7);tick();assert.deepEqual(changes,['day']);clock.dispose();
});
