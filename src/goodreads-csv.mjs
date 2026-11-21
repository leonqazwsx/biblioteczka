import {parseCsv} from './csv.mjs';
import {normalizeIsbn} from './catalog.mjs';
import {normalizeReadDate} from '../public/shared/calendar-date.mjs';
import {suggestShelf} from '../public/shared/categories.mjs';
const statusMap=new Map([['read','read'],['currently-reading','reading'],['to-read','to-read']]);
const key=v=>v.normalize('NFKC').trim().toLocaleLowerCase('pl');
const failure=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function parseGoodreadsCsv(bytes){
 if(!(bytes instanceof Uint8Array))failure('INVALID_CSV','Wybierz plik CSV w UTF8.');
 if(bytes.byteLength>10*1024*1024)failure('TOO_LARGE','Plik CSV może mieć maksymalnie 10 MiB.');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{failure('INVALID_CSV','Zapisz plik CSV w kodowaniu UTF8.');}
 const parsed=parseCsv(text),columns=new Map(parsed.headers.map((h,i)=>[h.toLocaleLowerCase('pl'),i]));
 if(!columns.has('title')||!columns.has('author'))failure('INVALID_CSV','CSV musi zawierać kolumny Title i Author.');
 const notices=[];
 if(!columns.has('exclusive shelf')&&!columns.has('bookshelves'))notices.push('Brak oznaczenia przeczytania w pliku. Książki bez niego zostaną pominięte.');
 if(!columns.has('date read'))notices.push('Brak kolumny Date Read; daty pozostaną puste.');
 const records=parsed.records.map(({recordNumber,cells})=>{
  const value=name=>columns.has(name)?cells[columns.get(name)].trim():'';
  const errors=[],warnings=[];
  function bounded(name,label,max,required=false){const v=value(name);if(required&&!v||v.length>max)errors.push(`Nieprawidłowe pole: ${label}.`);return v||null;}
  const title=bounded('title','tytuł',500,true),author=bounded('author','autor',200,true),additional=bounded('additional authors','dodatkowi autorzy',200);
  const authors=[author,...additional?[additional]:[]];if(additional)warnings.push('Dodatkowych autorów zachowano jako jeden wpis. Sprawdź podział w edytorze książki.');
  const publisher=bounded('publisher','wydawca',500),goodreadsId=value('book id')||null;
  if(goodreadsId&&!/^\d{1,32}$/.test(goodreadsId))errors.push('Nieprawidłowy Book Id.');
  const isbnValues=['isbn13','isbn'].map(name=>{
   let v=value(name);const wrapper=/^="([^\"]*)"$/.exec(v);if(wrapper)v=wrapper[1];if(!v)return {isbn:null,invalid:false};
   try{const isbn=normalizeIsbn(v);return {isbn,invalid:!isbn};}catch{return {isbn:null,invalid:true};}
  });
  const isbn=isbnValues.find(v=>v.isbn?.length===13)?.isbn??isbnValues.find(v=>v.isbn)?.isbn??null;
  if(isbnValues.some(v=>v.invalid)){if(isbn)warnings.push('Dodatkowy ISBN jest nieprawidłowy; użyto drugiego poprawnego numeru.');else errors.push('Nieprawidłowy ISBN.');}
  const rawTags=value('bookshelves').split(',').map(v=>v.trim()).filter(Boolean),seen=new Set(),subjects=[];
  for(const tag of rawTags){const k=key(tag);if(statusMap.has(k)||seen.has(k))continue;seen.add(k);subjects.push(tag);}
  if(subjects.length>80||subjects.some(t=>t.length>160))errors.push('Półki z pliku przekraczają limit 80 tematów po 160 znaków.');
  const exclusive=key(value('exclusive shelf')),shelfStatuses=[...new Set(rawTags.map(key).filter(v=>statusMap.has(v)))];let status='to-read';
  if(statusMap.has(exclusive))status=statusMap.get(exclusive);
  else if(!exclusive&&shelfStatuses.length===1)status=statusMap.get(shelfStatuses[0]);
  else if(exclusive||shelfStatuses.length!==1)warnings.push('Nieznane lub niejednoznaczne oznaczenie przeczytania; pozycja zostanie pominięta.');
  let readDate=null;const date=value('date read');if(date){try{readDate=normalizeReadDate(/^\d{4}\/\d{2}\/\d{2}$/.test(date)?date.replaceAll('/','-'):date);}catch{errors.push('Nieprawidłowa data przeczytania.');}}
  function numeric(name,label,max){const v=value(name);if(!v)return null;const n=Number(v);if(!/^\d+$/.test(v)||!Number.isSafeInteger(n)||n<1||n>max){errors.push(`Nieprawidłowe pole: ${label}.`);return null;}return n;}
  const year=numeric('year published','rok wydania',9999),pageCount=numeric('number of pages','liczba stron',100000);
  const candidate=errors.length?null:{title,authors,isbn,goodreadsId,publisher,publicationYear:year===null?null:String(year),pageCount,status,readDate,subjects,provider:null,providerId:null,language:null,coverId:null,palette:[],spineStyle:0,spine:null,spineGeneration:0};
  return {rowId:crypto.randomUUID(),recordNumber,display:{title:(title??'').slice(0,500),authors:authors.filter(Boolean).map(a=>a.slice(0,200)),status,readDate},candidate,errors,warnings};
 });
 return {records,notices};
}
export function proposeGoodreadsCategory(subjects,shelves){
 const keys=new Set(subjects.map(key)),matches=shelves.filter(s=>keys.has(key(s.name)));
 if(matches.length===1)return {shelfId:matches[0].id,newShelfName:null};
 const proposed=suggestShelf(matches.length>1?[]:subjects,shelves);
 return {shelfId:proposed.shelfId,newShelfName:proposed.newShelfName};
}
