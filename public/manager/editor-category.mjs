import {CATEGORY_PRESETS,shelfForCategory,suggestShelf} from '../shared/categories.mjs';
export function resolveCategoryChoice(value,shelves){
  const existing=shelves.find(shelf=>shelf.id===value);
  if(existing)return {value:existing.id,shelfId:existing.id,newShelfName:null};
  if(typeof value!=='string'||!value.startsWith('new:'))return null;
  const name=value.slice(4);
  if(name!=='Pozostałe'&&!CATEGORY_PRESETS.includes(name))return null;
  const shelf=shelfForCategory(name,shelves);
  return {value:shelf?.id??'new:'+name,shelfId:shelf?.id??null,newShelfName:shelf?null:name};
}
export function editorCategory(subjects,shelves,{manualShelfId=null}={}){
  const manual=resolveCategoryChoice(manualShelfId,shelves);
  if(manual)return {...manual,message:'Wybrana przez Ciebie półka. Możesz ją zmienić.'};
  const proposal=suggestShelf(subjects,shelves);
  return {...proposal,value:proposal.shelfId??'new:'+proposal.newShelfName};
}
