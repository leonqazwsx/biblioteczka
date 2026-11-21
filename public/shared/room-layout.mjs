import {ROOM_SCENES} from './room-scene.mjs';
const invalid=()=>{throw Object.assign(new Error('Nieprawidłowe rozmieszczenie książek.'),{code:'INVALID'});};
function object(value){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();return value;}
function keys(value,allowed){object(value);if(Object.keys(value).some(key=>!allowed.includes(key)))invalid();}
export function normalizeRoomLayouts(value,{books,shelves}){
 if(value===undefined)return {};
 object(value);const bookIds=new Set(books.map(b=>b.id)),shelfIds=new Set(shelves.map(s=>s.id));
 return Object.fromEntries(Object.entries(value).map(([roomId,layout])=>{
  const scene=ROOM_SCENES.find(room=>room.id===roomId);if(!scene)invalid();keys(layout,['enabled','cavities','placements']);if(typeof layout.enabled!=='boolean')invalid();object(layout.cavities);object(layout.placements);
  const slots=new Set(scene.slots.map(slot=>slot.id));
  const cavities=Object.fromEntries(Object.entries(layout.cavities).map(([slotId,cavity])=>{
   if(!slots.has(slotId))invalid();keys(cavity,['source','decoration']);let source=null;
   if(cavity.source!==null){keys(cavity.source,['kind','id']);const {kind,id}=cavity.source;if(kind==='shelf'?!shelfIds.has(id):kind==='status'?!['read','reading','to-read'].includes(id):true)invalid();source={kind,id};}
   if(![null,'plant','vase'].includes(cavity.decoration))invalid();return [slotId,{source:source?.kind==='shelf'?source:null,decoration:null}];
  }));
  const placements=Object.fromEntries(Object.entries(layout.placements).map(([bookId,placement])=>{
   if(!bookIds.has(bookId))invalid();keys(placement,['slotId','order']);if(!slots.has(placement.slotId)||!Number.isSafeInteger(placement.order)||placement.order<0)invalid();return [bookId,{slotId:placement.slotId,order:placement.order}];
  }));
  return [roomId,{enabled:layout.enabled,cavities,placements}];
 }));
}
export function cleanRoomLayouts(layouts,{removedBookIds=[],removedShelfIds=[]}={}){
 const next=structuredClone(layouts),books=new Set(removedBookIds),shelves=new Set(removedShelfIds);
 for(const layout of Object.values(next)){
  for(const id of Object.keys(layout.placements))if(books.has(id))delete layout.placements[id];
  for(const cavity of Object.values(layout.cavities))if(cavity.source?.kind==='shelf'&&shelves.has(cavity.source.id))cavity.source=null;
 }
 return next;
}
