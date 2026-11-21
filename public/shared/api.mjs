let token,appVersion,appSession;
export async function request(route,{method='GET',body,signal}={}){
 const r=await fetch(route,{method,signal,headers:method==='POST'?{'Content-Type':'application/json','X-Bookshelf-Token':token}:{},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await r.json();}catch{throw new Error('Aplikacja nie odpowiedziała. Sprawdź, czy działa w tle.');}
 if(!r.ok)throw Object.assign(new Error(data.message),{code:data.code,details:data.details});return data;
}
export const api={
 async bootstrap(){const x=await request('/api/bootstrap');token=x.token;appVersion??=x.version;appSession=x.sessionId??appSession;return x;},
 state:()=>request('/api/state'),
 command:async(command,revision)=>request('/api/commands',{method:'POST',body:{command,expectedRevision:revision}}),
 events(onRevision,onConnection,onAiChanged,onVersionChange=()=>location.reload(),onSessionChange=()=>{}){
  const source=new EventSource('/api/events');let version=appVersion,session=appSession,reloading=false;
  function receiveSession(info){
   if(typeof info.sessionId!=='string'||!info.sessionId)return;
   if(session&&session!==info.sessionId)onSessionChange(info);
   session=info.sessionId;
  }
  source.onmessage=e=>{
   if(reloading)return;const data=JSON.parse(e.data);
   if(typeof data.version==='string'&&data.version){
    if(version&&data.version!==version){reloading=true;source.close();(onVersionChange??(()=>location.reload()))(data.version);return;}
    version??=data.version;
   }
   receiveSession(data);onRevision(data.revision);if(data.aiChanged)onAiChanged?.();
  };
  source.onopen=()=>{api.bootstrap().then(info=>{receiveSession(info);onConnection?.(true);}).catch(()=>onConnection?.(false));};
  source.onerror=()=>onConnection?.(false);return ()=>source.close();
 }
};
export function el(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!=null)element.textContent=text;return element;}
