import test from 'node:test';
import assert from 'node:assert/strict';
const {createDraftGuard}=await import('../public/manager/draft-guard.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function guard(){assert.equal(typeof createDraftGuard,'function');return createDraftGuard();}
test('book draft guard detects actual field changes but not opening or restoring values',()=>{
 const g=guard(),saved={title:'Solaris',authors:'Lem',shelf:'fantasy',coverId:null};
 g.start(saved);assert.equal(g.isDirty(saved),false);
 assert.equal(g.isDirty({...saved,title:'Solaris poprawione'}),true);
 assert.equal(g.isDirty({...saved,shelf:'new:Horror'}),true);
 assert.equal(g.isDirty(saved),false);
});
test('rejecting discard leaves a dirty book draft open while successful saving permits close',()=>{
 const g=guard(),saved={title:'Solaris',coverId:'old'};g.start(saved);
 let prompts=0;const confirm=()=>{prompts++;return false;};
 assert.equal(g.canClose({...saved,coverId:'new'},confirm),false);assert.equal(prompts,1);
 g.saved({...saved,coverId:'new'});assert.equal(g.canClose({...saved,coverId:'new'},confirm),true);assert.equal(prompts,1);
});
test('an unchanged editor closes without a prompt and cancelled draft resets when another book opens',()=>{
 const g=guard();g.start({title:'A'});assert.equal(g.canClose({title:'A'},()=>{throw new Error('Unchanged draft must not prompt');}),true);
 assert.equal(g.canClose({title:'B'},()=>true),true);g.start({title:'C'});assert.equal(g.isDirty({title:'C'}),false);
});
