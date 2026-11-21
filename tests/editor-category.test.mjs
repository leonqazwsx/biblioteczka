import test from 'node:test';import assert from 'node:assert/strict';
const {editorCategory,resolveCategoryChoice}=await import('../public/manager/editor-category.mjs').catch(()=>({}));
const shelves=[{id:'fantasy',name:'Fantastyka'},{id:'crime',name:'Kryminał'},{id:'other',name:'Pozostałe'}];
test('manual category survives a late catalog result and new categories remain reviewable',()=>{assert.equal(typeof editorCategory,'function');const manual=editorCategory(['Fantasy'],shelves,{manualShelfId:'crime'});assert.equal(manual.value,'crime');assert.equal(manual.newShelfName,null);const proposed=editorCategory(['Biography'],shelves);assert.equal(proposed.value,'new:Biografie');assert.equal(proposed.newShelfName,'Biografie');assert.equal(proposed.shelfId,null);});
test('a deleted manual shelf cannot silently create an invalid book reference',()=>{assert.equal(typeof editorCategory,'function');const result=editorCategory(['Fantasy'],shelves,{manualShelfId:'deleted'});assert.equal(result.value,'fantasy');});
test('a manually selected new preset survives a late conflicting catalog response',()=>{
  const result=editorCategory(['Mystery'],shelves,{manualShelfId:'new:Horror'});
  assert.equal(result.value,'new:Horror');assert.equal(result.shelfId,null);assert.equal(result.newShelfName,'Horror');assert.match(result.message,/Wybrana/);
  assert.equal(editorCategory(['Fantasy'],shelves,{manualShelfId:'new:Pozostałe'}).value,'other');
  assert.equal(editorCategory(['Fantasy'],shelves,{manualShelfId:'new:Unsupported'}).value,'fantasy');
});
test('preset choices reuse existing named shelves and offer a compatible command shape',()=>{
  assert.equal(typeof resolveCategoryChoice,'function');
  const aliased=[...shelves,{id:'food',name:'Gotowanie'}];
  assert.deepEqual(resolveCategoryChoice('new:Kulinaria',aliased),{value:'food',shelfId:'food',newShelfName:null});
  assert.deepEqual(resolveCategoryChoice('new:Psychologia',aliased),{value:'new:Psychologia',shelfId:null,newShelfName:'Psychologia'});
  assert.deepEqual(resolveCategoryChoice('crime',aliased),{value:'crime',shelfId:'crime',newShelfName:null});
  for(const value of ['new:Unsupported','new:','deleted',null,42])assert.equal(resolveCategoryChoice(value,aliased),null);
});
