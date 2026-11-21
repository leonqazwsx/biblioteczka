import {cloudflareProfile} from './cloudflare-profiles.mjs';
import {createCoverReference} from './cover-reference.mjs';
import {imageMime} from '../../src/covers.mjs';
import {validateImageBytes} from '../../src/image-validation.mjs';
import {problem} from '../../src/domain.mjs';
import {readMaterialReference} from './material-reference.mjs';

const uncertain=()=>problem('PROVIDER_UNCERTAIN','Nie udało się potwierdzić wyniku ilustracji.');
const authorization=uncertain=>Object.assign(problem('PROVIDER_AUTH','Automatyczne ilustracje są obecnie niedostępne.'),{uncertain});
const maxJson=7*1024*1024,maxImage=5*1024*1024;
function retryDelay(value,clock){
  if(!value)return 0;
  const number=/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:Date.parse(value)-clock().getTime();
  return Number.isFinite(number)&&number>=0&&number<=Number.MAX_SAFE_INTEGER?number:0;
}
async function readJson(response,signal){
  if(Number(response.headers.get('content-length'))>maxJson||!response.body)throw uncertain();
  const reader=response.body.getReader(),chunks=[];let size=0;
  const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){if(signal.aborted)throw uncertain();const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maxJson){cancel();throw uncertain();}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  }finally{signal.removeEventListener('abort',cancel);}
}
export function createCloudflareProvider({accountId,apiToken,freeConfirmed,profile='default',styleReferenceBytes,fetchImpl=fetch,timeoutMs=180000,clock=()=>new Date()}={}){
  if(freeConfirmed!==true||typeof accountId!=='string'||!/^[0-9a-f]{32}$/i.test(accountId)||typeof apiToken!=='string'||!/^[\x21-\x7e]{24,512}$/.test(apiToken)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2147483647)
    throw problem('SERVICE_CONFIG','Ustaw konto Cloudflare Workers Free i poświadczenia w środowisku operatora.');
  const {config,prompt}=cloudflareProfile(profile);
  const material=profile==='style-v3-9b'?readMaterialReference(styleReferenceBytes):null;
  return {available:true,config,async generate({coverBytes,coverMime,signal}){
    if(signal?.aborted)throw uncertain();
    const reference=await createCoverReference({coverBytes,coverMime});
    const materialReference=material?await createCoverReference({coverBytes:material.bytes,coverMime:material.mime}):null;
    if(signal?.aborted)throw uncertain();
    const controller=new AbortController();let deadline,authenticationResponse=false,responseStatus=null,responseCodes=[];
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(uncertain()),{once:true});deadline=setTimeout(abort,timeoutMs);});
    const execute=async()=>{
      const form=new FormData();form.set('prompt',prompt);form.set('width',String(config.width));form.set('height',String(config.height));
      form.set('input_image_0',new Blob([reference.bytes],{type:reference.mime}),'reference.jpg');
      if(materialReference)form.set('input_image_1',new Blob([materialReference.bytes],{type:materialReference.mime}),'material.jpg');
      const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${config.remoteModel}`,{method:'POST',headers:{Authorization:'Bearer '+apiToken},body:form,redirect:'manual',signal:controller.signal});
      responseStatus=response.status;authenticationResponse=[401,403].includes(response.status);
      if(response.status>=300&&response.status<400)throw uncertain();
      const data=await readJson(response,controller.signal);
      responseCodes=Array.isArray(data?.errors)?[...new Set(data.errors.map(error=>error?.code).filter(code=>Number.isSafeInteger(code)&&code>=0&&code<=999999999))]:[];
      if(authenticationResponse){
        const provesRefusal=data?.success===false&&(data.result===undefined||data.result===null)&&Array.isArray(data.errors)&&data.errors.length>0&&data.errors.every(error=>Number.isSafeInteger(error?.code));
        throw authorization(!provesRefusal);
      }
      if(!response.ok){
        const codes=Array.isArray(data?.errors)?data.errors.map(error=>error?.code):[];
        if(data?.success!==false||(data.result!==undefined&&data.result!==null)||!codes.length||!codes.every(code=>Number.isSafeInteger(code)&&code===codes[0]))throw uncertain();
        const code=codes[0];
        if(response.status===429&&[3036,4006,3040].includes(code))throw Object.assign(problem(code===3040?'PROVIDER_CAPACITY':'PROVIDER_QUOTA','Ilustracja oczekuje na dostępność usługi.'),{retryAfterMs:retryDelay(response.headers.get('retry-after'),clock)});
        if((response.status===400&&[5004,3003].includes(code))||(response.status===413&&code===3006))throw problem('AI_REJECTED','Usługa odrzuciła dane ilustracji.');
        throw uncertain();
      }
      if(data?.success!==true||(Array.isArray(data.errors)&&data.errors.length))throw uncertain();
      const encoded=data.result?.image;
      if(typeof encoded!=='string'||encoded.length>Math.ceil(maxImage/3)*4||encoded.length%4===1||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw uncertain();
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.length>maxImage||bytes.toString('base64').replace(/=+$/,'')!==encoded.replace(/=+$/,''))throw uncertain();
      const mime=imageMime(bytes);validateImageBytes(bytes,mime);return {bytes,mime,usage:null};
    };
    try{return await Promise.race([execute(),interrupted]);}
    catch(error){const failure=['PROVIDER_QUOTA','PROVIDER_CAPACITY','PROVIDER_AUTH','AI_REJECTED'].includes(error?.code)?error:authenticationResponse?authorization(true):uncertain();throw Object.assign(failure,{providerDiagnostic:{http:responseStatus,codes:responseCodes}});}
    finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);}
  }};
}
