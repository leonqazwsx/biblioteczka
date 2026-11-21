import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, applyCommand, validateState } from '../src/domain.mjs';
const draft = (extra={}) => ({title:'Solaris',authors:['Stanisław Lem'],shelfId:'fantasy',status:'to-read',...extra});
test('starts empty with three shelves',()=>{const s=createInitialState();assert.equal(s.books.length,0);assert.deepEqual(s.shelves.map(x=>x.name),['Fantastyka','Kryminał','Pozostałe']);});
test('legacy settings retain the original room and choosing a new room retains books and theme',()=>{
  const legacy=createInitialState();delete legacy.settings.room;
  assert.equal(validateState(legacy).settings.room,'reading-room-v1');
  let s=applyCommand(legacy,{type:'addBook',draft:draft({status:'read',readDate:'2026-10-04'})});const before=structuredClone(s.books);
  s=applyCommand(s,{type:'updateSettings',patch:{room:'oak-library'}});
  assert.equal(s.settings.room,'oak-library');assert.equal(s.settings.theme,'light');assert.deepEqual(s.books,before);
  s=applyCommand(s,{type:'updateSettings',patch:{theme:'dark'}});assert.equal(s.settings.room,'oak-library');
  assert.throws(()=>applyCommand(s,{type:'updateSettings',patch:{room:'../../anything'}}),{code:'INVALID'});
});
test('move preserves identity and completed reading',()=>{const before=createInitialState();const copy=structuredClone(before);let s=applyCommand(before,{type:'addBook',draft:draft()});const id=s.books[0].id;s=applyCommand(s,{type:'moveBook',id,shelfId:'crime',index:0});assert.equal(s.books.length,1);assert.equal(s.books[0].id,id);assert.equal(s.books[0].status,'read');assert.equal(s.revision,2);assert.deepEqual(before,copy);});
test('duplicate ISBN reports existing id, actual different edition is permitted',()=>{let s=applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:'9780140328721'})});assert.throws(()=>applyCommand(s,{type:'addBook',draft:draft({isbn:'9780140328721'})}),e=>e.code==='DUPLICATE'&&e.details.id===s.books[0].id);s=applyCommand(s,{type:'addBook',draft:draft({isbn:'9780553386790'})});assert.equal(s.books.length,2);});
test('equivalent ISBN10 and ISBN13 cannot add or update a duplicate edition',()=>{
  for(const [first,equivalent]of [['0140328726','9780140328721'],['9780140328721','0140328726']]){
    let state=applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:first})});
    const original=structuredClone(state),existingId=state.books[0].id;
    assert.throws(()=>applyCommand(state,{type:'addBook',draft:draft({isbn:equivalent})}),error=>error.code==='DUPLICATE'&&error.details.id===existingId);
    assert.deepEqual(state,original);
    state=applyCommand(state,{type:'addBook',draft:draft({title:'Inna',isbn:'9780553386790'})});
    const secondId=state.books[1].id;
    assert.throws(()=>applyCommand(state,{type:'updateBook',id:secondId,patch:{isbn:equivalent}}),error=>error.code==='DUPLICATE'&&error.details.id===existingId);
    const respelled=applyCommand(original,{type:'updateBook',id:existingId,patch:{isbn:equivalent}});assert.equal(respelled.books.length,1);assert.equal(respelled.books[0].isbn,equivalent);
  }
});
test('legacy equivalent ISBN pairs allow unrelated edits without merge or remap but block new conflicts',()=>{
  const legacy=applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:'0140328726'})});
  legacy.books.push({...legacy.books[0],id:'legacy-pair',isbn:'9780140328721',order:1});
  const copy=structuredClone(legacy);assert.equal(validateState(legacy).books.length,2);
  let edited=applyCommand(legacy,{type:'updateBook',id:'legacy-pair',patch:{title:'Poprawiony tytuł',status:'reading'}});
  edited=applyCommand(edited,{type:'updateSettings',patch:{theme:'dark'}});
  edited=applyCommand(edited,{type:'moveBook',id:'legacy-pair',shelfId:'other',index:0});
  edited=applyCommand(edited,{type:'addBook',draft:draft({title:'Odrębna edycja',isbn:'9780553386790'})});
  assert.deepEqual(edited.books.slice(0,2).map(book=>[book.id,book.isbn]),[[legacy.books[0].id,'0140328726'],['legacy-pair','9780140328721']]);
  assert.equal(edited.books[1].title,'Poprawiony tytuł');assert.equal(edited.books[1].shelfId,'other');assert.deepEqual(legacy,copy);
  for(const isbn of ['0140328726','9780140328721'])assert.throws(()=>applyCommand(edited,{type:'addBook',draft:draft({isbn})}),{code:'DUPLICATE'});
  assert.throws(()=>applyCommand(edited,{type:'updateBook',id:edited.books[2].id,patch:{isbn:'0140328726'}}),{code:'DUPLICATE'});
});
test('updating an earlier record to a later ISBN reports the existing record rather than itself',()=>{
  let state=applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:'9780553386790'})});
  state=applyCommand(state,{type:'addBook',draft:draft({isbn:'9780140328721'})});
  assert.throws(()=>applyCommand(state,{type:'updateBook',id:state.books[0].id,patch:{isbn:'9780140328721'}}),error=>error.code==='DUPLICATE'&&error.details.id===state.books[1].id);
});
test('ISBN command whitespace is normalized before duplicate edition checks',()=>{
  let state=applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:'0140328726'})});
  const existingId=state.books[0].id;
  for(const isbn of [' 0140328726 ',' 9780140328721 '])assert.throws(()=>applyCommand(state,{type:'addBook',draft:draft({isbn})}),error=>error.code==='DUPLICATE'&&error.details.id===existingId);
  state=applyCommand(state,{type:'addBook',draft:draft({isbn:'9780553386790'})});
  assert.throws(()=>applyCommand(state,{type:'updateBook',id:state.books[1].id,patch:{isbn:' 9780140328721 '}}),error=>error.code==='DUPLICATE'&&error.details.id===existingId);
});
test('deleting occupied shelf requires valid target and retains its books',()=>{let s=applyCommand(createInitialState(),{type:'addBook',draft:draft()});assert.throws(()=>applyCommand(s,{type:'deleteShelf',id:'fantasy'}));s=applyCommand(s,{type:'deleteShelf',id:'fantasy',targetId:'other'});assert.equal(s.books[0].shelfId,'other');assert.equal(s.shelves.length,2);});
test('rejects invalid references, enums, duplicate ids and unsafe object fields',()=>{const s=createInitialState();assert.throws(()=>applyCommand(s,{type:'addBook',draft:draft({shelfId:'absent'})}));assert.throws(()=>applyCommand(s,{type:'updateSettings',patch:{iconSpace:.31}}));assert.throws(()=>applyCommand(s,{type:'updateSettings',patch:{theme:'blue'}}));s.shelves.push({...s.shelves[0]});assert.throws(()=>validateState(s));});
test('validates order permutations and preserves text rather than HTML',()=>{let s=applyCommand(createInitialState(),{type:'addBook',draft:draft({title:'<img src=x>'})});assert.equal(s.books[0].title,'<img src=x>');assert.throws(()=>applyCommand(s,{type:'reorderShelves',ids:['other']}));s=applyCommand(s,{type:'reorderShelves',ids:['other','crime','fantasy']});assert.equal(s.shelves.find(x=>x.order===0).id,'other');});
test('bad checksum is rejected on commands and restored files',()=>{assert.throws(()=>applyCommand(createInitialState(),{type:'addBook',draft:draft({isbn:'9780140328722'})}));});
test('editing shelf appends book after existing books and reindexes source',()=>{let s=createInitialState();for(const d of [draft(),draft({title:'B'}),draft({title:'C',shelfId:'crime'})])s=applyCommand(s,{type:'addBook',draft:d});s=applyCommand(s,{type:'updateBook',id:s.books[0].id,patch:{shelfId:'crime'}});assert.deepEqual(s.books.filter(b=>b.shelfId==='crime').sort((a,b)=>a.order-b.order).map(b=>b.title),['C','Solaris']);assert.equal(s.books.find(b=>b.title==='B').order,0);});
test('completion date can be edited and survives shelf and status changes',()=>{let s=applyCommand(createInitialState(),{type:'addBook',draft:draft({status:'read',readDate:'2024-02-29'})});const id=s.books[0].id;assert.equal(s.books[0].readDate,'2024-02-29');s=applyCommand(s,{type:'updateBook',id,patch:{readDate:'2026-10-04',status:'reading'}});s=applyCommand(s,{type:'moveBook',id,shelfId:'other',index:0});assert.equal(s.books[0].readDate,'2026-10-04');s=applyCommand(s,{type:'updateBook',id,patch:{readDate:null}});assert.equal(s.books[0].readDate,null);});
test('new books use the local day when the reading date is omitted',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,4,0,30)});
  const s=applyCommand(createInitialState(),{type:'addBook',draft:draft({status:'read'})});
  assert.equal(s.books[0].readDate,'2026-11-04');
  const undated=applyCommand(s,{type:'addBook',draft:draft({title:'Bez daty',readDate:null})});
  assert.equal(undated.books[1].readDate,null);
});
test('legacy books have no invented completion date and impossible dates are rejected',()=>{const s=applyCommand(createInitialState(),{type:'addBook',draft:draft({status:'read',readDate:null})});delete s.books[0].readDate;assert.equal(validateState(s).books[0].readDate,null);for(const readDate of ['2026-02-29','2026-04-31','0000-01-01','04.10.2026',42])assert.throws(()=>applyCommand(s,{type:'updateBook',id:s.books[0].id,patch:{readDate}}),{code:'INVALID'});});
test('legacy settings default to manual sorting with independent per-room scales',()=>{const old=createInitialState();delete old.settings.sort;delete old.settings.bookScales;const normalized=validateState(old);assert.equal(normalized.settings.sort,'manual');assert.deepEqual(normalized.settings.bookScales,{});let s=applyCommand(old,{type:'updateSettings',patch:{sort:'read-newest',bookScales:{'green-library':.65,'oak-library':1.2}}});assert.equal(s.settings.bookScales['green-library'],.65);s=applyCommand(s,{type:'updateSettings',patch:{room:'oak-library'}});assert.equal(s.settings.bookScales['green-library'],.65);assert.equal(s.settings.sort,'read-newest');for(const patch of [{sort:'wrong'},{bookScales:{'green-library':.59}},{bookScales:{'green-library':1.41}},{bookScales:{bad:1}},{bookScales:null}])assert.throws(()=>applyCommand(s,{type:'updateSettings',patch}),{code:'INVALID'});});
test('new category shelf is created atomically with a book and reused by name',()=>{const before=createInitialState();let s=applyCommand(before,{type:'addBook',newShelfName:'Biografie',draft:draft({shelfId:null,subjects:['Biography']})});assert.equal(before.shelves.length,3);assert.equal(s.revision,1);const shelf=s.shelves.find(x=>x.name==='Biografie');assert.equal(s.books[0].shelfId,shelf.id);assert.deepEqual(s.books[0].subjects,['Biography']);s=applyCommand(s,{type:'addBook',newShelfName:' biografie ',draft:draft({title:'B',shelfId:null})});assert.equal(s.shelves.length,4);assert.equal(s.books[1].shelfId,shelf.id);assert.equal(s.books[1].order,1);s=applyCommand(s,{type:'updateBook',id:s.books[0].id,patch:{shelfId:'crime'}});assert.equal(s.books[0].shelfId,'crime');assert.deepEqual(s.books[0].subjects,['Biography']);});
test('category metadata is bounded and updating into a new category reindexes correctly',()=>{let s=applyCommand(createInitialState(),{type:'addBook',draft:draft()});assert.deepEqual(s.books[0].subjects,[]);s=applyCommand(s,{type:'updateBook',id:s.books[0].id,newShelfName:'Historia',patch:{subjects:['History']}});assert.equal(s.shelves.find(x=>x.id===s.books[0].shelfId).name,'Historia');for(const subjects of [Array(81).fill('History'),['x'.repeat(161)],[42]])assert.throws(()=>applyCommand(s,{type:'updateBook',id:s.books[0].id,patch:{subjects}}),{code:'INVALID'});});
test('lighting is additive for old collections and accepts only the four modes',()=>{
  const old=createInitialState();delete old.settings.lighting;const revision=old.revision;
  assert.equal(validateState(old).settings.lighting,'theme');assert.equal(old.revision,revision);assert.equal(old.settings.lighting,undefined);
  for(const lighting of ['theme','day','evening','auto']){const saved=applyCommand(old,{type:'updateSettings',patch:{lighting}});assert.equal(saved.settings.lighting,lighting);assert.equal(saved.settings.theme,'light');}
  for(const lighting of ['night',null,{},0])assert.throws(()=>applyCommand(old,{type:'updateSettings',patch:{lighting}}),{code:'INVALID'});
});
