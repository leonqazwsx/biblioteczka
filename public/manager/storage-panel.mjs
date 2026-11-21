import {el} from '../shared/api.mjs';
const names={covers:'Okładki',spines:'Grzbiety',quarantine:'Kwarantanna'};
function bytes(value){return value>=1048576?(value/1048576).toLocaleString('pl',{minimumFractionDigits:2,maximumFractionDigits:2})+' MiB':(value/1024).toLocaleString('pl',{maximumFractionDigits:1})+' KiB';}
export async function renderStorageSettings(root,{request,confirm=message=>globalThis.confirm(message)}){
 let report,busy=false;
 const header=()=>{root.replaceChildren(el('h2','','Obrazy na dysku'),el('p','','Sprawdź zajęte miejsce i bezpiecznie uporządkuj nieużywane ilustracje.'));};
 const showError=error=>{if(!root.isConnected)return;const text=el('p','error',error.message);text.setAttribute('role','alert');root.append(text);};
 const action=(label,run,cls='secondary')=>{
  const button=el('button',cls,label);button.type='button';
  button.onclick=async()=>{
   if(busy)return;busy=true;button.disabled=true;
   try{await run();}catch(error){showError(error);}finally{busy=false;if(button.isConnected)button.disabled=false;}
  };return button;
 };
 const load=async()=>{const next=await request('/api/storage');if(root.isConnected){report=next;paint();}};
 const change=async(url,body)=>{const result=await request(url,{method:'POST',body:{expectedRevision:report.revision,...body}});if(root.isConnected){report=result.report;paint();}};
 const paint=()=>{
  header();const totals=el('dl','storage-totals');
  for(const kind of ['covers','spines','quarantine']){
   const data=report.totals[kind];totals.append(el('dt','',names[kind]),el('dd','',data.count+' obrazów · '+bytes(data.bytes)));
  }root.append(totals);
  root.append(el('p','muted','Chronimy obrazy używane przez kolekcję, kopię zapasową i AI. Nowe pliki pozostają chronione przez '+report.graceDays+' dni. Kwarantanna pozwala cofnąć porządkowanie; na tym etapie miejsce na dysku nie jest jeszcze zwalniane.'));
  if(!report.cleanupAllowed){
   const blockers=el('div','error');blockers.setAttribute('role','alert');
   blockers.append(el('p','','Porządkowanie jest wstrzymane:'));
   for(const message of report.blockers)blockers.append(el('p','',message));root.append(blockers);
  }else if(report.candidates.length){
   const total=report.candidates.reduce((sum,asset)=>sum+asset.bytes,0);
   root.append(el('p','','Nieużywane obrazy: '+report.candidates.length+' · '+bytes(total)));
   root.append(action('Przenieś do kwarantanny',()=>change('/api/storage/quarantine',{assets:report.candidates.map(({kind,id})=>({kind,id}))})));
  }else root.append(el('p','muted','Brak obrazów kwalifikujących się do porządkowania.'));
  root.append(el('p','muted','Trwałe usunięcie jest dostępne dopiero po '+report.retentionDays+' dni i ponownym sprawdzeniu wszystkich odniesień.'));
  for(const batch of report.quarantine){
   const row=el('div','storage-batch');
   const date=new Date(batch.createdAt);const label=Number.isFinite(+date)?date.toLocaleDateString('pl'):'data niedostępna';
   row.append(el('p','','Kopia z '+label+' · '+batch.count+' obrazów · '+bytes(batch.bytes)));
   if(batch.count)row.append(action('Przywróć obrazy',()=>change('/api/storage/restore',{quarantineId:batch.id})));
   if(batch.purgeEligible&&report.cleanupAllowed)row.append(action('Usuń na stałe · '+bytes(batch.eligibleBytes),async()=>{
    if(confirm('Usunąć na stałe '+batch.count+' obrazów ('+bytes(batch.eligibleBytes)+') z kwarantanny? Tej operacji nie można cofnąć.'))await change('/api/storage/purge',{quarantineId:batch.id});
   },'secondary danger-button'));
   root.append(row);
  }
  root.append(action('Odśwież raport',load));
 };
 header();root.append(el('p','muted','Sprawdzam lokalne obrazy…'));
 try{await load();}catch(error){showError(error);}
}
