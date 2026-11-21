import {el,request} from '../shared/api.mjs';
export function createImageUrlControl(root,{label,onImport,onStart=()=>{},onFinish=()=>{},download=(url,signal)=>request('/api/images/from-url',{method:'POST',body:{url},signal})}){
  const details=el('details','image-url'),summary=el('summary','','Wklej link'),fieldLabel=el('label','',label),row=el('div','image-url-row'),input=el('input'),button=el('button','secondary','Pobierz obraz'),note=el('p','muted','Bezpośredni link HTTPS do JPEG, PNG lub WebP, do 5 MiB.'),feedback=el('p','image-url-feedback');
  input.type='url';input.placeholder='https://…';input.maxLength=4096;input.autocomplete='off';input.setAttribute('aria-label',label);input.setAttribute('form','image-url-import');button.type='button';feedback.setAttribute('role','status');feedback.hidden=true;
  fieldLabel.append(input);row.append(fieldLabel,button);details.append(summary,row,note,feedback);root.append(details);
  let revision=0,controller=null,activeContext,externalDisabled=false;
  function disabled(){input.disabled=externalDisabled||!!controller;button.disabled=externalDisabled||!!controller;}
  function end(){controller=null;disabled();onFinish(activeContext);activeContext=undefined;}
  function cancel(){revision++;controller?.abort();if(controller)end();}
  async function load(){
    if(externalDisabled)return;
    cancel();const current=revision;
    let url;try{url=new URL(input.value.trim());if(url.protocol!=='https:'||url.username||url.password)throw Error();}
    catch{feedback.hidden=false;feedback.className='image-url-feedback ai-error';feedback.textContent='Wklej poprawny, bezpośredni adres HTTPS obrazu.';return;}
    controller=new AbortController();const signal=controller.signal;activeContext=onStart();const context=activeContext;
    input.disabled=true;button.disabled=true;feedback.hidden=false;feedback.className='image-url-feedback';feedback.textContent='Pobieram obraz…';
    try{
      const image=await download(url.href,signal);
      if(current!==revision||signal.aborted||!root.contains(details))return;
      await onImport(image,context);
      if(current===revision&&!signal.aborted&&root.contains(details)){feedback.textContent='Obraz pobrany.';input.value='';}
    }catch(error){if(current===revision&&!signal.aborted&&root.contains(details)){feedback.className='image-url-feedback ai-error';feedback.textContent=error.message;}}
    finally{if(current===revision)end();}
  }
  button.onclick=load;input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();return load();}};
  return {cancel,setDisabled(value){externalDisabled=!!value;disabled();},reset(){cancel();input.value='';feedback.textContent='';feedback.hidden=true;details.open=false;}};
}
