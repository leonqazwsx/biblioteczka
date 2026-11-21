import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const roots=['src','public','scripts','Start-Bookshelf.cmd','package.json','README.md','THIRD-PARTY-NOTICES.md'];
async function payloadFiles(root){
 const files={};
 async function visit(relative){
  const file=path.join(root,relative),stat=await fs.lstat(file);
  if(stat.isSymbolicLink())throw new Error('Pakiet zawiera dowiązanie: '+relative);
  if(stat.isDirectory()){for(const name of (await fs.readdir(file)).sort())await visit(path.join(relative,name));}
  else if(stat.isFile())files[relative.split(path.sep).join('/')]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 }
 for(const name of roots)await visit(name);
 return files;
}
export async function writePayloadManifest(root){
 const files=await payloadFiles(root);
 await fs.writeFile(path.join(root,'payload-manifest.json'),JSON.stringify({version:1,files},null,2)+'\n');
 return {files:Object.keys(files).length};
}
export async function verifyPayloadManifest(root,{required=true}={}){
 let expected;
 try{expected=JSON.parse(await fs.readFile(path.join(root,'payload-manifest.json'),'utf8'));}
 catch(e){if(!required&&e.code==='ENOENT')return {development:true};throw new Error('Brakuje poprawnego manifestu pakietu. Napraw Biblioteczkę instalatorem.');}
 if(expected.version!==1||!expected.files||typeof expected.files!=='object'||Array.isArray(expected.files))throw new Error('Nieprawidłowy manifest pakietu. Napraw Biblioteczkę instalatorem.');
 let actual;
 try{actual=await payloadFiles(root);}catch(e){throw new Error('Nie można sprawdzić zasobów pakietu: '+e.message+'. Napraw Biblioteczkę instalatorem.');}
 if(!isDeepStrictEqual(actual,expected.files)){
  const changed=[...new Set([...Object.keys(actual),...Object.keys(expected.files)])].filter(name=>actual[name]!==expected.files[name]);
  throw new Error('Uszkodzony pakiet: '+changed.slice(0,8).join(', ')+'. Napraw Biblioteczkę instalatorem.');
 }
 return {files:Object.keys(actual).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [action,root]=process.argv.slice(2);if(!root||!['--write','--verify'].includes(action))throw new Error('Użycie: payload-manifest.mjs --write|--verify folder');console.log(JSON.stringify(await (action==='--write'?writePayloadManifest:verifyPayloadManifest)(path.resolve(root))));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
