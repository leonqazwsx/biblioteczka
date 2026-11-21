export const SORT_OPTIONS=[['manual','Kolejność ręczna'],['title-asc','Tytuł A–Z'],['title-desc','Tytuł Z–A'],['read-newest','Przeczytane: najnowsze'],['read-oldest','Przeczytane: najstarsze']];
const titles=new Intl.Collator('pl',{numeric:true,sensitivity:'base'});
const manual=(a,b)=>(a.order??0)-(b.order??0)||String(a.id??'').localeCompare(String(b.id??''));
export function sortBooks(books,mode='manual'){
  return [...books].sort((a,b)=>{
    if(mode==='manual')return manual(a,b);
    if(mode==='read-newest'||mode==='read-oldest'){
      if(!a.readDate&&b.readDate)return 1;if(a.readDate&&!b.readDate)return -1;
      if(a.readDate&&b.readDate&&a.readDate!==b.readDate)return (a.readDate<b.readDate?-1:1)*(mode==='read-newest'?-1:1);
    }
    return titles.compare(a.title,b.title)*(mode==='title-desc'?-1:1)||manual(a,b);
  });
}
