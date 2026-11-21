import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {canonicalIsbn,createBookIdentityIndex} from '../public/shared/book-identity.mjs';
import {parseGoodreadsCsv} from '../src/goodreads-csv.mjs';
const book=(patch={})=>({id:'first',title:'Matylda',authors:['Autor'],isbn:null,goodreadsId:null,...patch});
test('ISBN10 and ISBN13 identify one edition; Goodreads identity survives title edits',()=>{
 assert.equal(canonicalIsbn('0140328726'),'9780140328721');assert.equal(canonicalIsbn('9780140328721'),'9780140328721');assert.equal(canonicalIsbn(null),null);
 const index=createBookIdentityIndex([book({isbn:'0140328726',goodreadsId:'123'})]);
 assert.deepEqual(index.find(book({isbn:'9780140328721',goodreadsId:'124'})),{id:'first',reason:'isbn'});
 assert.deepEqual(index.find(book({title:'Poprawiona',authors:['Ktoś'],isbn:'9780553386790',goodreadsId:'123'})),{id:'first',reason:'goodreads'});
});
test('identity fallback normalizes whitespace and NFKC while preserving punctuation and accents',()=>{
 const index=createBookIdentityIndex([book({title:'  Żółw   ２ ',authors:['KOWALSKI,  JAN']})]);
 assert.equal(index.find(book({title:'żółw 2',authors:['kowalski, jan']})).reason,'title-author');
 assert.equal(index.find(book({title:'zolw 2',authors:['kowalski, jan']})),null);
 assert.equal(index.find(book({title:'żółw 2',authors:['kowalski jan']})),null);
});
test('distinct comparable strong IDs keep editions; disjoint ID classes use fallback',()=>{
 for(const [existing,candidate,reason] of [
  [{isbn:'0140328726'},{isbn:'9780553386790'},null],
  [{goodreadsId:'1'},{goodreadsId:'2'},null],
  [{isbn:'0140328726'},{goodreadsId:'2'},'title-author'],
  [{isbn:'0140328726',goodreadsId:'1'},{goodreadsId:'2'},null],
  [{isbn:'0140328726',goodreadsId:'1'},{},'title-author'],
  [{},{isbn:'0140328726',goodreadsId:'1'},'title-author']
 ])assert.equal(createBookIdentityIndex([book(existing)]).find(book(candidate))?.reason??null,reason);
});
test('identity buckets consider later identifierless entries and retain first match',()=>{
 const index=createBookIdentityIndex([book({isbn:'0140328726',goodreadsId:'1'}),book({id:'no-isbn',goodreadsId:'2'}),book({id:'neither'}),book({id:'later'})]);
 assert.deepEqual(index.find(book({isbn:'9780553386790',goodreadsId:'3'})),{id:'neither',reason:'title-author'});
 assert.deepEqual(index.find(book({isbn:'9780553386790'})),{id:'no-isbn',reason:'title-author'});
});
test('identity handles 10000 colliding names with strong identifiers and all distinct names',()=>{
 const books=Array.from({length:10000},(_,i)=>book({id:String(i),goodreadsId:String(i+1)}));const index=createBookIdentityIndex(books);
 for(let i=0;i<10000;i++){assert.equal(index.find(book({goodreadsId:String(i+1)})).id,String(i));assert.equal(index.find(book({goodreadsId:String(10001+i)})),null);}
 const distinct=createBookIdentityIndex(books.map((b,i)=>({...b,title:'Tytuł '+i})));
 for(let i=0;i<10000;i++)assert.equal(distinct.find(book({title:'Tytuł '+i})).id,String(i));
});
test('literal CSV editions find first valid duplicate row without collapsing distinct editions',async()=>{
 const {records}=parseGoodreadsCsv(await fs.readFile(new URL('./fixtures/goodreads/duplicate-editions.csv',import.meta.url)));const index=createBookIdentityIndex();
 const found=records.map(row=>{assert.ok(row.candidate);const match=index.find(row.candidate);if(!match)index.add({...row.candidate,id:String(row.recordNumber)});return match;});
 assert.deepEqual(found,[null,{id:'1',reason:'isbn'},null,{id:'1',reason:'title-author'},{id:'1',reason:'goodreads'}]);
});
