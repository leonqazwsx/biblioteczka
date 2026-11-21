import test from 'node:test';import assert from 'node:assert/strict';import {applyCommand,createInitialState} from '../src/domain.mjs';
function fixture(){let s=createInitialState();for(const [title,shelfId,status,readDate]of [['A','fantasy','reading','2024-02-29'],['B','fantasy','to-read',null],['C','crime','read','2025-01-01'],['D','crime','reading',null]])s=applyCommand(s,{type:'addBook',draft:{title,authors:['Autor'],shelfId,status,readDate}});return s;}
test('legacy bulk normalization is one atomic revision and preserves unrelated books and dates',()=>{
 const before=fixture(),ids=before.books.slice(0,2).map(b=>b.id),next=applyCommand(before,{type:'bulkUpdateBooks',ids,patch:{status:'read'}});
 assert.equal(next.revision,before.revision+1);assert.deepEqual(next.books.map(b=>b.status),['read','read','read','read']);
 assert.equal(next.books[0].readDate,'2024-02-29');assert.equal(next.books[1].readDate,null);assert.deepEqual(next.books[2],before.books[2]);assert.equal(before.books[0].status,'read');
});
test('bulk shelf appends moved books in chosen order and keeps contiguous source order',()=>{
 const before=fixture(),next=applyCommand(before,{type:'bulkUpdateBooks',ids:[before.books[1].id,before.books[0].id],patch:{shelfId:'crime',readDate:'2026-10-09'}});
 assert.deepEqual(next.books.filter(b=>b.shelfId==='crime').sort((a,b)=>a.order-b.order).map(b=>b.title),['C','D','B','A']);
 assert.equal(next.books.find(b=>b.title==='A').readDate,'2026-10-09');assert.equal(next.books.find(b=>b.title==='C').readDate,'2025-01-01');
});
test('bulk validation rejects missing or repeated selection and leaves the source unchanged',()=>{
 const before=fixture(),copy=structuredClone(before),id=before.books[0].id;
 for(const cmd of [{ids:[id,'missing'],patch:{status:'read'}},{ids:[id,id],patch:{status:'read'}},{ids:[],patch:{status:'read'}},{ids:[id],patch:{title:'Override'}},{ids:[id],patch:{}},{ids:[id],patch:{shelfId:'missing'}},{ids:[id],patch:{readDate:'2026-02-29'}}])assert.throws(()=>applyCommand(before,{type:'bulkUpdateBooks',...cmd}));
 assert.deepEqual(before,copy);
});