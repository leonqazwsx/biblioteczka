import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import path from 'node:path';
test('Lively recovery preserves selection and monitors, correlates fresh errors and bounds repair attempts',{skip:process.platform!=='win32'},async()=>{
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tests/lively-recovery.ps1')],{windowsHide:true,timeout:20000});assert.match(stdout,/LIVELY_RECOVERY_OK/);
});
