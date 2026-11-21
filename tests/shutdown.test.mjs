import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {run} from '../src/main.mjs';

test('shutdown ends a connected wallpaper stream before AI job cleanup broadcasts', {timeout:5000}, async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bookshelf-shutdown-'));
  const app=await run({port:0,dataDir});
  t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const stream=await fetch(app.origin+'/api/events');
  const reader=stream.body.getReader();
  const initial=await reader.read();
  assert.match(new TextDecoder().decode(initial.value),/"revision":0/);
  const {token}=await (await fetch(app.origin+'/api/bootstrap')).json();
  const response=await fetch(app.origin+'/api/shutdown',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json','X-Bookshelf-Token':token},body:'{}'});
  assert.equal(response.status,200);
  assert.equal((await reader.read()).done,true);
  await app.close();
});
