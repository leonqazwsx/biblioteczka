import fs from 'node:fs/promises';
import path from 'node:path';

// Runtime control data, never part of the book collection or a portable backup.
export async function writeStopIntent(dataDir,{installationId,pid,sessionId,recoveryNonce}){
 if(typeof installationId!=='string'||!installationId||!Number.isSafeInteger(pid)||pid<=0||typeof sessionId!=='string'||!sessionId)throw new Error('Nieprawidłowa tożsamość procesu.');
 const target=path.join(dataDir,'runtime-stop.json'),temporary=path.join(dataDir,'.runtime-stop-'+crypto.randomUUID()+'.json');
 const current=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(current&&(!current.isFile()||current.isSymbolicLink()))throw new Error('Nie można bezpiecznie zapisać zamiaru zamknięcia.');
 const intent={version:1,appId:'bookshelf-wallpaper',installationId,pid,sessionId,createdAt:new Date().toISOString(),...(recoveryNonce?{recoveryNonce}:{})};
 try{await fs.writeFile(temporary,JSON.stringify(intent)+'\n',{flag:'wx'});await fs.rename(temporary,target);}
 finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return intent;
}
