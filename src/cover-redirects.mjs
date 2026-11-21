import {problem} from './domain.mjs';

const invalid=()=>{throw problem('INVALID','Niedozwolone przekierowanie okładki.');};
const dataHost=/^(?:ia|dn)[0-9]{6}\.(?:us|ca|eu)\.archive\.org$/;
function destination(location,base){
 if(typeof location!=='string'||!location||location.length>2048||/[\u0000-\u0020\u007f\\]/.test(location))invalid();
 let url;try{url=new URL(location,base);}catch{invalid();}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)invalid();return url;
}
function bundle(url,request){
 if(url.hostname!=='archive.org'||url.search)invalid();
 const parts=url.pathname.split('/');if(parts.length!==5||parts[1]!=='download')invalid();
 const [, ,item,zip,file]=parts;let coverId,size;
 if(/^[sml]_covers_[0-9]{4}$/.test(item)){
  const match=/^([0-9]{10})-([SML])\.jpg$/.exec(file);if(!match)invalid();
  coverId=Number(match[1]);size=match[2];
  // Modern archives are grouped by millions, then by ten-thousands, exactly
  // as Open Library coverstore/archive.py constructs their padded filenames.
  if(item!==`${size.toLowerCase()}_covers_${match[1].slice(0,4)}`||zip!==`${item}_${match[1].slice(4,6)}.zip`)invalid();
 }else if(/^olcovers(?:0|[1-9][0-9]*)$/.test(item)){
  const match=/^([1-9][0-9]{0,15})-([SML])\.jpg$/.exec(file);if(!match)invalid();
  coverId=Number(match[1]);size=match[2];
  // The legacy zipview path in coverstore/code.py holds 10,000 covers/item.
  if(item!=='olcovers'+Math.floor(coverId/10000)||zip!==`${item}-${size}.zip`)invalid();
 }else invalid();
 if(!Number.isSafeInteger(coverId)||coverId<=0||size!==request.size||(request.kind==='id'&&coverId!==Number(request.value)))invalid();
 return {item,zip,file};
}
const same=(a,b)=>a.item===b.item&&a.zip===b.zip&&a.file===b.file;

// A covers.openlibrary.org response may introduce one official cover bundle.
// Later redirects can move that exact image between archive front/data servers,
// but cannot introduce a different archive, file, endpoint or arbitrary URL.
export function createCoverRedirectValidator(request){
 let expected=null;
 return function validate(current,location){
  const from=new URL(current),next=destination(location,current);
  if(next.hostname==='covers.openlibrary.org'){
   if(expected||from.hostname!=='covers.openlibrary.org')invalid();return next.href;
  }
  if(next.hostname==='archive.org'){
   const image=bundle(next,request);
   if(!expected){if(from.hostname!=='covers.openlibrary.org')invalid();expected=image;}
   else if(!same(expected,image))invalid();
   return next.href;
  }
  if(!expected||!dataHost.test(next.hostname)||next.pathname!=='/view_archive.php')invalid();
  const keys=[...next.searchParams.keys()].sort();if(keys.length!==2||keys[0]!=='archive'||keys[1]!=='file')invalid();
  const archive=/^\/[0-9]{1,3}\/items\/([^/]+)\/([^/]+)$/.exec(next.searchParams.get('archive')??'');
  if(!archive||archive[1]!==expected.item||archive[2]!==expected.zip||next.searchParams.get('file')!==expected.file)invalid();
  return next.href;
 };
}
