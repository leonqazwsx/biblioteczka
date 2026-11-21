import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
test('reconnecting to a new application version reloads once and refreshes the command token',async()=>{
 let stream,reloads=0,bootstrapCalls=0;const revisions=[],sent=[];
 const context=vm.createContext({EventSource:class{constructor(){stream=this;}close(){}},location:{reload(){reloads++;}},fetch:async(route,options)=>{if(route==='/api/bootstrap')return {ok:true,json:async()=>({token:'token-'+(++bootstrapCalls),version:bootstrapCalls===1?'0.7.0':'0.8.0'})};sent.push(options);return {ok:true,json:async()=>({})};}});
 const source=await fs.readFile(new URL('../public/shared/api.mjs',import.meta.url),'utf8');vm.runInContext(source.replaceAll('export ',''),context);context.onRevision=value=>revisions.push(value);
 await vm.runInContext('api.bootstrap()',context);vm.runInContext('api.events(onRevision)',context);
 stream.onmessage({data:JSON.stringify({revision:1,version:'0.7.0'})});assert.deepEqual(revisions,[1]);assert.equal(reloads,0);
 stream.onopen();await new Promise(r=>setImmediate(r));await vm.runInContext('api.command({},1)',context);assert.equal(sent[0].headers['X-Bookshelf-Token'],'token-2');
 stream.onmessage({data:JSON.stringify({revision:2,version:'0.8.0'})});stream.onmessage({data:JSON.stringify({revision:3,version:'0.8.0'})});assert.equal(reloads,1);assert.deepEqual(revisions,[1]);
});
test('legacy events without a version still deliver collection revisions',async()=>{
 let stream,reloads=0;const revisions=[];const context=vm.createContext({EventSource:class{constructor(){stream=this;}close(){}},location:{reload(){reloads++;}},fetch:async()=>({ok:true,json:async()=>({token:'legacy'})})});const source=await fs.readFile(new URL('../public/shared/api.mjs',import.meta.url),'utf8');vm.runInContext(source.replaceAll('export ',''),context);context.onRevision=value=>revisions.push(value);await vm.runInContext('api.bootstrap()',context);vm.runInContext('api.events(onRevision)',context);stream.onmessage({data:JSON.stringify({revision:4})});stream.onmessage({data:JSON.stringify({revision:5})});assert.equal(reloads,0);assert.deepEqual(revisions,[4,5]);
});

test('same-version recovery notifies the panel before delivering a lower revision',async()=>{
 let stream,boot=0;const sequence=[];
 const context=vm.createContext({EventSource:class{constructor(){stream=this;}close(){}},location:{reload(){throw new Error('Same version must not reload');}},fetch:async()=>({ok:true,json:async()=>({token:'token'+(++boot),version:'0.10.0',sessionId:boot===1?'first':'recovered',recovery:boot===1?'none':'backup',collectionId:'library',revision:boot===1?2:1})})});
 const source=await fs.readFile(new URL('../public/shared/api.mjs',import.meta.url),'utf8');vm.runInContext(source.replaceAll('export ',''),context);
 context.onRevision=value=>sequence.push(['revision',value]);context.onSession=info=>sequence.push(['session',info.sessionId,info.recovery]);
 await vm.runInContext('api.bootstrap()',context);vm.runInContext('api.events(onRevision,null,null,null,onSession)',context);
 stream.onmessage({data:JSON.stringify({version:'0.10.0',sessionId:'recovered',recovery:'backup',collectionId:'library',revision:1})});
 assert.deepEqual(sequence,[['session','recovered','backup'],['revision',1]]);
});
