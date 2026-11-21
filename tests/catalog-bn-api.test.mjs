import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCatalog} from '../src/catalog.mjs';import {createAppServer} from '../src/server.mjs';import {openStore} from '../src/store.mjs';import {catalogDraft} from '../public/manager/catalog-selection.mjs';import {validateBackup} from '../src/backup.mjs';
const fixtures=JSON.parse(await fs.readFile(new URL('./fixtures/bn-books.json',import.meta.url),'utf8'));
test('real catalogue HTTP search, selection, save, export and store reopen preserve a BN book',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-bn-')),store=await openStore(dataDir);
 const catalog=createCatalog({clock:{now:()=>Date.now(),sleep:async()=>{}},fetchImpl:async input=>{
  const url=new URL(input);return Response.json(url.hostname==='data.bn.org.pl'?{bibs:fixtures.find(x=>x.query==='Dziwne obrazki').records,nextPage:null}:{docs:[],numFound:0});
 }});
 const server=createAppServer({store,catalog,publicDir:path.resolve('public')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
 const search=await fetch(origin+'/api/search?paged=1&q=Dziwne%20obrazki');assert.equal(search.status,200);const page=await search.json();assert.equal(page.items[0].title,'Dziwne obrazki');
 const item=page.items[0],edition=await (await fetch(origin+'/api/edition?id='+encodeURIComponent(item.editionId))).json();assert.equal(edition.id,item.id);
 const {token}=await (await fetch(origin+'/api/bootstrap')).json();
 const response=await fetch(origin+'/api/commands',{method:'POST',headers:{Origin:origin,'X-Bookshelf-Token':token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,command:{type:'addBook',draft:{...catalogDraft(item,edition),shelfId:'crime',status:'read'}}})});assert.equal(response.status,200);
 const saved=(await response.json()).books[0];assert.equal(saved.provider,'bn');assert.equal(saved.authors.join(', '),'Uketsu');
 const reopened=await openStore(dataDir);assert.deepEqual(reopened.read().books[0],saved);
 const backup=await (await fetch(origin+'/api/export')).json();assert.deepEqual(validateBackup(backup).state.books[0],saved);
 const legacy=await (await fetch(origin+'/api/search?q=Dziwne%20obrazki')).json();assert.ok(Array.isArray(legacy));assert.equal(legacy[0].title,'Dziwne obrazki');
 assert.equal((await fetch(origin+'/api/search?paged=1&q=Dziwne%20obrazki&cursor=bad')).status,400);
});
