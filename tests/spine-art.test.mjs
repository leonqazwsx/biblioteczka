import test from 'node:test';import assert from 'node:assert/strict';
const {createSpineElement} = await import('../public/shared/spine-art.mjs').catch(()=>({}));
class Element {constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={values:{},setProperty(key,value){this.values[key]=value;}};}setAttribute(key,value){this.attributes[key]=value;}append(...children){this.children.push(...children);}}
const document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
test('preview and interactive wallpaper crop only the artwork, leaving letters and binding geometry intact',()=>{
 const book={title:'Kadr obrazu',authors:['Autor'],spine:{assetId:'a'.repeat(64),kind:'manual',frame:{x:23,y:72,zoom:1.6}}};
 const preview=createSpineElement(book,{document}),wallpaper=createSpineElement(book,{document,interactive:true});
 const image=art=>art.children[0].children.find(x=>x.tagName==='img');assert.equal(image(preview).style.values['object-position'],'23% 72%');assert.equal(image(preview).style.values.transform,'scale(1.6)');assert.equal(image(preview).style.values['transform-origin'],'23% 72%');assert.deepEqual(image(preview).style.values,image(wallpaper).style.values);
 assert.equal(preview.children[0].style.values.transform,undefined);assert.equal(preview.children[0].children.find(x=>x.className==='spine-title').style.values.transform,undefined);
});
test('illustration stays under real text with a local asset URL and error fallback',()=>{const book={title:'Solaris',authors:['Stanisław Lem'],spine:{assetId:'a'.repeat(64),kind:'ai'}};const art=createSpineElement(book,{document}),face=art.children[0],img=face.children.find(x=>x.tagName==='img');assert.ok(img);assert.equal(img.src,'/spines/'+book.spine.assetId);assert.equal(face.dataset.illustrated,'true');assert.equal(face.children.find(x=>x.className==='spine-title').textContent,'Solaris');img.onerror();assert.equal(face.dataset.illustrated,undefined);const bad=createSpineElement({...book,spine:{assetId:'https://evil.example'}},{document});assert.equal(bad.children[0].children.some(x=>x.tagName==='img'),false);});
test('moving visual is separate from the stable interactive hit area',()=>{const art=createSpineElement({title:'Sięganie po książkę',authors:['Autor']},{document,interactive:true});assert.equal(art.tagName,'button');const visual=art.children.find(x=>x.className==='spine-visual');assert.ok(visual,'book needs a visual layer independent of its button');assert.equal(visual.children.find(x=>x.className==='spine-title').textContent,'Sięganie po książkę');assert.match(art.attributes['aria-label'],/Sięganie/);});
test('preview and wallpaper use the same colors and saved template',()=>{assert.equal(typeof createSpineElement,'function');const book={title:'Żółć i źdźbło',authors:['Łukasz Ćwik'],palette:['#23435a','#d6aa64'],spineStyle:4,publisher:'Wydawnictwo'};const preview=createSpineElement(book,{document}),wallpaper=createSpineElement(book,{document,interactive:true});assert.equal(wallpaper.tagName,'button');assert.equal(preview.tagName,'div');assert.equal(preview.dataset.style,'4');assert.equal(preview.style.values['--spine'],'#23435a');assert.equal(preview.style.values['--spine-accent'],'#d6aa64');assert.deepEqual(preview.style.values,wallpaper.style.values);assert.equal(preview.children[0].children.find(x=>x.className==='spine-title').textContent,'Żółć i źdźbło');assert.match(wallpaper.attributes['aria-label'],/Łukasz Ćwik/);});
test('book metadata stays text and long titles remain accessible',()=>{assert.equal(typeof createSpineElement,'function');const title='<img src=x onerror=alert(1)>'+ ' długi tytuł'.repeat(35);const art=createSpineElement({title,authors:['<script>autor</script>']},{document});assert.equal(art.attributes['aria-label'],title+', <script>autor</script>');assert.equal(art.children[0].children.find(x=>x.className==='spine-title').textContent,title);assert.equal(art.children[0].children.some(x=>x.tagName==='img'||x.tagName==='script'),false);assert.equal(art.style.values['--title-size'],'13px');});

test('a saved cover immediately supplies local artwork without claiming an AI asset',()=>{
 const book={title:'Odwaga bycia nielubianym : bardzo długi podtytuł',authors:['Ichiro Kishimi'],coverId:'b'.repeat(64)};
 const before=structuredClone(book),art=createSpineElement(book,{document}),face=art.children[0],image=face.children.find(x=>x.tagName==='img');
 assert.ok(image);assert.equal(image.src,'/covers/'+book.coverId);assert.equal(face.dataset.artwork,'cover');assert.equal(face.dataset.illustrated,'true');assert.deepEqual(book,before);
 assert.equal(face.children.find(x=>x.className==='spine-title').textContent,book.title);assert.equal(art.attributes['aria-label'],book.title+', Ichiro Kishimi');
});
test('a real saved illustration takes precedence and retains its crop over cover artwork',()=>{
 const art=createSpineElement({title:'Solaris',authors:['Lem'],coverId:'b'.repeat(64),spine:{assetId:'a'.repeat(64),frame:{x:20,y:70,zoom:2}}},{document}),face=art.children[0],image=face.children.find(x=>x.tagName==='img');
 assert.equal(image.src,'/spines/'+'a'.repeat(64));assert.equal(face.dataset.artwork,'spine');assert.equal(image.style.values.transform,'scale(2)');
});
test('a broken illustration falls back once to the cover, then to binding colors on cover failure',()=>{
 const art=createSpineElement({title:'Solaris',authors:['Lem'],coverId:'b'.repeat(64),spine:{assetId:'a'.repeat(64),frame:{x:20,y:70,zoom:2}}},{document}),face=art.children[0],image=face.children.find(x=>x.tagName==='img');
 image.onerror();assert.equal(image.src,'/covers/'+'b'.repeat(64));assert.equal(face.dataset.artwork,'cover');assert.equal(image.style.values.transform,'none');
 image.onerror();assert.equal(face.dataset.illustrated,undefined);assert.equal(face.dataset.artwork,undefined);assert.equal(art.dataset.imageError,'true');
});
test('cover artwork accepts only local content hashes',()=>{
 for(const coverId of ['https://example.test/book.jpg','../private','b'.repeat(63),null]){
  const art=createSpineElement({title:'Solaris',authors:['Lem'],coverId},{document});assert.equal(art.children[0].children.some(x=>x.tagName==='img'),false);
 }
});
