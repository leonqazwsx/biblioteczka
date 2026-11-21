import {getRoomScene,fitScene} from '../shared/room-scene.mjs';
import {createPagePlanner} from '../shared/layout.mjs';
import {createSpineElement} from '../shared/spine-art.mjs';
import {fitSpineTitles} from '../shared/spine-title-fit.mjs';
import {el} from '../shared/api.mjs';
import {roomPresentation} from '../shared/lighting.mjs';
const scenes=new WeakMap();
function extendRoomEdges(root,{scene,fit,width,height,asset}){
  const images=[];
  if(!scene.annual)return images;
  // Preserve the photograph's proportions and every month. On unusual display
  // ratios, continue only the quiet wall/curtain edge and floor outside it.
  const fragment=(left,top,w,h,imageStyle)=>{
    const wrap=el('div','room-extension'),img=el('img');img.src=asset;img.alt='';img.setAttribute('aria-hidden','true');
    Object.assign(wrap.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});Object.assign(img.style,imageStyle);wrap.append(img);root.append(wrap);images.push(img);
  };
  if(fit.x>.5)fragment(-fit.x,0,fit.x,Math.min(height,fit.height),{width:fit.x/.18+'px',height:fit.height+'px',left:'0',top:'0'});
  const remaining=height-fit.height;
  if(remaining>.5){const imageHeight=remaining/.1;fragment(-fit.x,fit.height,width,remaining,{width:width+'px',height:imageHeight+'px',left:'0',top:-imageHeight*.9+'px'});}
  return images;
}
export function renderScene(root,{state,page,width,height,onBook,onTooltip,onLeave,date=new Date(),embedded=false}){
  let cached=scenes.get(root);if(!cached){cached={plan:createPagePlanner()};scenes.set(root,cached);}
  const scene=getRoomScene(state.settings.room),fit=fitScene(scene,{width,height,iconSpace:state.settings.iconSpace});
  const presentation=roomPresentation(scene,state.settings,date);
  const active=document.activeElement,focusedId=root.contains?.(active)?active?.dataset?.bookId:null;
  const previousIndex=cached.result?.books.findIndex(book=>book.id===focusedId)??0;
  root.dataset.sceneLighting=presentation.lighting;
  if(!embedded){document.body.dataset.sceneLighting=presentation.lighting;document.body.style.background=presentation.wallColor;}
  Object.assign(root.style,{left:fit.x+'px',top:fit.y+'px',width:fit.width+'px',height:fit.height+'px'});
  let pages;try{pages=cached.plan(state,{width,height,scene});}catch(e){if(e.code!=='VIEWPORT_TOO_SMALL')throw e;const backdrop=el('img','room-background');backdrop.src=presentation.asset;backdrop.alt='';backdrop.setAttribute('aria-hidden','true');root.replaceChildren(backdrop,el('p','room-error',e.message));cached.pages=null;cached.result={page:0,pageCount:1,books:[]};return cached.result;}
  page=Math.max(0,Math.min(page,pages.length-1));
  if(focusedId&&pages!==cached.pages&&page===cached.result?.page){const focusedPage=pages.findIndex(item=>item.rows.some(row=>row.books.some(item=>item.book.id===focusedId)));if(focusedPage>=0)page=focusedPage;}
  const tooltipFor=(book,button)=>{const box=button.getBoundingClientRect();onTooltip(book,{clientX:box.right,clientY:box.top});};
  if(cached.pages===pages&&cached.result?.page===page&&cached.onBook===onBook&&cached.onTooltip===onTooltip&&cached.onLeave===onLeave){
    cached.backdrop.src=presentation.asset;for(const front of cached.fronts)front.src=presentation.asset;
    for(const img of cached.extensions??[])img.src=presentation.asset;
    const focused=cached.buttons.find(button=>button.dataset.bookId===focusedId);if(focused)tooltipFor(cached.result.books.find(book=>book.id===focusedId),focused);return cached.result;
  }
  root.replaceChildren();
  const extensions=extendRoomEdges(root,{scene,fit,width,height,asset:presentation.asset});
  const backdrop=el('img','room-background');backdrop.src=presentation.asset;backdrop.alt='';backdrop.setAttribute('aria-hidden','true');root.append(backdrop);
  backdrop.onerror=()=>{const note=el('p','room-error','Nie udało się wczytać pokoju. Odśwież tapetę.');note.setAttribute('role','status');root.append(note);};
  const buttons=[],visibleBooks=[];
  for(const row of pages[page].rows){const slot=scene.slots.find(s=>s.id===row.slotId),r=row.bounds,section=el('section','room-cavity');section.dataset.slotId=slot.id;section.setAttribute('aria-label',row.label);Object.assign(section.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'});
    for(const {book,width:w,height:h} of row.books){const button=createSpineElement(book,{interactive:true});button.classList.add('book');button.dataset.bookId=book.id;button.style.setProperty('--book-width',w+'px');button.style.height=h+'px';if(!embedded)button.setAttribute('aria-describedby','tooltip');button.addEventListener('click',()=>onBook(book));button.addEventListener('pointermove',event=>onTooltip(book,event));button.addEventListener('pointerleave',()=>{if(button.isConnected&&document.activeElement!==button)onLeave();});button.addEventListener('focus',()=>tooltipFor(book,button));button.addEventListener('blur',()=>{if(button.isConnected)onLeave();});buttons.push(button);visibleBooks.push(book);section.append(button);}
    root.append(section);
    if(!(scene.annual&&state.settings.grouping==='months')){const label=el('span','cavity-label',row.label);Object.assign(label.style,{left:r.x*100+'%',top:`calc(${(slot.front.y+slot.front.height)*100}% + 4px)`});root.append(label);}
  }
  const fronts=[];for(const {front:r} of scene.slots){const front=el('img','room-front');front.src=presentation.asset;front.alt='';front.setAttribute('aria-hidden','true');front.style.clipPath=`polygon(${r.x*100}% ${r.y*100}%,${(r.x+r.width)*100}% ${r.y*100}%,${(r.x+r.width)*100}% ${(r.y+r.height)*100}%,${r.x*100}% ${(r.y+r.height)*100}%)`;root.append(front);fronts.push(front);}
  fitSpineTitles(root);
  const result={page,pageCount:pages.length,books:visibleBooks};Object.assign(cached,{pages,result,onBook,onTooltip,onLeave,backdrop,fronts,buttons,extensions});
  if(focusedId){const replacement=buttons.find(button=>button.dataset.bookId===focusedId)??buttons[Math.max(0,Math.min(previousIndex,buttons.length-1))];replacement?.focus({preventScroll:true});}
  return result;
}
