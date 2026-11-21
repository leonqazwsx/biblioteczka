import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
test('recovery policy bounds retries, verifies ownership, handles intentional stop and resets resume failures',{skip:process.platform!=='win32'},async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/runtime-policy.ps1')],{windowsHide:true,timeout:15000});assert.match(stdout,/RUNTIME_POLICY_OK/);
});
