import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberLayoutFocus} from '../public/manager/layout-focus.mjs';
test('last annual preview page returns focus to the enabled previous-page button',t=>{
 const old=globalThis.document,active={tagName:'BUTTON',type:'button',textContent:'→',getAttribute:()=> 'Następna strona podglądu'};
 globalThis.document={activeElement:active};t.after(()=>globalThis.document=old);
 let focused=false,selector;
 const previous={focus(){focused=true;}},next={...active,disabled:true,closest(value){selector=value;return value.includes('.layout-pager')?{querySelector:()=>previous}:null;}};
 const root={contains:()=>true,querySelectorAll:()=>[next]};rememberLayoutFocus(root)();
 assert.equal(focused,true);assert.ok(selector.includes('.layout-pager'));
});
