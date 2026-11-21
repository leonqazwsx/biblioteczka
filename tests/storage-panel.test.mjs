import test from 'node:test';import assert from 'node:assert/strict';import {importDom} from './helpers/import-dom.mjs';
const {renderStorageSettings}=await import('../public/manager/storage-panel.mjs').catch(()=>({renderStorageSettings:async()=>{}}));
const report=(extra={})=>({collectionId:'test',revision:8,cleanupAllowed:true,blockers:[],graceDays:7,retentionDays:30,totals:{covers:{bytes:1048576,count:3},spines:{bytes:2097152,count:2},quarantine:{bytes:1024,count:1}},candidates:[{kind:'covers',id:'a'.repeat(64),bytes:512}],quarantine:[],...extra});
function ui(){const {doc,root}=importDom();globalThis.document=doc;return root;}
test('storage report explains reversible cleanup and separates active and quarantined bytes',async()=>{
 const root=ui();await renderStorageSettings(root,{request:async()=>report()});
 assert.match(root.textContent,/Okładki.*3.*1,00 MiB/);assert.match(root.textContent,/Grzbiety.*2.*2,00 MiB/);assert.match(root.textContent,/7 dni/);assert.match(root.textContent,/30 dni/);
 assert.ok(root.querySelectorAll('button').some(b=>b.textContent.includes('Przenieś')));
});
test('storage cleanup binds the preview revision and moves only reported old assets',async()=>{
 const root=ui(),calls=[];await renderStorageSettings(root,{request:async(url,options)=>{calls.push({url,body:options?.body});return url==='/api/storage'?report():{report:report({candidates:[]})};}});
 const button=root.querySelectorAll('button').find(b=>b.textContent.includes('Przenieś'));assert.ok(button);await button.onclick();
 assert.deepEqual(calls.find(c=>c.url==='/api/storage/quarantine').body,{expectedRevision:8,assets:[{kind:'covers',id:'a'.repeat(64)}]});
});
test('unsafe storage report exposes blockers instead of cleanup actions',async()=>{
 const root=ui();await renderStorageSettings(root,{request:async()=>report({cleanupAllowed:false,blockers:['Nie można odczytać kopii']})});
 assert.match(root.textContent,/Nie można odczytać kopii/);assert.equal(root.querySelectorAll('button').some(b=>b.textContent.includes('Przenieś')),false);
});
test('permanent removal requires an eligible batch and explicit confirmation',async()=>{
 const root=ui(),calls=[],batch={id:'batch1',createdAt:'2026-08-01T00:00:00Z',bytes:2048,count:2,state:'complete',purgeEligible:true,eligibleBytes:2048};
 let approved=false;await renderStorageSettings(root,{confirm:()=>approved,request:async(url,options)=>{calls.push({url,body:options?.body});return url==='/api/storage'?report({quarantine:[batch]}):{report:report()};}});
 const purge=root.querySelectorAll('button').find(b=>b.textContent.includes('Usuń na stałe'));assert.ok(purge);await purge.onclick();assert.equal(calls.length,1);
 approved=true;await purge.onclick();assert.deepEqual(calls.find(c=>c.url==='/api/storage/purge').body,{expectedRevision:8,quarantineId:'batch1'});
});