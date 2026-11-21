import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createAppServer} from '../src/server.mjs';import {openStore} from '../src/store.mjs';import {openCoverStore} from '../src/covers.mjs';import {openSpineStore} from '../src/spine-assets.mjs';import {png,variant} from './helpers/service-images.mjs';
async function app(t){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-image-url-')),store=await openStore(dataDir),covers=await openCoverStore(dataDir),spines=await openSpineStore(dataDir),downloads=[];
  const imageDownloader=async(url,{signal})=>{downloads.push(url);signal.throwIfAborted();if(url.includes('bad'))throw Object.assign(Error('Podaj bezpośredni link do obrazu.'),{code:'INVALID'});return {bytes:png,mime:'image/png'};};
  const server=createAppServer({store,covers,spines,imageDownloader,catalog:{search:async()=>[]},publicDir:path.resolve('public')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const {token}=await (await fetch(origin+'/api/bootstrap')).json();
  const post=(route,body,extra={})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'X-Bookshelf-Token':token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  return {dataDir,store,covers,spines,downloads,origin,post};
}
test('URL download requires local ownership and remains a read-only preview until the user saves',async t=>{
  const a=await app(t),url='https://images.example/cover.png';
  assert.equal((await a.post('/api/images/from-url',{url},{'X-Bookshelf-Token':''})).status,403);assert.equal(a.downloads.length,0);
  const state=a.store.read(),response=await a.post('/api/images/from-url',{url});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{mime:'image/png',base64:png.toString('base64')});assert.deepEqual(a.store.read(),state);assert.deepEqual(await fs.readdir(path.join(a.dataDir,'covers')),[]);
  assert.equal((await a.post('/api/images/from-url',{url,headers:{Authorization:'secret'}})).status,400);assert.equal(a.downloads.length,1);
});
test('a URL cover uses the ordinary local image store and survives reopening without its URL',async t=>{
  const a=await app(t),response=await a.post('/api/images/from-url',{url:'https://images.example/cover.png'});assert.equal(response.status,200);
  const image=await response.json(),cover=await (await a.post('/api/covers',image)).json();assert.ok(cover.coverId);
  const saved=await a.post('/api/commands',{expectedRevision:0,command:{type:'addBook',draft:{title:'Próba URL',authors:['Autor'],shelfId:'fantasy',status:'read',coverId:cover.coverId}}});assert.equal(saved.status,200);
  const reopened=await openStore(a.dataDir);assert.equal(reopened.read().books[0].coverId,cover.coverId);
  assert.doesNotMatch(JSON.stringify(reopened.read()),/images\.example/);assert.deepEqual((await (await openCoverStore(a.dataDir)).read(cover.coverId)).bytes,png);
  assert.deepEqual(Buffer.from(await (await fetch(a.origin+'/covers/'+cover.coverId)).arrayBuffer()),png);assert.equal(a.downloads.length,1);
});
test('a bad URL never changes the saved spine and a successful URL uses the manual upload guard',async t=>{
  const a=await app(t);await a.store.commit({type:'addBook',draft:{title:'Solaris',authors:['Lem'],shelfId:'fantasy',status:'read'}},0);
  const book=a.store.read().books[0],old=await a.spines.put(variant('old'),'image/png');
  await a.store.commit({type:'setBookSpine',id:book.id,spine:{kind:'manual',assetId:old.assetId}},1);const before=a.store.read();
  const failed=await a.post('/api/images/from-url',{url:'https://images.example/bad'});assert.equal(failed.status,400);assert.deepEqual(a.store.read(),before);
  const response=await a.post('/api/images/from-url',{url:'https://images.example/spine.png'});assert.equal(response.status,200);const image=await response.json();
  assert.equal((await a.post('/api/spines/upload',{...image,bookId:book.id,expectedRevision:1})).status,409);assert.deepEqual(a.store.read(),before);
  const accepted=await a.post('/api/spines/upload',{...image,bookId:book.id,expectedRevision:before.revision});assert.equal(accepted.status,200);
  const saved=await accepted.json();assert.equal(saved.books[0].spine.kind,'manual');assert.notEqual(saved.books[0].spine.assetId,old.assetId);assert.equal(a.downloads.length,2);
});
