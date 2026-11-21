import test from 'node:test';
import assert from 'node:assert/strict';
const {collectionView}=await import('../public/manager/collection-view.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const book=(id,title,shelfId='fantasy',order=0,patch={})=>({id,title,shelfId,order,authors:['Autor'],status:'read',readDate:null,isbn:null,...patch});
const state=(books,sort='manual')=>({books,shelves:[{id:'fantasy',name:'Fantastyka',order:0},{id:'crime',name:'Kryminał',order:1}],settings:{sort}});
function view(s,options={}){assert.equal(typeof collectionView,'function');return collectionView(s,options);}
test('all-books title sort crosses shelf boundaries',()=>{
 const result=view(state([book('b','B','fantasy'),book('a','A','crime')],'title-asc'));
 assert.deepEqual(result.books.map(b=>b.id),['a','b']);
});
test('all-books completion-date sort crosses shelves and leaves missing dates last',()=>{
 const result=view(state([book('old','C','fantasy',0,{readDate:'2020-01-01'}),book('missing','A'),book('new','D','crime',0,{readDate:'2026-10-08'})],'read-newest'));
 assert.deepEqual(result.books.map(b=>b.id),['new','old','missing']);
});
test('manual view preserves shelf order and full-shelf movement positions under filtering',()=>{
 const s=state([book('last','C','fantasy',2),book('first','B','fantasy',0,{status:'reading'}),book('middle','Match','fantasy',1),book('crime','A','crime')]);
 assert.deepEqual(view(s).books.map(b=>b.id),['first','middle','last','crime']);
 const result=view(s,{query:'Match',status:'read'});
 assert.deepEqual(result.books.map(b=>b.id),['middle']);
 assert.deepEqual(result.positions.get('middle'),{index:1,count:3});
});
test('local collection search matches Polish accents, authors and ISBN with combined filters',()=>{
 const s=state([book('pol','Żółć','crime',0,{authors:['Łukasz Łódzki'],isbn:'9780140328721'}),book('other','Zolc','fantasy',0,{authors:['Inny'],status:'reading'})],'title-asc');
 assert.deepEqual(view(s,{query:'ZOLC lukasz',shelfId:'crime',status:'read'}).books.map(b=>b.id),['pol']);
 assert.deepEqual(view(s,{query:'9780140328721'}).books.map(b=>b.id),['pol']);
 assert.equal(view(s,{query:'nieznana'}).total,0);
});
test('gallery pages are bounded, clamped and preserve all filtered books',()=>{
 const books=Array.from({length:91},(_,i)=>book('id'+i,'Book '+i,'fantasy',i));
 const s=state(books),first=view(s),last=view(s,{page:99});
 assert.equal(first.books.length,60);assert.equal(first.total,91);assert.equal(first.pages,2);assert.equal(first.page,0);
 assert.equal(last.page,1);assert.equal(last.books.length,31);
 assert.deepEqual([...first.books,...last.books].map(b=>b.id),books.map(b=>b.id));
 assert.equal(view(s,{page:-10}).page,0);assert.equal(view(state([])).pages,1);
});
test('large collection visits are bounded by indexing rather than filtering for every card',()=>{
 let visits=0;const raw=Array.from({length:10000},(_,i)=>book('id'+i,'Title '+i,'fantasy',i));
 const books=new Proxy(raw,{get(target,key,receiver){if(typeof key==='string'&&/^\\d+$/.test(key))visits++;return Reflect.get(target,key,receiver);}});
 const result=view(state(books));assert.equal(result.books.length,60);
 assert.ok(visits<=50000,'Full collection should be indexed a bounded number of times: '+visits);
});
test('view computation does not mutate saved books or manual order',()=>{
 const s=state([book('b','B','fantasy',0),book('a','A','fantasy',1)],'title-asc'),before=JSON.stringify(s);
 view(s,{query:'a'});assert.equal(JSON.stringify(s),before);
});
