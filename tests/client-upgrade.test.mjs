import test from 'node:test';import assert from 'node:assert/strict';const module=await import('../public/manager/client-upgrade.mjs').catch(()=>({}));
test('upgrading while editing preserves the draft until the editor closes',()=>{
 let editing=true,reloads=0,message='';const upgrade=module.createClientUpgrade({isEditing:()=>editing,reload:()=>reloads++,notice:v=>message=v});upgrade.available();assert.equal(reloads,0);assert.match(message,/zapisz|formularz/i);editing=false;upgrade.editorClosed();assert.equal(reloads,1);
});
test('an idle panel upgrades immediately while closing an ordinary editor never reloads',()=>{
 let reloads=0;const upgrade=module.createClientUpgrade({isEditing:()=>false,reload:()=>reloads++,notice(){}});upgrade.editorClosed();assert.equal(reloads,0);upgrade.available();assert.equal(reloads,1);
});
test('closing one editor does not reload while a second draft is still dirty',()=>{
 let book=true,layout=true,reloads=0;const u=module.createClientUpgrade({isEditing:()=>book||layout,reload:()=>reloads++,notice(){}});u.available();book=false;u.editorClosed();assert.equal(reloads,0);layout=false;u.editorClosed();assert.equal(reloads,1);u.editorClosed();assert.equal(reloads,1);
});
test('book, layout and import independently preserve edits during a version change',()=>{
 let book=true,layout=true,importing=true,reloads=0,message='';const u=module.createClientUpgrade({isEditing:()=>book||layout||importing,reload:()=>reloads++,notice:text=>message=text});u.available();assert.match(message,/wszystk|zmian|import/i);book=false;u.editorClosed();layout=false;u.editorClosed();assert.equal(reloads,0);importing=false;u.editorClosed();assert.equal(reloads,1);
});
