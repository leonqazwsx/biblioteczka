import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {problem} from '../../src/domain.mjs';

const references={
  original:{file:'output/execution/spine-quality-20261017/assets/diuna-cover.jpg',mime:'image/jpeg',hash:'02670b485328a6e479ab690b2554f5280c123c2bae26ddea477e23fe3ac8df95'},
  textless:{file:'output/execution/spine-textless-9b-20261019/assets/diuna-reference-textless.png',mime:'image/png',hash:'41977fb72cbee18c7addcb2b92de2fd8d8698211b3091d7efb4ad421c7703fdf'},
  autoCleaned:{file:'output/execution/spine-cover-cleanup-9b-20261019/assets/diuna-cloudflare-9b-cover-cleaned.jpg',mime:'image/jpeg',hash:'3f3d25811f4904e3ff0ab248153a25ad9df814b8aef4f1daf754365122368542'}
};
export async function readQualityCover({appRoot,textless=false,autoCleaned=false}){
  if(!path.isAbsolute(appRoot??'')||typeof textless!=='boolean'||typeof autoCleaned!=='boolean'||(textless&&autoCleaned))throw problem('SERVICE_CONFIG','Nieprawidłowa konfiguracja referencji próby.');
  const reference=references[autoCleaned?'autoCleaned':textless?'textless':'original'];
  const changed=()=>problem(textless||autoCleaned?'QUALITY_REFERENCE_CHANGED':'QUALITY_COVER_CHANGED','Referencja próby jest niedostępna lub zmieniona.');
  const coverBytes=await fs.readFile(path.join(appRoot,reference.file)).catch(()=>{throw changed();});
  if(createHash('sha256').update(coverBytes).digest('hex')!==reference.hash)throw changed();
  return {coverBytes,coverMime:reference.mime,expectedCoverHash:reference.hash};
}
