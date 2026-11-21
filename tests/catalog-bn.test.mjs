import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createCatalog} from '../src/catalog.mjs';
import {catalogDraft} from '../public/manager/catalog-selection.mjs';
import {createInitialState,applyCommand,validateState} from '../src/domain.mjs';
import {createBackup,validateBackup} from '../src/backup.mjs';

const fixtures=JSON.parse(await fs.readFile(new URL('./fixtures/bn-books.json',import.meta.url),'utf8'));
const clock={now:()=>Date.now(),sleep:async()=>{}};
const rows=query=>fixtures.find(x=>x.query.toLocaleLowerCase('pl')===query.toLocaleLowerCase('pl'))?.records??[];
const bn=(records,nextPage=null)=>Response.json({bibs:records,nextPage});
const empty=()=>Response.json({docs:[],numFound:0});
function publicCatalog(handler){return createCatalog({clock,fetchImpl:async(input,options)=>{const url=new URL(input);return handler(url,options);}});}
function provider(url){return url.hostname==='data.bn.org.pl';}

for(const [query,authors,isbn,year] of [
 ['Odwaga bycia nielubianym',['Ichiro Kishimi','Fumitake Koga'],'9788375796025','2017'],
 ['Dziwne obrazki',['Uketsu'],'9788383821726','2025'],
 ['Rozproszone umysły',['Gabor Maté'],'9788382523911','2023']
])test('finds the real BN record absent from Open Library: '+query,async()=>{
 const catalog=publicCatalog(url=>provider(url)?bn(url.searchParams.has('title')?rows(query):[]):empty());
 const results=await catalog.search(query),book=results[0];
 assert.ok(book?.title.startsWith(query));assert.deepEqual(book.authors,authors);assert.equal(book.isbn,isbn);assert.equal(book.publicationYear,year);assert.equal(book.provider,'bn');assert.match(book.editionId,/^bn:\d+$/);assert.equal(book.language,'pol');assert.equal(book.coverId,null);
 assert.ok(!book.title.includes('/'));assert.ok(!book.authors.some(a=>/Cieślak|Manasterska|Owca/.test(a)));
});

test('BN selection preserves provider, edition date, subjects, and survives domain serialization',async()=>{
 const catalog=publicCatalog(url=>provider(url)?bn(rows('Dziwne obrazki')):empty());
 const item=(await catalog.search('Dziwne obrazki'))[0],draft=catalogDraft(item,null);
 assert.equal(draft.provider,'bn');assert.equal(draft.providerId,'bn:1000006179873');assert.equal(draft.publicationYear,'2025');assert.ok(draft.subjects.includes('Kryminał'));
 const state=applyCommand(createInitialState(),{type:'addBook',draft:{...draft,shelfId:'crime',status:'read'}});
 assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))),state);
 assert.deepEqual(validateBackup(await createBackup(state,{})).state,state);
 assert.throws(()=>applyCommand(state,{type:'addBook',draft:{...draft,shelfId:'crime',status:'read'}}),e=>e.code==='DUPLICATE'||e.code==='INVALID');
});

test('ISBN lookup finds BN, preserves the requested alternate ISBN, and resolves only a matching BN id',async()=>{
 const catalog=publicCatalog(url=>provider(url)?bn(rows('Rozproszone umysły')):new Response('',{status:404}));
 const [book]=await catalog.search('9788381434607');assert.equal(book.isbn,'9788381434607');
 const edition=await catalog.resolveEdition(book.editionId);assert.equal(edition.title,book.title);
 const draft=catalogDraft(book,edition);assert.equal(draft.isbn,'9788381434607');
 const saved=applyCommand(createInitialState(),{type:'addBook',draft:{...draft,shelfId:'other',status:'read'}});assert.equal(saved.books[0].isbn,'9788381434607');
 assert.equal(await catalog.resolveEdition('bn:123'),null);
 await assert.rejects(catalog.resolveEdition('bn:../private'),e=>e.code==='INVALID');
});

test('searching an author uses BN author fields without treating a translator as an author',async()=>{
 const requests=[];const catalog=publicCatalog(url=>{requests.push(url);return provider(url)?bn(url.searchParams.get('author')==='Uketsu'?rows('Dziwne obrazki'):[]):empty();});
 assert.equal((await catalog.search('Uketsu'))[0].title,'Dziwne obrazki');
 assert.ok(requests.some(url=>url.searchParams.get('author')==='Uketsu'));
 const translated=publicCatalog(url=>provider(url)?bn(rows('Dziwne obrazki')):empty());
 assert.deepEqual(await translated.search('Sara Manasterska'),[]);
});

test('one failed provider returns usable results and an honest partial-results warning',async()=>{
 const catalog=publicCatalog(url=>provider(url)?bn(rows('Dziwne obrazki')):new Response('',{status:503}));
 const page=await catalog.searchPage('Dziwne obrazki');assert.equal(page.items[0].title,'Dziwne obrazki');assert.match(page.warnings.join(' '),/Open Library/);
 const unavailable=publicCatalog(()=>new Response('',{status:503}));await assert.rejects(unavailable.search('Solaris'),e=>e.code==='CATALOG_UNAVAILABLE');
});

test('paging exposes later Open Library matches and does not follow external BN URLs',async()=>{
 const seen=[];const catalog=publicCatalog(url=>{seen.push(url.href);if(provider(url))return bn([],null);const page=Number(url.searchParams.get('page')??1);return Response.json({numFound:73,docs:Array.from({length:20},(_,i)=>({key:'/works/OL'+((page-1)*20+i+1)+'W',title:'Mróz '+((page-1)*20+i+1),author_name:['Remigiusz Mróz']}))});});
 const first=await catalog.searchPage('Remigiusz Mróz');assert.ok(first.nextCursor);assert.equal(first.items.length,20);
 const second=await catalog.searchPage('Remigiusz Mróz',{cursor:first.nextCursor});assert.ok(second.items.some(book=>book.title==='Mróz 21'));assert.equal(second.items.length,20);
 await assert.rejects(catalog.searchPage('Different query',{cursor:first.nextCursor}),e=>e.code==='INVALID');
 const hostile=publicCatalog(url=>provider(url)?bn(rows('Dziwne obrazki'),'http://127.0.0.1/private'):empty());
 const result=await hostile.searchPage('Dziwne obrazki');assert.equal(result.nextCursor,null);assert.ok(result.warnings.length);
 assert.ok(seen.every(url=>/^https:\/\/(openlibrary.org|data.bn.org.pl)\//.test(url)));
});

test('deleted and non-book records are ignored; duplicate BN author/title hits are collapsed',async()=>{
 const record=rows('Dziwne obrazki').find(x=>x.id===1000006179873);
 const catalog=publicCatalog(url=>provider(url)?bn([record,{...record,id:9,deleted:true},{...record,id:10,kind:'audiobook'}]):empty());
 assert.equal((await catalog.search('Dziwne obrazki')).length,1);
});

test('equal ISBNs across providers merge without losing the Open Library cover or BN subjects',async()=>{
 const record=rows('Dziwne obrazki').find(x=>x.id===1000006179873);
 const catalog=publicCatalog(url=>provider(url)?bn([record]):Response.json({key:'/books/OL1M',title:'Dziwne obrazki',isbn_13:['9788383821726'],covers:[42],authors:[]}));
 const result=await catalog.search('9788383821726');assert.equal(result.length,1);assert.equal(result[0].coverId,42);assert.ok(result[0].subjects.includes('Kryminał'));assert.deepEqual(result[0].authors,['Uketsu']);
});

test('BN pages advance by the validated numeric cursor and keep the original query',async()=>{
 const record=rows('Dziwne obrazki').find(x=>x.id===1000006179873),seen=[];
 const catalog=publicCatalog(url=>{
  if(!provider(url))return empty();seen.push(url);
  if(url.searchParams.has('author'))return bn([]);
  return url.searchParams.has('sinceId')?bn([{...record,id:1000006179874}]):bn([record],'https://data.bn.org.pl/api/institutions/bibs.json?sinceId=1000006179874');
 });
 const first=await catalog.searchPage('Dziwne obrazki'),second=await catalog.searchPage('Dziwne obrazki',{cursor:first.nextCursor});
 assert.equal(second.items[0].id,'bn:1000006179874');assert.ok(seen.some(url=>url.searchParams.get('title')==='Dziwne obrazki'&&url.searchParams.get('sinceId')==='1000006179874'));
});

test('combined search shares BN requests but cancellation belongs to each caller',async()=>{
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);let requests=0;
 const catalog=createCatalog({clock,fetchImpl:async(input,options)=>{
  const url=new URL(input);if(!provider(url))return empty();requests++;started();
  await Promise.race([wait,new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))]);
  return bn(rows('Dziwne obrazki'));
 }});
 const controller=new AbortController(),first=catalog.search('Dziwne obrazki',{signal:controller.signal}).catch(e=>e);
 await ready;const second=catalog.search('Dziwne obrazki');controller.abort();release();
 assert.equal((await first).name,'AbortError');assert.equal((await second)[0].title,'Dziwne obrazki');assert.equal(requests,2);
});
