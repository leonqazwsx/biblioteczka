import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {problem} from './domain.mjs';import {createBackup,validateBackup} from './backup.mjs';
import packageInfo from '../package.json' with {type:'json'};
import {createGoodreadsImports} from './goodreads-import.mjs';
import {downloadRemoteImage} from './remote-image.mjs';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
export function createAppServer({store,catalog,covers,spines,jobs,storage,windows,publicDir,coverDiscovery=null,imageDownloader=downloadRemoteImage,installationId=null,runtimeSessionId=crypto.randomUUID(),onStopping=async()=>{},onShutdown=()=>{}}){
  const token=crypto.randomUUID(),sessionId=runtimeSessionId,clients=new Set(),requests=new Set(),imports=new Map(),goodreads=createGoodreadsImports({store});
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  async function catalogResponse(req,res,lookup){
    const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};
    req.once('aborted',abort);res.once('close',abort);if(req.aborted||res.destroyed)abort();
    try{const data=await lookup(controller.signal);if(!controller.signal.aborted&&!res.destroyed&&!res.writableEnded)json(res,200,data);}
    catch(error){if(!controller.signal.aborted)throw error;}
    finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
  }
  const metadata=()=>{const state=store.read();return {sessionId,recovery:store.recovery,collectionId:state.collectionId,revision:state.revision,version:packageInfo.version};};
  const publish=(aiChanged=false)=>{for(const client of clients)client.write('data: '+JSON.stringify({...metadata(),...(aiChanged?{aiChanged:true}:{})})+'\n\n');};
  const schedule=(newBookIds=[])=>{try{Promise.resolve(jobs?.schedule?.({newBookIds})).catch(()=>{});}catch{}};
  const imageBytes=input=>{if(typeof input.base64!=='string'||!input.base64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw problem('INVALID','Nieprawidłowy obraz.');return Buffer.from(input.base64,'base64');};
  async function body(req,limit){let size=0,chunks=[];for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>limit){req.resume();throw problem('TOO_LARGE','Plik lub żądanie jest za duże.');}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem('INVALID','Nieprawidłowe dane JSON.');}}
  const server=http.createServer(async(req,res)=>{
    let finish;const completed=new Promise(resolve=>{finish=resolve;});requests.add(completed);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data: https://covers.openlibrary.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    try{
      const origin='http://127.0.0.1:'+server.address().port;if(req.headers.host!==new URL(origin).host)throw problem('FORBIDDEN','Niedozwolony adres aplikacji.');
      const url=new URL(req.url,origin),route=url.pathname;
      if(!['GET','POST'].includes(req.method))throw problem('INVALID','Niedozwolona metoda.');
      if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['x-bookshelf-token']!==token||!req.headers['content-type']?.startsWith('application/json')))throw problem('FORBIDDEN','Odśwież panel, aby bezpiecznie zapisać zmiany.');
      if(req.method==='GET'){
        if(route==='/api/health')return json(res,200,{appId:'bookshelf-wallpaper',installationId,pid:process.pid,...metadata()});
        if(route==='/api/bootstrap')return json(res,200,{token,...metadata()});
        if(route==='/api/state')return json(res,200,store.read());
        if(route==='/api/windows')return json(res,200,await windows?.status()??{supported:false,autostart:false,conflict:false,canEnable:false});
        if(route==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write('data: '+JSON.stringify(metadata())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
        if(route==='/api/search')return await catalogResponse(req,res,signal=>url.searchParams.has('paged')&&catalog.searchPage?catalog.searchPage(url.searchParams.get('q'),{signal,cursor:url.searchParams.get('cursor')}):catalog.search(url.searchParams.get('q'),{signal}));
        if(route==='/api/edition')return await catalogResponse(req,res,signal=>catalog.resolveEdition(url.searchParams.get('id'),{signal}));
        const coverPreview=route.match(/^\/api\/cover-search\/([^/]{1,100})\/([^/]{1,100})$/);
        if(coverPreview){if(!coverDiscovery)throw problem('COVER_UNAVAILABLE','Wyszukiwanie okładek jest niedostępne.');return await catalogResponse(req,res,async signal=>{const image=await coverDiscovery.preview(coverPreview[1],coverPreview[2],{signal});signal.throwIfAborted();res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'private, max-age=60'});res.end(image.bytes);return null;});}
        if(route==='/api/ai/status')return json(res,200,jobs?.status()??{available:false,enabled:false,connection:'unconfigured',jobs:[]});
        if(route==='/api/storage'){if(!storage)throw problem('STORAGE_UNAVAILABLE','Raport miejsca jest niedostępny.');return json(res,200,await storage.report());}
        if(route==='/api/export')return json(res,200,await createBackup(store.read(),covers,spines));
        if(route.startsWith('/spines/')){if(!spines)throw problem('NOT_FOUND','Brak ilustracji.');const img=await spines.read(route.slice(8));res.writeHead(200,{'Content-Type':img.mime,'Cache-Control':'private, max-age=31536000, immutable'});res.end(img.bytes);return;}
        if(route.startsWith('/covers/')){const img=await covers.read(route.slice(8));res.writeHead(200,{'Content-Type':img.mime,'Cache-Control':'private, max-age=31536000, immutable'});res.end(img.bytes);return;}
        const relative=route==='/'||route==='/manager'?'manager.html':route==='/wallpaper'?'wallpaper.html':decodeURIComponent(route).slice(1);
        const file=path.resolve(publicDir,relative);if(!file.startsWith(path.resolve(publicDir)+path.sep))throw problem('NOT_FOUND','Nie znaleziono strony.');
        const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(bytes);return;
      }
      const input=await body(req,route==='/api/goodreads/preview'?14*1024*1024:route==='/api/goodreads/confirm'?8*1024*1024:route==='/api/import/preview'?64*1024*1024:['/api/covers','/api/spines/upload'].includes(route)?7*1024*1024:['/api/commands','/api/storage/quarantine'].includes(route)?2*1024*1024:256*1024);
      if(route==='/api/images/from-url'){
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='url')||typeof input.url!=='string')throw problem('INVALID','Wklej bezpośredni link do obrazu.');
        return await catalogResponse(req,res,async signal=>{const image=await imageDownloader(input.url,{signal});return {mime:image.mime,base64:image.bytes.toString('base64')};});
      }
      const mutate=storage?.withMutation??(operation=>operation());
      if(route==='/api/cover-search'){
        if(!coverDiscovery)throw problem('COVER_UNAVAILABLE','Wyszukiwanie okładek jest niedostępne.');
        return await catalogResponse(req,res,signal=>coverDiscovery.search(input,{signal}));
      }
      if(route==='/api/covers'&&input&&typeof input==='object'&&(Object.hasOwn(input,'searchId')||Object.hasOwn(input,'candidateId'))){
        if(Array.isArray(input)||Object.keys(input).sort().join(',')!=='candidateId,searchId'||typeof input.searchId!=='string'||input.searchId.length>100||typeof input.candidateId!=='string'||input.candidateId.length>100)throw problem('INVALID','Wybierz propozycję z galerii okładek.');
        if(!coverDiscovery)throw problem('COVER_UNAVAILABLE','Wyszukiwanie okładek jest niedostępne.');
        return await catalogResponse(req,res,async signal=>{const image=await coverDiscovery.select(input.searchId,input.candidateId,{signal});signal.throwIfAborted();const saved=await mutate(()=>{signal.throwIfAborted();return covers.put(image.bytes,image.mime);});return {...saved,source:image.source};});
      }
      if(route==='/api/covers'&&input&&Object.hasOwn(input,'isbn')){
        if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='isbn')||typeof input.isbn!=='string')throw problem('INVALID','Podaj ISBN książki.');
        return await catalogResponse(req,res,async signal=>await covers.fetchIsbnCover(input.isbn,{signal,save:(...args)=>mutate(()=>{signal.throwIfAborted();return covers.put(...args);})})??{coverId:null});
      }
      if(route==='/api/windows/open-settings'){
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw problem('INVALID','Nieprawidłowe żądanie otwarcia ustawień.');
        if(typeof windows?.openSettings!=='function')throw problem('WINDOWS_UNAVAILABLE','Otwieranie ustawień w przeglądarce jest niedostępne.');
        return json(res,200,await windows.openSettings());
      }
      return await mutate(async()=>{
      if(['/api/storage/quarantine','/api/storage/restore','/api/storage/purge'].includes(route)){
        if(!storage)throw problem('STORAGE_UNAVAILABLE','Porządkowanie obrazów jest niedostępne.');
        const keys=route.endsWith('/quarantine')?['expectedRevision','assets']:['expectedRevision','quarantineId'];if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw problem('INVALID','Nieprawidłowe żądanie porządkowania.');
        return json(res,200,await storage[route.split('/').at(-1)](input));
      }
      if(route==='/api/goodreads/preview'){
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='base64')||typeof input.base64!=='string'||input.base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw problem('INVALID','Nieprawidłowy plik CSV.');
        const bytes=Buffer.from(input.base64,'base64');if(bytes.length>10*1024*1024)throw problem('TOO_LARGE','Plik CSV może mieć maksymalnie 10 MiB.');if(bytes.toString('base64')!==input.base64)throw problem('INVALID','Nieprawidłowe kodowanie pliku.');return json(res,200,goodreads.preview(bytes));
      }
      if(route==='/api/goodreads/confirm'){const before=store.read(),next=await goodreads.confirm(input);publish();schedule(next.books.filter(book=>!before.books.some(old=>old.id===book.id)).map(book=>book.id));return json(res,200,next);}
      if(route==='/api/windows'){
        if(!input||typeof input.autostart!=='boolean'||Object.keys(input).some(key=>key!=='autostart'))throw problem('INVALID','Nieprawidłowe ustawienie Windows.');
        if(!windows)throw problem('WINDOWS_UNAVAILABLE','Integracja Windows jest niedostępna.');
        return json(res,200,await windows.setAutostart(input.autostart));
      }
      if(route==='/api/spines/generate'){
        return json(res,410,{code:'GENERATION_RETIRED',message:'Ilustracje przygotowują się automatycznie. Odśwież panel.'});
      }
      if(route==='/api/spines/upload'){
        if(!spines)throw problem('AI_UNAVAILABLE','Magazyn ilustracji jest niedostępny.');const saved=await spines.put(imageBytes(input),input.mime);const next=await store.commit({type:'setBookSpine',id:input.bookId,spine:{assetId:saved.assetId,kind:'manual',sourceCoverId:null,model:null,promptVersion:null}},input.expectedRevision);publish();schedule();return json(res,200,next);
      }
      if(route==='/api/commands'){
        const command=input.command;if(command?.type==='setBookSpine')throw problem('INVALID','Użyj importu ilustracji.');if(command?.type==='addBook'||command?.type==='updateBook'){const coverId=(command.draft??command.patch)?.coverId;if(coverId)await covers.read(coverId);}
        const before=store.read(),next=await store.commit(command,input.expectedRevision);publish();schedule(command.type==='addBook'?next.books.filter(book=>!before.books.some(old=>old.id===book.id)).map(book=>book.id):[]);return json(res,200,next);
      }
      if(route==='/api/covers'){let result;if(input.catalogCoverId!=null)result=await covers.fetchCatalogCover(input.catalogCoverId);else {if(typeof input.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw problem('INVALID','Nieprawidłowy obraz.');result=await covers.put(Buffer.from(input.base64,'base64'),input.mime);}return json(res,200,result);}
      if(route==='/api/import/preview'){const checked=validateBackup(input);for(const [key,value] of imports)if(value.expires<Date.now())imports.delete(key);if(imports.size>=3)imports.delete(imports.keys().next().value);const importId=crypto.randomUUID();const current=store.read();imports.set(importId,{checked,expires:Date.now()+600000,collectionId:current.collectionId,revision:current.revision,busy:false});return json(res,200,{importId,summary:checked.summary,collectionId:current.collectionId,revision:current.revision});}
      if(route==='/api/import/confirm'){const entry=imports.get(input.importId);if(!entry||entry.expires<Date.now())throw problem('INVALID','Podgląd kopii wygasł. Wybierz plik ponownie.');const current=store.read();if(entry.busy||input.expectedRevision!==entry.revision||current.revision!==entry.revision||current.collectionId!==entry.collectionId)throw problem('CONFLICT','Kolekcja zmieniła się. Wczytaj kopię ponownie.');entry.busy=true;try{for(const img of entry.checked.images)await covers.put(img.bytes,img.mime);for(const img of entry.checked.spineImages){if(!spines)throw problem('INVALID','Brak magazynu ilustracji.');await spines.put(img.bytes,img.mime);}const next=await store.replace(entry.checked.state,entry.revision,entry.collectionId);imports.delete(input.importId);publish();schedule();return json(res,200,next);}finally{entry.busy=false;}}
      if(route==='/api/shutdown'){if(input.expectedPid!==undefined&&input.expectedPid!==process.pid)throw problem('CONFLICT','Serwer został ponownie uruchomiony. Odśwież panel.');await onStopping();json(res,200,{ok:true});setTimeout(()=>{for(const c of clients)c.end();clients.clear();onShutdown();},100).unref();return;}
      throw problem('NOT_FOUND','Nie znaleziono strony.');
      });
    }catch(e){if(res.headersSent){res.end();return;}const code=e.code==='ENOENT'?'NOT_FOUND':e.code??'INTERNAL';const status={INVALID:400,INVALID_CSV:400,INVALID_ISBN:400,FORBIDDEN:403,NOT_FOUND:404,DUPLICATE:409,CONFLICT:409,RECOVERY_REQUIRED:409,TOO_LARGE:413,CATALOG_UNAVAILABLE:502,COVER_UNAVAILABLE:502,COVER_SEARCH_EXPIRED:410,COVER_DUPLICATE:404,IMAGE_UNAVAILABLE:502,WINDOWS_UNAVAILABLE:503,STORAGE_UNAVAILABLE:503,AI_UNAVAILABLE:503,AI_LIMIT:429,AI_REJECTED:422,AI_TIMEOUT:504}[code]??500;json(res,status,{code,message:status===500?'Nie udało się zapisać lub odczytać danych. Sprawdź dostęp do folderu i wolne miejsce.':e.message,details:e.details});}finally{requests.delete(completed);finish();}
  });
  server.drainRequests=()=>Promise.all([...requests]);server.publishChanges=publish;server.on('close',()=>{for(const c of clients)c.end();clients.clear();});return server;
}

