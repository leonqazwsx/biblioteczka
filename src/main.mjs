import path from 'node:path';import {fileURLToPath} from 'node:url';import {openStore} from './store.mjs';import {createCatalog} from './catalog.mjs';import {openCoverStore} from './covers.mjs';import {createAppServer} from './server.mjs';import {problem} from './domain.mjs';
import {openSpineStore} from './spine-assets.mjs';import {openAutomaticSpines} from './automatic-spines.mjs';
import {createSpineServiceClient} from './spine-service-client.mjs';import {localSpineServiceConfig} from './spine-service-config.mjs';
import {installationId} from './installation.mjs';
import {createWindowsIntegration} from './windows.mjs';
import fs from 'node:fs/promises';
import {acquireDataLock} from './data-lock.mjs';
import {createStorageGate,guardStorage,openAssetMaintenance} from './asset-maintenance.mjs';
import {createInventaireCoverLookup} from './inventaire-covers.mjs';
import {createCoverImageLoader} from './cover-images.mjs';
import {createCoverDiscovery} from './cover-discovery.mjs';
import {writeStopIntent} from './runtime-intent.mjs';
export async function run({appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=47831,dataDir=path.join(appRoot,'data'),spineService=localSpineServiceConfig(),catalog:createAppCatalog=createCatalog(),recoveryNonce}={}){
  if(recoveryNonce!==undefined&&(typeof recoveryNonce!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(recoveryNonce)))throw new Error('Nieprawidłowa próba odzyskania.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw problem('INVALID','Nieprawidłowy port.');
  const identity=installationId(appRoot,dataDir);
  if(port){try{const r=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(700)});let health;try{health=await r.json();}catch{}if(health?.appId==='bookshelf-wallpaper'&&health.installationId===identity)return {origin:'http://127.0.0.1:'+port,alreadyRunning:true,close:async()=>{}};throw problem('PORT_IN_USE','Port jest zajęty przez inny program lub inną instalację Biblioteczki.');}catch(e){if(e.code==='PORT_IN_USE')throw e;}}
  const lock=await acquireDataLock(dataDir);let closing,server,jobs,started=false,stopIntentPromise;
  const runtimeSessionId=crypto.randomUUID();
  function markStopping(){
    if(!stopIntentPromise){const pending=writeStopIntent(dataDir,{installationId:identity,pid:process.pid,sessionId:runtimeSessionId,recoveryNonce});stopIntentPromise=pending;pending.catch(()=>{if(stopIntentPromise===pending)stopIntentPromise=null;});}
    return stopIntentPromise;
  }
  function close(){if(!closing){closing=(async()=>{
    if(started)await markStopping();
    try{
      const finished=server?new Promise(resolve=>server.close(()=>resolve())):Promise.resolve();
      server?.closeAllConnections();
      await jobs?.close();await finished;await server?.drainRequests();
    }finally{await lock.release();}
  })();closing.catch(()=>{if(server?.listening)closing=null;});}return closing;}
  try{
    const standardData=path.resolve(dataDir)===path.resolve(appRoot,'data'),marker=path.join(appRoot,'data-initialized.json');
    const initialized=standardData&&await fs.access(marker).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
    const rawStore=await openStore(dataDir,{requireExisting:initialized});
    const imageLoader=createCoverImageLoader(),inventaireLookup=createInventaireCoverLookup();
    const rawCovers=await openCoverStore(dataDir,{imageLoader,isbnFallback:inventaireLookup}),rawSpines=await openSpineStore(dataDir),gate=createStorageGate();
    const {store,covers,spines}=guardStorage({dataDir,store:rawStore,covers:rawCovers,spines:rawSpines,gate});
    if(standardData&&store.recovery!=='unrecoverable')await fs.writeFile(marker,JSON.stringify({version:1,initialized:true})+'\n',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const client=spineService?createSpineServiceClient(spineService):null;
    jobs=await openAutomaticSpines({dataDir,store,covers,spines,catalog:createAppCatalog,client,onState:()=>server?.publishChanges(true)});
    const storage=await openAssetMaintenance({dataDir,store,jobs,gate});
    const coverDiscovery=createCoverDiscovery({covers,imageLoader,inventaireLookup});
    server=createAppServer({store,covers,spines,jobs,storage,coverDiscovery,catalog:createAppCatalog,windows:createWindowsIntegration({appRoot,port}),publicDir:path.join(appRoot,'public'),installationId:identity,runtimeSessionId,onStopping:markStopping,onShutdown:()=>close()});
    await new Promise((resolve,reject)=>{server.once('error',e=>reject(e.code==='EADDRINUSE'?problem('PORT_IN_USE','Port jest zajęty przez inny program.'):e));server.listen(port,'127.0.0.1',resolve);});
    started=true;jobs.schedule();return {origin:'http://127.0.0.1:'+server.address().port,alreadyRunning:false,close};
  }catch(error){await close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  try{const app=await run({port:value('--port')==null?47831:Number(value('--port')),dataDir:value('--data-dir')==null?undefined:path.resolve(value('--data-dir')),recoveryNonce:value('--recovery-nonce')});console.log('Biblioteczka: '+app.origin+'/manager');if(!app.alreadyRunning){process.on('SIGINT',()=>app.close());process.on('SIGTERM',()=>app.close());}}catch(e){console.error(e.message);process.exitCode=1;}
}
