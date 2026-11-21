import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {createOpenLibraryCatalog as createCatalog} from '../src/open-library-catalog.mjs';
import {createAppServer} from '../src/server.mjs';
import {createInitialState} from '../src/domain.mjs';

const immediateClock={now:()=>Date.now(),sleep:async()=>{}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const result=title=>({docs:[{key:'/works/OL1W',title,author_name:['Test author']}]});
const reply=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
async function within(promise,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(message)),1000))]);}finally{clearTimeout(timer);}}
async function listen(t,server){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});return 'http://127.0.0.1:'+server.address().port;}
async function upstream(t,handler){
 const requests=[];const origin=await listen(t,http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);handler(req,res,url);}));
 return {requests,fetchImpl:(url,options)=>{const target=new URL(url);return fetch(origin+target.pathname+target.search,options);}};
}
const outcome=promise=>promise.then(value=>({value}),error=>({error}));

test('an abandoned queued query settles immediately and never delays the useful query',async t=>{
 const started=deferred(),release=deferred();t.after(()=>release.resolve());
 const provider=await upstream(t,async(req,res,url)=>{const q=url.searchParams.get('q');if(q==='blocker'){started.resolve();await release.promise;}reply(res,result(q));});
 const catalog=createCatalog({...provider,clock:immediateClock});
 const blocker=outcome(catalog.search('blocker'));await started.promise;
 const controller=new AbortController();const obsolete=outcome(catalog.search('obsolete',{signal:controller.signal}));const newest=outcome(catalog.search('newest'));controller.abort();
 try{const aborted=await within(obsolete,'cancelled queue entry stayed pending behind the upstream request');assert.equal(aborted.error?.name,'AbortError');}
 finally{release.resolve();await Promise.all([blocker,obsolete,newest]);}
 assert.equal((await blocker).value[0].title,'blocker');assert.equal((await newest).value[0].title,'newest');
 assert.deepEqual(provider.requests.map(x=>new URL(x,'http://localhost').searchParams.get('q')),['blocker','newest']);
});

test('cancelling the only active consumer releases the queue without waiting for its response',async t=>{
 const started=deferred(),closed=deferred(),release=deferred();t.after(()=>release.resolve());
 const provider=await upstream(t,async(req,res,url)=>{const q=url.searchParams.get('q');if(q==='obsolete'){res.once('close',()=>{if(!res.writableEnded)closed.resolve();});started.resolve();await release.promise;}reply(res,result(q));});
 const catalog=createCatalog({...provider,clock:immediateClock});const controller=new AbortController();
 const obsolete=outcome(catalog.search('obsolete',{signal:controller.signal}));await started.promise;controller.abort();
 try{assert.equal((await within(obsolete,'abandoned active query stayed pending')).error?.name,'AbortError');await within(closed.promise,'upstream connection remained open');assert.equal((await within(catalog.search('newest'),'latest query waited for an abandoned response'))[0].title,'newest');}
 finally{release.resolve();}
});

test('identical lookups share upstream work while each consumer can cancel independently',async t=>{
 const started=deferred(),release=deferred();t.after(()=>release.resolve());
 const provider=await upstream(t,async(req,res)=>{started.resolve();await release.promise;reply(res,result('Solaris'));});
 const catalog=createCatalog({...provider,clock:immediateClock}),firstController=new AbortController(),secondController=new AbortController();
 const first=outcome(catalog.search('Solaris',{signal:firstController.signal}));await started.promise;
 const second=outcome(catalog.search(' Solaris ',{signal:secondController.signal}));firstController.abort();
 try{assert.equal((await within(first,'one cancelled consumer remained pending')).error?.name,'AbortError');}
 finally{release.resolve();await Promise.all([first,second]);}
 assert.equal((await second).value[0].title,'Solaris');assert.equal(provider.requests.length,1);
 const cached=await catalog.search('Solaris');cached[0].title='Changed locally';assert.equal((await catalog.search('Solaris'))[0].title,'Solaris');assert.equal(provider.requests.length,1);
});

test('a previously aborted consumer does not make any catalogue request',async t=>{
 const provider=await upstream(t,(req,res)=>reply(res,result('Solaris'))),catalog=createCatalog({...provider,clock:immediateClock}),controller=new AbortController();controller.abort();
 await assert.rejects(catalog.search('Solaris',{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(provider.requests.length,0);
});

test('cancellation during optional work metadata cannot return an incomplete edition',async t=>{
 const started=deferred(),release=deferred();t.after(()=>release.resolve());
 const provider=await upstream(t,async(req,res,url)=>{if(url.pathname.startsWith('/works/')){started.resolve();await release.promise;reply(res,{subjects:['Fantasy']});}else reply(res,{key:'/books/OL1M',title:'Matilda',authors:[],works:[{key:'/works/OL2W'}]});});
 const catalog=createCatalog({...provider,clock:immediateClock}),controller=new AbortController(),pending=outcome(catalog.search('9780140328721',{signal:controller.signal}));await started.promise;controller.abort();
 try{assert.equal((await within(pending,'cancelled edition lookup continued waiting for work metadata')).error?.name,'AbortError');}
 finally{release.resolve();}
});

test('useful upstream calls retain pacing and successful cached lookups use no new slot',async t=>{
 let now=10000;const starts=[];const provider=await upstream(t,(req,res,url)=>{starts.push(now);reply(res,result(url.searchParams.get('q')));});
 const catalog=createCatalog({...provider,clock:{now:()=>now,sleep:async ms=>{now+=ms;}}});
 const [first,second,third]=await Promise.all([catalog.search('one'),catalog.search('two'),catalog.search('three')]);assert.deepEqual([first[0].title,second[0].title,third[0].title],['one','two','three']);assert.deepEqual(starts,[10000,11000,12000]);
 await catalog.search('one');assert.deepEqual(starts,[10000,11000,12000]);
});

test('a failed shared request does not prevent a later attempt',async t=>{
 let requests=0;const provider=await upstream(t,(req,res)=>{if(++requests===1){res.writeHead(429);res.end();}else reply(res,result('Solaris'));});const catalog=createCatalog({...provider,clock:immediateClock});
 await assert.rejects(catalog.search('Solaris'),e=>e.code==='CATALOG_UNAVAILABLE');assert.equal((await catalog.search('Solaris'))[0].title,'Solaris');assert.equal(requests,2);
});

for(const route of ['/api/search?q=obsolete','/api/edition?id=%2Fbooks%2FOL1M'])test('HTTP disconnect cancels upstream work for '+route,async t=>{
 const started=deferred(),closed=deferred(),release=deferred();t.after(()=>release.resolve());
 const provider=await upstream(t,async(req,res,url)=>{if(url.searchParams.get('q')==='obsolete'||url.pathname==='/books/OL1M.json'){res.once('close',()=>{if(!res.writableEnded)closed.resolve();});started.resolve();await release.promise;}reply(res,result('Newest'));});
 const catalog=createCatalog({...provider,clock:immediateClock}),state=createInitialState();
 const server=createAppServer({store:{read:()=>state,recovery:'none'},catalog,publicDir:path.resolve('public')});const origin=await listen(t,server);
 const request=http.get(origin+route);request.on('error',()=>{});await started.promise;request.destroy();
 try{await within(closed.promise,'client disconnect did not close the upstream catalogue connection');const response=await within(fetch(origin+'/api/search?q=newest'),'latest HTTP query was blocked by disconnected request');assert.equal(response.status,200);assert.equal((await response.json())[0].title,'Newest');}
 finally{release.resolve();}
});
