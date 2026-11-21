import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import {installationId} from '../src/installation.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function shell(args){const child=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);const exit=new Promise(resolve=>child.once('exit',code=>{child.stdout.destroy();child.stderr.destroy();resolve({code,output});}));return {child,exit,text:()=>output};}
test('a restart before the old tray heartbeat establishes a helper for the replacement server',{skip:process.platform!=='win32',timeout:45000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka tray replacement '));await fs.mkdir(path.join(root,'data'));await fs.cp('scripts',path.join(root,'scripts'),{recursive:true});await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'bookshelf-wallpaper',version:'0.7.0'}));
 let serverPid=11001;const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appId:'bookshelf-wallpaper',version:'0.7.0',installationId:installationId(root),pid:serverPid,sessionId:'fixture-'+serverPid,recovery:'none'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=String(server.address().port);
 let first;t.after(async()=>{try{const state=JSON.parse(await fs.readFile(path.join(root,'data/tray-state.json'),'utf8'));await fs.writeFile(path.join(root,'data/runtime-stop.json'),JSON.stringify({version:1,appId:'bookshelf-wallpaper',...state,pid:state.serverPid,createdAt:new Date().toISOString()}));}catch{}await new Promise(r=>server.close(r));for(let n=0;n<60&&await fs.access(path.join(root,'data/tray-state.json')).then(()=>true,()=>false);n++)await pause(100);if(first&&first.child.exitCode===null)first.child.kill();await fs.rm(root,{recursive:true,force:true,maxRetries:15,retryDelay:100});});
 first=shell(['-File',path.join(root,'scripts/tray.ps1'),'-AppRoot',root,'-Port',port]);
 for(let n=0;n<80&&!first.text().includes('"ready":true');n++)await pause(100);assert.match(first.text(),/"ready":true/);
 serverPid=11002;const launched=shell(['-File',path.join(root,'scripts/start.ps1'),'-AppRoot',root,'-Port',port,'-NoBrowser']);const result=await launched.exit;assert.equal(result.code,0,result.output);
 assert.equal((await first.exit).code,0);await pause(500);
 const log=await fs.readFile(path.join(root,'data/tray.log'),'utf8');assert.match(log,/"ready":true/);
 const active=JSON.parse(await fs.readFile(path.join(root,'data/tray-state.json'),'utf8'));assert.equal(active.serverPid,11002);assert.notEqual(active.pid,first.child.pid);assert.doesNotThrow(()=>process.kill(active.pid,0));
});

test('tray survives a transient health failure while its owned process is alive',{skip:process.platform!=='win32',timeout:20000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka tray transient '));await fs.mkdir(path.join(root,'data'));await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'bookshelf-wallpaper',version:'0.7.0'}));
 let fail=false;const server=http.createServer((req,res)=>{if(fail){res.writeHead(503);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appId:'bookshelf-wallpaper',version:'0.7.0',installationId:installationId(root),pid:process.pid,sessionId:'fixture'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const tray=shell(['-File',path.resolve('scripts/tray.ps1'),'-AppRoot',root,'-Port',String(server.address().port)]);
 t.after(async()=>{tray.child.kill();await tray.exit;await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 for(let n=0;n<80&&!tray.text().includes('"ready":true');n++)await pause(100);assert.match(tray.text(),/"ready":true/);
 fail=true;await pause(2600);assert.equal(tray.child.exitCode,null);fail=false;await pause(2200);assert.equal(tray.child.exitCode,null);
});

test('Quit helper requires the owned server to disappear after shutdown',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka quit '));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const script=path.join(root,'quit.ps1');await fs.writeFile(script,`. '${path.resolve('scripts/desktop-functions.ps1').replaceAll("'","''")}'\nfunction Invoke-RestMethod { param($Uri,$Method,$ContentType,$Headers,$Body,$TimeoutSec) if($Uri -like '*/api/bootstrap'){return @{token='fixture'}};return @{appId='bookshelf-wallpaper';installationId='owned';pid=12345} }\ntry { $result=Confirm-BiblioteczkaQuit 'http://127.0.0.1:1' 'owned' 12345; @{confirmed=$result}|ConvertTo-Json -Compress } catch { @{confirmed=$false;message=$_.Exception.Message}|ConvertTo-Json -Compress }`);
 const result=await shell(['-File',script]).exit;assert.equal(result.code,0,result.output);const info=JSON.parse(result.output.replace(/^\uFEFF/,''));assert.equal(info.confirmed,false);assert.match(info.message,/nadal|potwierd/i);
});

test('Quit helper never confirms a failed shutdown request',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka quit failure '));t.after(()=>fs.rm(root,{recursive:true,force:true}));const script=path.join(root,'quit.ps1');
 await fs.writeFile(script,`. '${path.resolve('scripts/desktop-functions.ps1').replaceAll("'","''")}'\nfunction Invoke-RestMethod { param($Uri,$Method,$ContentType,$Headers,$Body,$TimeoutSec) if($Method -eq 'Post'){throw 'shutdown request failed'};if($Uri -like '*/api/bootstrap'){return @{token='fixture'}};return @{appId='bookshelf-wallpaper';installationId='owned';pid=12345} }\ntry { @{confirmed=(Confirm-BiblioteczkaQuit 'http://127.0.0.1:1' 'owned' 12345)}|ConvertTo-Json -Compress } catch { @{confirmed=$false;message=$_.Exception.Message}|ConvertTo-Json -Compress }`);
 const result=await shell(['-File',script]).exit;assert.equal(result.code,0,result.output);const info=JSON.parse(result.output.replace(/^\uFEFF/,''));assert.equal(info.confirmed,false);assert.match(info.message,/shutdown request failed/);
});

test('Quit confirms acknowledged shutdown when the endpoint times out and the process is gone',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka quit timeout '));t.after(()=>fs.rm(root,{recursive:true,force:true}));const script=path.join(root,'quit.ps1');
 await fs.writeFile(script,`. '${path.resolve('scripts/desktop-functions.ps1').replaceAll("'","''")}'\n$script:accepted=$false\nfunction Invoke-RestMethod { param($Uri,$Method,$ContentType,$Headers,$Body,$TimeoutSec) if($Method -eq 'Post'){$script:accepted=$true;return};if($Uri -like '*/api/bootstrap'){return @{token='fixture'}};if($script:accepted){throw [Net.WebException]::new('timeout',[Net.WebExceptionStatus]::Timeout)};return @{appId='bookshelf-wallpaper';installationId='owned';pid=2147483647} }\nConfirm-BiblioteczkaQuit 'http://127.0.0.1:1' 'owned' 2147483647`);
 const result=await shell(['-File',script]).exit;assert.equal(result.code,0,result.output);assert.match(result.output,/True/);
});

test('launcher retries a tray process that exits before becoming ready',{skip:process.platform!=='win32',timeout:20000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'Biblioteczka tray retry '));await fs.mkdir(path.join(root,'data'));await fs.cp('scripts',path.join(root,'scripts'),{recursive:true});await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'bookshelf-wallpaper',version:'0.7.0'}));
 await fs.rename(path.join(root,'scripts/tray.ps1'),path.join(root,'scripts/tray-real.ps1'));await fs.writeFile(path.join(root,'scripts/tray.ps1'),`$marker=Join-Path (Split-Path -Parent $PSScriptRoot) 'data/first-tray-failed'\nif(-not (Test-Path -LiteralPath $marker)){[IO.File]::WriteAllText($marker,'first failure');exit 1}\n& (Join-Path $PSScriptRoot 'tray-real.ps1') @args`);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appId:'bookshelf-wallpaper',version:'0.7.0',installationId:installationId(root),pid:process.pid,sessionId:'fixture'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{try{process.kill(JSON.parse(await fs.readFile(path.join(root,'data/tray-state.json'),'utf8')).pid);await pause(300);}catch{}await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const launched=await shell(['-File',path.join(root,'scripts/start.ps1'),'-AppRoot',root,'-Port',String(server.address().port),'-NoBrowser']).exit;assert.equal(launched.code,0,launched.output);assert.match(await fs.readFile(path.join(root,'data/tray.log'),'utf8'),/"ready":true/);
});
