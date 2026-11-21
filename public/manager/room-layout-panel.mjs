import {el} from '../shared/api.mjs';
import {getRoomScene} from '../shared/room-scene.mjs';
import {renderScene} from '../wallpaper/scene-renderer.mjs';
import {createRoomLayoutController} from './room-layout-controller.mjs';
import {rememberLayoutFocus} from './layout-focus.mjs';
import {isMonthlyView,readingYearValue} from './annual-settings.mjs';
function choose(label,options,value,change){const wrap=el('label','layout-field',label),s=el('select');s.setAttribute('aria-label',label);for(const [id,name]of options){const o=el('option','',name);o.value=id;s.append(o);}s.value=value;s.onchange=()=>change(s.value);wrap.append(s);return wrap;}
export function createRoomLayoutPanel({state,onSave,onDirtyChange,notice}){
 const c=createRoomLayoutController(state);let activeState=state,root=null,observer=null,page=0,wasDirty=false;
 function dirtyChanged(){if(wasDirty!==c.dirty){wasDirty=c.dirty;onDirtyChange(c.dirty);}}
 function action(text,fn,cls='secondary'){const b=el('button',cls,text);b.type='button';b.disabled=c.saving;b.onclick=async()=>{try{await fn();dirtyChanged();paint();}catch(e){notice(e.message,true);paint();}};return b;}
 function edit(fn){fn();page=0;dirtyChanged();paint();}
 function paintAnnual(restoreFocus){
  const scene=getRoomScene(activeState.settings.room);
  root.append(el('h2','','Widok roczny '+readingYearValue(activeState.settings)+' · '+scene.name),el('p','muted','Miesiące zajmują stałe wnęki, wierszami od lewej do prawej. Aby edytować rozmieszczenie, przełącz na gatunki.'));
  if(c.dirty){const status=el('p','layout-draft-status','Niezapisany szkic rozmieszczenia zachowano. Wróć do gatunków, aby go edytować.');status.setAttribute('role','status');root.append(status);}
  root.append(action('Pokaż według gatunków',()=>onSave({type:'updateSettings',patch:{grouping:'shelves'}})));
  const stage=el('div','layout-map'),visual=el('div','room-scene'),pager=el('div','layout-pager');root.append(stage,pager);stage.append(visual);
  function preview(){
   if(!stage.isConnected||!stage.clientWidth)return;
   const restorePagerFocus=rememberLayoutFocus(pager);
   const result=renderScene(visual,{state:activeState,page,width:stage.clientWidth,height:stage.clientHeight,embedded:true,onBook:b=>notice('Wybrano: '+b.title),onTooltip(){},onLeave(){}});page=result.page;
   const prev=action('←',()=>{page--;}),next=action('→',()=>{page++;});prev.setAttribute('aria-label','Poprzednia strona podglądu');next.setAttribute('aria-label','Następna strona podglądu');prev.disabled=page===0;next.disabled=page===result.pageCount-1;pager.replaceChildren(prev,el('span','',`Podgląd ${page+1} / ${result.pageCount}`),next);restorePagerFocus();
  }
  observer=new ResizeObserver(preview);observer.observe(stage);preview();restoreFocus();
 }
 function paint(){
  observer?.disconnect();if(!root?.isConnected)return;const restoreFocus=rememberLayoutFocus(root);root.replaceChildren();
  if(isMonthlyView(activeState.settings,getRoomScene(activeState.settings.room))){paintAnnual(restoreFocus);return;}
  const scene=getRoomScene(c.roomId),s=c.state,draft=c.layout;
  root.append(el('h2','','Rozmieszczenie · '+scene.name),el('p','muted','Wybierz wnękę na mapie lub z listy. Zmiany zobaczysz na tapecie po zapisaniu.'));
  const status=el('p','layout-draft-status',c.saving?'Zapisuję…':c.stale?'Kolekcja lub zapisany układ zmieniły się. Szkic zachowano. Cofnij zmiany, aby wczytać aktualną wersję.':c.dirty?'Niezapisany szkic · zachowany również po zmianie zakładki.':'Rozmieszczenie zapisane.');status.setAttribute('role','status');root.append(status);
  const enabled=el('label','checkbox-label'),check=el('input');check.type='checkbox';check.setAttribute('aria-label','Własny układ w tym pokoju');check.checked=draft.enabled;check.disabled=c.saving;check.onchange=()=>edit(()=>c.setEnabled(check.checked));enabled.append(check,el('span','','Własny układ w tym pokoju'));root.append(enabled);
  const stage=el('div','layout-map'),visual=el('div','room-scene'),pager=el('div','layout-pager');root.append(stage,pager);stage.append(visual);
  function preview(){if(!stage.isConnected||!stage.clientWidth)return;const size={width:stage.clientWidth,height:stage.clientHeight};const result=renderScene(visual,{state:c.preview(),page,...size,embedded:true,onBook:b=>{c.select(draft.placements[b.id]?.slotId??c.selectedSlot);notice('Wybrano: '+b.title);paint();},onTooltip(){},onLeave(){}});page=result.page;
   for(const [i,slot]of scene.slots.entries()){const dot=action(String(i+1),()=>{c.select(slot.id);paint();},'cavity-marker');dot.setAttribute('aria-label','Wybierz wnękę '+(i+1));dot.setAttribute('aria-pressed',slot.id===c.selectedSlot);dot.style.left=(slot.books.x+slot.books.width/2)*100+'%';dot.style.top=slot.books.y*100+'%';visual.append(dot);}
   pager.replaceChildren();const prev=action('←',()=>{page--;preview();}),next=action('→',()=>{page++;preview();});prev.setAttribute('aria-label','Poprzednia strona podglądu');next.setAttribute('aria-label','Następna strona podglądu');prev.disabled=page===0;next.disabled=page===result.pageCount-1;pager.append(prev,el('span','',`Podgląd ${page+1} / ${result.pageCount} · ${s.books.length} książek`),next);
  }
  const controls=el('div','layout-controls');const cavity=draft.cavities[c.selectedSlot]??{source:null,decoration:null};
  controls.append(choose('Wnęka',scene.slots.map((v,i)=>[v.id,'Wnęka '+(i+1)]),c.selectedSlot,id=>edit(()=>c.select(id))),choose('Wypełnienie wnęki',[['','Automatycznie'],...s.shelves.map(v=>['shelf:'+v.id,v.name])],cavity.source?cavity.source.kind+':'+cavity.source.id:'',value=>edit(()=>{const split=value.indexOf(':');c.setCavity({source:value?{kind:value.slice(0,split),id:value.slice(split+1)}:null});})));root.append(controls);
  if(!draft.enabled)root.append(el('p','muted','Włącz własny układ, aby przypisać gatunki i książki do wnęk. Wyłączenie zachowuje zapisane wybory.'));
  const add=el('div','layout-add'),bookField=choose('Przypisz książkę',[['','Wybierz książkę'],...s.books.toSorted((a,b)=>a.title.localeCompare(b.title,'pl')).map(b=>[b.id,b.title+' · '+b.authors.join(', ')])],'',()=>{});const bookSelect=bookField.querySelector('select');add.append(bookField,action('Dodaj do wnęki',()=>{if(bookSelect.value)edit(()=>c.place(bookSelect.value));}));root.append(add);
  const books=c.booksInSlot();if(!books.length)root.append(el('p','muted','Brak ręcznych przypisań w tej wnęce. Książki dobierze ustawione wypełnienie.'));
  for(const [i,b]of books.entries()){const row=el('div','placement-row');row.append(el('span','',b.title));for(const [text,delta]of [['↑',-1],['↓',1]]){const move=action(text,()=>edit(()=>c.shift(b.id,delta)));move.setAttribute('aria-label',(delta<0?'Przesuń wcześniej: ':'Przesuń później: ')+b.title);move.disabled=c.saving||i+delta<0||i+delta>=books.length;row.append(move);}row.append(action('Usuń przypisanie',()=>edit(()=>c.remove(b.id))));root.append(row);}
  const footer=el('div','layout-actions'),save=action('Zapisz rozmieszczenie',async()=>{const promise=c.save(onSave);paint();await promise;notice('Rozmieszczenie zapisane. Tapeta jest aktualna.');},'primary');save.disabled=!c.dirty||c.stale||c.saving;
  footer.append(save,action('Cofnij zmiany',()=>{if(!c.dirty||confirm('Odrzucić niezapisany szkic rozmieszczenia?')){c.discard();page=0;}}),action('Przywróć automatyczny układ',()=>{if(confirm('Usunąć przypisania tego pokoju? Zmiana zadziała po zapisie.'))edit(()=>c.reset());}));root.append(footer);
  for(const control of controls.querySelectorAll('select'))control.disabled=c.saving;
  observer=new ResizeObserver(preview);observer.observe(stage);preview();restoreFocus();
 }
 return {mount(nextRoot,next){root=nextRoot;activeState=next;c.receive(next);dirtyChanged();paint();},receive(next,options){activeState=next;c.receive(next,options);dirtyChanged();},isDirty:()=>c.dirty,unmount(){observer?.disconnect();root=null;},refresh:paint};
}
