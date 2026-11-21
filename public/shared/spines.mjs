const fallback=['#2e4b54','#784b42','#707951','#31596b','#96754c','#736377','#8c775f'];
const materials=['paper','paper','hardcover','cloth','hardcover','cloth'];
function seed(s){let n=2166136261;for(const c of s){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return n>>>0;}
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
export function contrastRatio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function makeSpine(book,colorOverride=null){
 const n=seed(book.title+'|'+book.authors.join('|')+'|'+(book.isbn??''));
 const color=colorOverride??book.palette?.[0]??fallback[n%fallback.length];
 const light='#fffdf6',dark='#030201';
 const ink=c=>contrastRatio(c,light)>contrastRatio(c,dark)?light:dark;
 const accent=book.palette?.slice(1).find(c=>contrastRatio(color,c)>1.4)??'#'+color.slice(1).match(/../g).map((x,i)=>Math.round(parseInt(x,16)*.4+[244,228,199][i]*.6).toString(16).padStart(2,'0')).join('');
 const spineStyle=book.spineStyle??n%6;
 return {palette:[color,...(book.palette?.slice(1)??[])],foreground:ink(color),accent,accentForeground:ink(accent),spineStyle,material:materials[spineStyle],width:Math.min(96,Math.max(46,Math.round(42+(book.pageCount??240)/13))),titleSize:book.title.length>70?13:book.title.length>35?15:18};
}
