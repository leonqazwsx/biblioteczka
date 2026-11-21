import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openCoverStore} from '../src/covers.mjs';
import {png} from './helpers/service-images.mjs';
import {createStorageGate,guardStorage} from '../src/asset-maintenance.mjs';

async function store(t,fetchImpl){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-isbn-cover-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,covers:await openCoverStore(root,{fetchImpl})};
}
test('ISBN lookup canonicalizes ISBN-10 and saves an offline cover without a catalogue cover ID',async t=>{
 const calls=[],{root,covers}=await store(t,async(url,options)=>{calls.push({url,options});return new Response(png);});
 assert.equal(typeof covers.fetchIsbnCover,'function');
 const saved=await covers.fetchIsbnCover('0-14-032872-6');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg?default=false');
 assert.equal(calls[0].options.redirect,'manual');assert.ok(calls[0].options.signal);
 assert.deepEqual((await (await openCoverStore(root)).read(saved.coverId)).bytes,png);
});
test('an absent ISBN cover is distinct from a provider outage and stores no placeholder',async t=>{
 let status=404;const {root,covers}=await store(t,async()=>new Response(null,{status}));
 assert.equal(typeof covers.fetchIsbnCover,'function');
 assert.equal(await covers.fetchIsbnCover('9788375796025'),null);
 assert.deepEqual(await fs.readdir(path.join(root,'covers')),[]);
 status=429;await assert.rejects(()=>covers.fetchIsbnCover('9788375796025'),{code:'COVER_UNAVAILABLE'});
});
test('invalid ISBNs and URLs never reach the cover provider',async t=>{
 let calls=0;const {covers}=await store(t,async()=>{calls++;return new Response(png);});
 assert.equal(typeof covers.fetchIsbnCover,'function');
 for(const value of ['9788375796026','https://127.0.0.1/private','../book',123,null,''])await assert.rejects(()=>covers.fetchIsbnCover(value),{code:'INVALID_ISBN'});
 assert.equal(calls,0);
});
test('ISBN lookup rejects foreign redirects and malformed images without saving',async t=>{
 let reply=()=>new Response(null,{status:302,headers:{location:'https://other.example/cover.jpg'}});
 const {root,covers}=await store(t,async()=>reply());assert.equal(typeof covers.fetchIsbnCover,'function');
 await assert.rejects(()=>covers.fetchIsbnCover('9780140328721'),{code:'INVALID'});
 reply=()=>new Response(Buffer.from('<html>not a cover</html>'));await assert.rejects(()=>covers.fetchIsbnCover('9780140328721'));
 reply=()=>new Response(png.subarray(0,20));await assert.rejects(()=>covers.fetchIsbnCover('9780140328721'));
 assert.deepEqual(await fs.readdir(path.join(root,'covers')),[]);
});
test('cancelling ISBN lookup prevents both the remote request and a late save',async t=>{
 const controller=new AbortController();let calls=0,saves=0;
 const {covers}=await store(t,async()=>{calls++;controller.abort();return new Response(png);});
 assert.equal(typeof covers.fetchIsbnCover,'function');
 await assert.rejects(()=>covers.fetchIsbnCover('9780140328721',{signal:controller.signal,save:()=>saves++}),{name:'AbortError'});
 assert.equal(calls,1);assert.equal(saves,0);
 await assert.rejects(()=>covers.fetchIsbnCover('9780140328721',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});
test('a production cover save rechecks cancellation after waiting for the shared storage gate',async t=>{
 const {root,covers:rawCovers}=await store(t,async()=>new Response(png));
 const realGate=createStorageGate();let release,started,queued;
 const startedPromise=new Promise(resolve=>started=resolve),queuedPromise=new Promise(resolve=>queued=resolve);
 const holding=realGate(async()=>{started();await new Promise(resolve=>release=resolve);});await startedPromise;
 const gate=operation=>{const pending=realGate(operation);queued();return pending;};
 const {covers}=guardStorage({dataDir:root,store:{},covers:rawCovers,spines:{},gate});
 const controller=new AbortController(),pending=covers.fetchIsbnCover('9780140328721',{signal:controller.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await queuedPromise;controller.abort();release();await holding;await rejected;
 assert.deepEqual(await fs.readdir(path.join(root,'covers')),[]);
});
