export function createRevisionFeed({getState,onRefresh}){
 let epoch=0,latest=null;
 const pending=new Set();
 function reconcile(){
  if(pending.size||latest===null)return;
  const revision=latest;latest=null;
  if(revision>(getState()?.revision??-1))onRefresh();
 }
 return {
  start(){const ticket={epoch};pending.add(ticket);return ticket;},
  isCurrent(ticket){return ticket?.epoch===epoch;},
  finish(ticket){if(!pending.delete(ticket))return;reconcile();},
  receive(revision){
   if(!Number.isSafeInteger(revision)||revision<0||revision<=(getState()?.revision??-1))return;
   latest=Math.max(latest??-1,revision);reconcile();
  },
  sessionChanged(){epoch++;latest=null;pending.clear();}
 };
}
