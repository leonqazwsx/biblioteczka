import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,applyCommand,validateState} from '../src/domain.mjs';
import {buildPages,createPagePlanner} from '../public/shared/layout.mjs';
import * as annualReading from '../public/shared/annual-reading.mjs';

const viewport={width:1920,height:1080};
const annualScene={id:'synthetic-annual',annual:true,aspectRatio:16/9,bookHeight:90,slots:Array.from({length:12},(_,month)=>({id:'month-slot-'+(month+1),books:{x:.32+(month%3)*.22,y:.06+Math.floor(month/3)*.2,width:.18,height:.14},front:{x:.31+(month%3)*.22,y:.2+Math.floor(month/3)*.2,width:.2,height:.01}}))};
const book=(id,readDate,extra={})=>({id,title:'Książka '+id,authors:['Autor'],shelfId:'fantasy',status:'read',readDate,order:0,pageCount:300,...extra});
function annualState(books=[]){const state=createInitialState();state.settings.grouping='months';state.settings.readingYear=2024;state.books=books;return state;}
const ids=pages=>pages.flatMap(page=>page.rows.flatMap(row=>row.books.map(item=>item.book.id)));
const annualPages=state=>buildPages(state,{...viewport,scene:annualScene});

test('annual settings persist grouping and selected year through validation and updates',()=>{
  let state=createInitialState();
  state=applyCommand(state,{type:'updateSettings',patch:{grouping:'months',readingYear:2024}});
  const restored=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.settings.grouping,'months');
  assert.equal(restored.settings.readingYear,2024);
  const changed=applyCommand(restored,{type:'updateSettings',patch:{theme:'dark'}});
  assert.equal(changed.settings.grouping,'months');
  assert.equal(changed.settings.readingYear,2024);
});

test('new and legacy collections default their reading year to the local current year',()=>{
  const state=createInitialState(),year=new Date().getFullYear();
  assert.equal(state.settings.readingYear,year);
  delete state.settings.readingYear;
  const before=structuredClone(state);
  assert.equal(validateState(state).settings.readingYear,year);
  assert.deepEqual(state,before);
});

test('reading year accepts calendar bounds and rejects coercion or out of range values',()=>{
  const state=createInitialState();
  for(const year of [1,9999])assert.equal(applyCommand(state,{type:'updateSettings',patch:{readingYear:year}}).settings.readingYear,year);
  for(const readingYear of [0,10000,-1,2024.5,'2024',null,NaN,Infinity]){
    assert.throws(()=>applyCommand(state,{type:'updateSettings',patch:{readingYear}}),{code:'INVALID'});
  }
});

test('switching annual grouping preserves books, shelves and saved manual placements',()=>{
  let state=applyCommand(createInitialState(),{type:'addBook',draft:{title:'Solaris',authors:['Lem'],shelfId:'fantasy',status:'read',readDate:'2024-02-29'}});
  state=applyCommand(state,{type:'setRoomLayout',roomId:'green-library',layout:{enabled:true,cavities:{},placements:{[state.books[0].id]:{slotId:'green-top-left',order:0}}}});
  const before=structuredClone(state);
  state=applyCommand(state,{type:'updateSettings',patch:{grouping:'months',readingYear:2024}});
  state=applyCommand(state,{type:'updateSettings',patch:{grouping:'shelves'}});
  assert.deepEqual(state.books,before.books);
  assert.deepEqual(state.shelves,before.shelves);
  assert.deepEqual(state.settings.roomLayouts,before.settings.roomLayouts);
  assert.equal(state.settings.grouping,'shelves');
  assert.equal(state.settings.readingYear,2024);
  state.settings.grouping='status';
  assert.equal(validateState(state).settings.grouping,'shelves');
});

test('calendar month rows include only valid dates in the selected year without moving boundaries',()=>{
  const state=annualState([
    book('jan','2024-01-31'),book('feb','2024-02-29'),book('mar','2024-03-01'),book('dec','2024-12-31'),
    book('previous','2023-12-31'),book('next','2025-01-01'),book('missing',null),book('absent',undefined),
    book('impossible','2024-02-30'),book('timestamp','2024-01-01T23:00:00Z'),book('short','2024-1-01'),book('zero','0000-01-01')
  ]),before=structuredClone(state),pages=annualPages(state);
  assert.equal(pages.length,1);
  assert.equal(pages[0].rows.length,12);
  assert.deepEqual(pages[0].rows.map(row=>row.books.map(item=>item.book.id)),[['jan'],['feb'],['mar'],[],[],[],[],[],[],[],[],['dec']]);
  assert.deepEqual(pages[0].rows.map(row=>row.slotId),annualScene.slots.map(slot=>slot.id));
  assert.deepEqual(state,before);
});

test('an empty reading year keeps all twelve fixed month rows available',()=>{
  const pages=annualPages(annualState([book('other','2023-01-01'),book('missing',null)]));
  assert.equal(pages.length,1);
  assert.equal(pages[0].rows.length,12);
  assert.ok(pages[0].rows.every(row=>row.books.length===0));
  assert.equal(new Set(pages[0].rows.map(row=>row.key)).size,12);
});

test('a busy month overflows through the same month slot without losing or repeating books',()=>{
  const state=annualState([...Array.from({length:200},(_,i)=>book('jan-'+i,'2024-01-15',{order:i})),book('feb','2024-02-05'),book('dec','2024-12-31')]);
  const pages=annualPages(state),all=ids(pages);
  assert.ok(pages.length>1);
  assert.equal(all.length,202);
  assert.equal(new Set(all).size,202);
  assert.deepEqual(pages.flatMap(page=>page.rows[0].books.map(item=>item.book.id)),Array.from({length:200},(_,i)=>'jan-'+i));
  for(const [pageIndex,page]of pages.entries()){
    assert.equal(page.rows.length,12);
    assert.deepEqual(page.rows.map(row=>row.slotId),annualScene.slots.map(slot=>slot.id));
    for(const [month,row]of page.rows.entries()){
      for(const item of row.books)assert.equal(Number(item.book.readDate.slice(5,7)),month+1);
      assert.ok(row.books.every(item=>item.width>=14&&item.height>0));
      assert.ok(row.books.reduce((sum,item)=>sum+item.width,0)+Math.max(0,row.books.length-1)*2<=row.bounds.width*viewport.width+.001);
    }
    if(pageIndex>0)assert.ok(page.rows.slice(1).every(row=>!row.books.length),'other months are not duplicated on overflow pages');
  }
});

test('monthly sorting uses the existing sort setting within each month',()=>{
  const state=annualState([book('z','2024-02-01',{title:'Zima',order:0}),book('a','2024-02-29',{title:'Arka',order:1}),book('j','2024-01-15',{title:'Lato',order:2})]);
  state.settings.sort='title-asc';
  assert.deepEqual(annualPages(state)[0].rows[1].books.map(item=>item.book.id),['a','z']);
  state.settings.sort='read-oldest';
  assert.deepEqual(annualPages(state)[0].rows[1].books.map(item=>item.book.id),['z','a']);
  state.settings.sort='read-newest';
  assert.deepEqual(annualPages(state)[0].rows[1].books.map(item=>item.book.id),['a','z']);
});

test('monthly mode bypasses saved manual placements and restores them when leaving annual mode',()=>{
  const state=annualState([book('jan','2024-01-15'),book('missing',null)]);
  state.settings.roomLayouts[annualScene.id]={enabled:true,cavities:{},placements:{jan:{slotId:'month-slot-12',order:0}}};
  const before=structuredClone(state.settings.roomLayouts);
  assert.deepEqual(annualPages(state)[0].rows[0].books.map(item=>item.book.id),['jan']);
  assert.deepEqual(ids(annualPages(state)),['jan']);
  state.settings.grouping='shelves';
  const pages=annualPages(state),january=pages.flatMap(page=>page.rows).find(row=>row.books.some(item=>item.book.id==='jan'));
  assert.equal(january.slotId,'month-slot-12');
  assert.equal(ids(pages).length,2);
  assert.deepEqual(state.settings.roomLayouts,before);
});

test('annual month planning refuses a missing or unusable month slot rather than remapping it',()=>{
  const state=annualState([book('jan','2024-01-15')]);
  const missing={...annualScene,slots:annualScene.slots.slice(1)};
  const unusable={...annualScene,slots:annualScene.slots.map((slot,i)=>i===1?{...slot,books:{...slot.books,width:.001}}:slot)};
  for(const scene of [missing,unusable])assert.throws(()=>buildPages(state,{...viewport,scene}),{code:'VIEWPORT_TOO_SMALL'});
});

test('old rooms retain genre grouping even with an annual preference saved',()=>{
  const state=annualState([book('jan','2024-01-15'),book('old','2023-02-04'),book('missing',null)]);
  const oldScene={...annualScene,annual:false};
  const pages=buildPages(state,{...viewport,scene:oldScene});
  assert.equal(pages[0].rows[0].label,'Fantastyka');
  assert.deepEqual(ids(pages),['jan','missing','old']);
});

test('planner invalidates a cached annual plan when the selected year or grouping changes',()=>{
  const state=annualState([book('this','2024-01-15'),book('next','2025-02-01')]),plan=createPagePlanner(),options={...viewport,scene:annualScene};
  const first=plan(state,options);
  assert.deepEqual(ids(first),['this']);
  assert.equal(plan(state,options),first);
  state.settings.readingYear=2025;
  const changed=plan(state,options);
  assert.notEqual(changed,first);
  assert.deepEqual(ids(changed),['next']);
  state.settings.grouping='shelves';
  assert.deepEqual(ids(plan(state,options)),['next','this']);
});

test('reading year summary distinguishes selected months, undated books and valid other years',()=>{
  const books=[
    book('jan-first','2024-01-01'),book('jan-last','2024-01-31'),book('leap','2024-02-29'),book('dec','2024-12-31'),
    book('previous','2023-12-31'),book('next','2025-01-01'),book('century','1900-02-28'),book('leap-century','2000-02-29'),
    book('null',null),book('absent',undefined),book('empty',''),book('impossible','2024-02-30'),
    book('short','2024-1-01'),book('timestamp','2024-01-01T23:00:00Z'),book('numeric',20240101),book('year-zero','0000-01-01')
  ],before=structuredClone(books);
  assert.deepEqual(annualReading.summarizeReadingYear(books,2024),{year:2024,total:4,undated:8,otherYears:4,months:[2,1,0,0,0,0,0,0,0,0,0,1]});
  assert.deepEqual(books,before);
});

test('calendar summaries respect century leap rules and the supported year bounds',()=>{
  const books=[book('first','0001-01-01'),book('last','9999-12-31'),book('not-leap','1900-02-29'),book('leap','2000-02-29')];
  assert.deepEqual(annualReading.summarizeReadingYear(books,1),{year:1,total:1,undated:1,otherYears:2,months:[1,0,0,0,0,0,0,0,0,0,0,0]});
  assert.deepEqual(annualReading.summarizeReadingYear(books,9999),{year:9999,total:1,undated:1,otherYears:2,months:[0,0,0,0,0,0,0,0,0,0,0,1]});
  assert.deepEqual(annualReading.summarizeReadingYear(books,1900),{year:1900,total:0,undated:1,otherYears:3,months:[0,0,0,0,0,0,0,0,0,0,0,0]});
  assert.deepEqual(annualReading.summarizeReadingYear(books,2000),{year:2000,total:1,undated:1,otherYears:2,months:[0,1,0,0,0,0,0,0,0,0,0,0]});
});
