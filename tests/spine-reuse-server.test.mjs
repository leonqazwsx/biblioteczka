import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';
import {openCoverStore} from '../src/covers.mjs';
import {openSpineStore} from '../src/spine-assets.mjs';
import {openSpineJobs} from '../src/spine-jobs.mjs';
import {createAppServer} from '../src/server.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=','base64');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spine-reuse-http-')),store=await openStore(dir),covers=await openCoverStore(dir),spines=await openSpineStore(dir),{coverId}=await covers.put(png,'image/png');
 await store.commit({type:'updateSettings',patch:{aiEnabled:true}},0);
 for(const title of ['Original','Reuse'])await store.commit({type:'addBook',draft:{title,authors:['Author'],shelfId:'other',status:'read',coverId}},store.read().revision);
 let calls=0,server;const listeners=new Set(),provider={available:true,generate:async()=>{calls++;return {bytes:png,mime:'image/png',usage:{textInput:0,imageInput:0,imageOutput:0}};}};
 const jobs=await openSpineJobs({dataDir:dir,store,covers,spines,provider,onState:()=>{server?.publishChanges(true);for(const notify of [...listeners])notify();}});
 server=createAppServer({store,covers,spines,jobs,publicDir:path.resolve('public'),catalog:{search:async()=>[]}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,token=(await (await fetch(origin+'/api/bootstrap')).json()).token;
 t.after(async()=>{await jobs.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return {store,jobs,provider,calls:()=>calls,ticket:async i=>(await store.beginSpine(store.read().books[i].id,{expectedRevision:store.read().revision})).ticket,
  post:body=>fetch(origin+'/api/spines/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Bookshelf-Token':token},body:JSON.stringify(body)}),
  finished:bookId=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(check);reject(new Error('spine job did not settle'));},1000);function check(){const job=jobs.status().jobs.find(j=>j.bookId===bookId);if(job&&['ready','failed'].includes(job.state)){clearTimeout(timer);listeners.delete(check);resolve(job);}}listeners.add(check);check();})};
}
const input=a=>({bookId:a.store.read().books[1].id,expectedRevision:a.store.read().revision,force:false,reuseOnly:true});

test('retired HTTP reuse cannot dispatch after the former daily paid quota is exhausted',async t=>{
 const a=await fixture(t);for(let i=0;i<10;i++)await a.jobs.enqueue(await a.ticket(0),{force:true}).done;
 const body=input(a),before=a.store.read(),response=await a.post(body);assert.equal(response.status,410);
 assert.deepEqual(a.store.read(),before);assert.equal(a.calls(),10);assert.equal(a.jobs.status().attempts,10);
});

test('retired HTTP reuse with a missing cache never falls back to a paid request',async t=>{
 const a=await fixture(t),body=input(a),response=await a.post(body);assert.equal(response.status,410);
 assert.equal(a.store.read().books[1].spine,null);assert.equal(a.calls(),0);assert.equal(a.jobs.status().attempts,0);
});

test('old HTTP cache reuse cannot replace artwork even when a legacy cache exists',async t=>{
 const a=await fixture(t);await a.jobs.enqueue(await a.ticket(0)).done;a.provider.available=false;const body=input(a),response=await a.post(body);
 assert.equal(response.status,410);assert.equal(a.calls(),1);assert.equal(a.jobs.status().attempts,1);assert.equal(a.store.read().books[1].spine,null);
});

test('every legacy reuse mode is retired before creating a generation ticket',async t=>{
 const a=await fixture(t),body=input(a),before=a.store.read();
 for(const patch of [{reuseOnly:'true'},{reuseOnly:null},{reuseOnly:true,force:true}])assert.equal((await a.post({...body,...patch})).status,410);
 assert.equal(a.store.read().revision,before.revision);assert.equal(a.store.read().books[1].spineGeneration,before.books[1].spineGeneration);assert.equal(a.calls(),0);
});
