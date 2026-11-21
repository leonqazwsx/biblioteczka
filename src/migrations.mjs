import {validateState,problem} from './domain.mjs';
export function migrateState(input,{newId=()=>crypto.randomUUID()}={}){
  if(input?.schemaVersion===2)return validateState(input);
  if(input?.schemaVersion!==1)throw problem('INVALID','Nieobsługiwany format kolekcji.');
  return validateState({...input,schemaVersion:2,collectionId:newId(),settings:{...input.settings,aiEnabled:false},books:input.books?.map(b=>({...b,spine:null,spineGeneration:0}))});
}
