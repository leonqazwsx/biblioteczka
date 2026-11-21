import test from 'node:test';
import assert from 'node:assert/strict';
const {readingDateLabel}=await import('../public/shared/reading-date.mjs').catch(()=>({readingDateLabel:()=>null}));
test('read date label shows completion without inventing a legacy date',()=>{
 assert.equal(readingDateLabel({status:'read',readDate:'2024-02-29'}),'Przeczytano: 29.02.2024');
 assert.equal(readingDateLabel({status:'read'}),null);
});
test('legacy status does not change the completion date label',()=>{
 assert.equal(readingDateLabel({status:'reading',readDate:'2026-10-04'}),'Przeczytano: 04.10.2026');
 assert.equal(readingDateLabel({status:'to-read',readDate:'2026-10-04'}),'Przeczytano: 04.10.2026');
 assert.equal(readingDateLabel({status:'reading',readDate:null}),null);
});