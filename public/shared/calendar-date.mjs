// Store a calendar day, never a timestamp: time zones must not move this date.
export function localCalendarDate(date=new Date()){
  const year=String(date.getFullYear()).padStart(4,'0');
  const month=String(date.getMonth()+1).padStart(2,'0');
  const day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}
export function normalizeReadDate(value){
  if(value==null||value==='')return null;
  const invalid=()=>{throw Object.assign(new Error('Podaj prawidłową datę przeczytania.'),{code:'INVALID'});};
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid();
  const [year,month,day]=value.split('-').map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1])invalid();
  return value;
}
export function formatReadDate(value){
  const date=normalizeReadDate(value);
  if(!date)return null;
  const [year,month,day]=date.split('-');
  return `${day}.${month}.${year}`;
}
