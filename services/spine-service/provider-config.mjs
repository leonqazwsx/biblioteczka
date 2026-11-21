import {createHash} from 'node:crypto';
import {SPINE_CONFIG} from '../../src/spine-provider.mjs';
import {exactKeys} from '../../src/durable-files.mjs';
import {problem} from '../../src/domain.mjs';

export const CLOUDFLARE_SPINE_CONFIG=Object.freeze({provider:'cloudflare',model:'cf-flux-2-klein-4b',remoteModel:'@cf/black-forest-labs/flux-2-klein-4b',promptVersion:'cover-motif-cf-v1',referenceVersion:'sharp-480-jpeg-v1',width:512,height:1536});
const label=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(value);
export function validateProviderConfig(config){
  const invalid=()=>{throw problem('SERVICE_CONFIG','Nieprawidłowa konfiguracja dostawcy ilustracji.');};
  if(exactKeys(config,Object.keys(SPINE_CONFIG))){
    if(!label(config.model)||!label(config.promptVersion)||typeof config.quality!=='string'||!/^\d{1,5}x\d{1,5}$/.test(config.size)||!['webp','png','jpeg'].includes(config.output_format)||!Number.isSafeInteger(config.output_compression)||config.output_compression<0||config.output_compression>100)invalid();
  }else if(exactKeys(config,Object.keys(CLOUDFLARE_SPINE_CONFIG))){
    if(config.provider!=='cloudflare'||!label(config.model)||!label(config.promptVersion)||!label(config.referenceVersion)||typeof config.remoteModel!=='string'||!/^@cf\/[a-z0-9-]+\/[a-z0-9._-]+$/.test(config.remoteModel)||!['width','height'].every(key=>Number.isSafeInteger(config[key])&&config[key]>=256&&config[key]<=1920))invalid();
  }else invalid();
  return config;
}
export const providerConfigHash=config=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(config).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
