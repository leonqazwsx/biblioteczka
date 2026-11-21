import test from 'node:test';
import assert from 'node:assert/strict';
const {fitSpineTitle,fitSpineTitles}=await import('../public/shared/spine-title-fit.mjs').catch(()=>({}));

// Controlled layout measurements isolate the fit search from a browser's font
// rasterizer. Real font loading and room geometry are checked in the browser.
function measuredTitle(t){
  const previous=globalThis.getComputedStyle;
  globalThis.getComputedStyle=element=>({fontSize:element.style.fontSize||'20px'});
  t.after(()=>{globalThis.getComputedStyle=previous;});
  return {isConnected:true,clientWidth:50,clientHeight:200,textContent:'Zażółć gęślą jaźń',
    style:{fontSize:'',removeProperty(){this.fontSize='';}},
    get scrollWidth(){return Math.ceil(parseFloat(this.style.fontSize||20)*(this.glyphScale??1));},
    get scrollHeight(){return Math.ceil(parseFloat(this.style.fontSize||20)*20);}};
}

test('a long single-line title keeps a readable size and reports visual truncation without changing metadata',t=>{
  const title=measuredTitle(t),text=title.textContent;
  const result=fitSpineTitle(title);
  assert.equal(result.fits,true);assert.equal(result.fontSize,20);assert.equal(result.truncated,true);
  assert.equal(title.textContent,text);
});

test('fitting responds to spine width but never shrinks just to retain a long title',t=>{
  const title=measuredTitle(t);fitSpineTitle(title);
  title.clientHeight=100;assert.equal(fitSpineTitle(title).fontSize,20);
  title.clientWidth=5;assert.ok(fitSpineTitle(title).fontSize<=5);
  title.clientWidth=50;title.clientHeight=600;assert.equal(fitSpineTitle(title).fontSize,20);assert.equal(fitSpineTitle(title).truncated,false);
});

test('a hidden or disconnected preview waits for usable dimensions',t=>{
  const title=measuredTitle(t);title.style.fontSize='9px';
  title.clientWidth=0;assert.equal(fitSpineTitle(title),null);assert.equal(title.style.fontSize,'9px');
  title.clientWidth=50;title.isConnected=false;assert.equal(fitSpineTitle(title),null);
});

test('opening a hidden editor still refits when its first real font finishes loading',async t=>{
  const title=measuredTitle(t);title.clientWidth=0;title.closest=()=>null;
  let ready=Promise.resolve();
  const root={isConnected:true,querySelectorAll:()=>[title],ownerDocument:{fonts:{get ready(){return ready;}}}};
  fitSpineTitles(root);await ready;await Promise.resolve();
  let finishFont;ready=new Promise(resolve=>{finishFont=resolve;});
  title.clientWidth=20;fitSpineTitles(root);assert.equal(parseFloat(title.style.fontSize||20),20);
  title.glyphScale=4;finishFont();await ready;await Promise.resolve();
  assert.ok(parseFloat(title.style.fontSize)<=5,'the newly loaded font must be measured again');
});
