import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
test('runtime controls preserve identity, persistent budgets and private bounded diagnostics',{skip:process.platform!=='win32'},async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/runtime-functions.ps1')],{windowsHide:true,timeout:15000});assert.match(stdout,/RUNTIME_FUNCTIONS_OK/);
});
