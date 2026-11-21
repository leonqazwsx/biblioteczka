export const SETTINGS_GROUPS=[['appearance','Wygląd'],['wallpaper','Tapeta'],['collection','Kolekcja'],['advanced','Zaawansowane']];
const views=new Set(['books','shelves','settings','wallpaper']);
export function readRoute(hash,shelves=[]){
 const [path,query='']=String(hash??'').replace(/^#/,'').split('?');
 const params=new URLSearchParams(query),view=views.has(path)?path:'books';
 const shelf=params.get('shelf'),group=params.get('group'),status=params.get('status'),page=Number(params.get('page')??0);
 return {view,settingsGroup:SETTINGS_GROUPS.some(([id])=>id===group)?group:'appearance',shelfId:view==='books'&&shelves.some(s=>s.id===shelf)?shelf:null,query:view==='books'?(params.get('query')??'').slice(0,500):'',status:'',page:view==='books'&&Number.isSafeInteger(page)&&page>=0&&page<10000?page:0,mode:view==='books'&&params.get('mode')==='list'?'list':'gallery'};
}
export function routeHash(route){
 const view=views.has(route.view)?route.view:'books',params=new URLSearchParams();
 if(view==='settings')params.set('group',SETTINGS_GROUPS.some(([id])=>id===route.settingsGroup)?route.settingsGroup:'appearance');
 if(view==='books'){
  if(route.shelfId)params.set('shelf',route.shelfId);
  if(route.query)params.set('query',route.query);
  if(route.page>0)params.set('page',String(route.page));
  if(route.mode==='list')params.set('mode','list');
 }
 return '#'+view+(params.size?'?'+params:'');
}
