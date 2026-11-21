import {createCoverPicker} from './cover-picker.mjs';
// Palette extraction decodes an image asynchronously. The picker cannot roll
// back an editor callback, so recheck its context at the actual mutation point.
export function createEditorCoverPicker(root,{request,getContext,localPalette,applyCover,setBusy,onError}){
 return createCoverPicker(root,{request,getContext,onBusy:setBusy,onError,onApply:async(saved,context)=>{
  const colors=await localPalette(saved.coverId);if(!context.isCurrent())return;applyCover(saved,colors);
 }});
}
