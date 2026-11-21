import test from 'node:test';import assert from 'node:assert/strict';
const module=await import('../public/manager/navigation.mjs').catch(()=>({}));
const readRoute=module.readRoute??(()=>({view:'books'})),routeHash=module.routeHash??(()=>'#books');
test('deep links select settings group or an existing shelf',()=>{
 assert.deepEqual(readRoute('#settings?group=collection',[]),{view:'settings',settingsGroup:'collection',shelfId:null,query:'',status:'',page:0,mode:'gallery'});
 assert.equal(readRoute('#books?shelf=sf&query=Lem&status=read&page=2&mode=list',[{id:'sf'}]).shelfId,'sf');
 assert.equal(readRoute('#books?shelf=missing',[]).shelfId,null);
});
test('navigation round trips collection filters without interpreting markup',()=>{
 const route={view:'books',settingsGroup:'appearance',shelfId:'id/a',query:'Dąb <tag>',status:'reading',page:3,mode:'list'};
 assert.deepEqual(readRoute(routeHash(route),[{id:'id/a'}]),{...route,status:''});
});
test('malformed routes reset safely instead of trapping the view',()=>{
 assert.equal(readRoute('#other?group=invalid',[]).view,'books');
 assert.equal(readRoute('#settings?group=bad',[]).settingsGroup,'appearance');
 assert.equal(readRoute('#books?page=-4&status=bad&mode=bad',[]).page,0);
});