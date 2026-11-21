const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const endY=-14,endX=-3;
const transform=(x,y,angle,scale,tilt=0)=>`translate(${x}px,${y}px) perspective(1000px) rotateY(${angle}deg) rotateX(${tilt}deg) scale3d(${scale},${scale},${scale})`;
// Project all eight corners, including the binding thickness. The transform
// origin is the spine's middle, so scaling also changes the visible top edge.
function projected(w,h,d,scale){
 const angle=endY*Math.PI/180,tilt=endX*Math.PI/180,points=[];
 for(const x of [0,w])for(const y of [0,h])for(const z of [-d/2,d/2]){
  const ry=((y-h/2)*Math.cos(tilt)-z*Math.sin(tilt))*scale,rz=((y-h/2)*Math.sin(tilt)+z*Math.cos(tilt))*scale;
  const px=x*scale*Math.cos(angle)+rz*Math.sin(angle),pz=-x*scale*Math.sin(angle)+rz*Math.cos(angle),k=1/(1-pz/1000);
  points.push({x:px*k,y:ry*k+h/2});
 }
 const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
 return {left,top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top};
}
export function bookMotionGeometry({rect,coverRatio,width,height,iconSpace=.2,infoSize}){
 if(!rect||![width,height,coverRatio,rect.width,rect.height].every(v=>Number.isFinite(v)&&v>0)||![rect.left,rect.top,iconSpace].every(Number.isFinite)||iconSpace<0||iconSpace>.3)throw Error('Invalid book motion geometry');
 if(infoSize&&![infoSize.width,infoSize.height].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid information dimensions');
 const w=rect.height*clamp(coverRatio,.25,2),h=rect.height,d=rect.width,side=Math.min(24,width*.05),top=Math.min(72,height*.12),bottom=Math.min(100,height*.16),availableWidth=width-2*side,spaceHeight=height-top-bottom;
 const infoWidth=infoSize?Math.min(infoSize.width,availableWidth):0,infoHeight=infoSize?Math.min(infoSize.height,spaceHeight*.6):0,gap=infoSize?Math.min(12,spaceHeight*.1):0,availableHeight=spaceHeight-infoHeight-gap;
 let scale=Math.min(2,availableWidth/(w+d),availableHeight/h),bounds=projected(w,h,d,scale);
 for(let i=0;i<5&&(bounds.width>availableWidth||bounds.height>availableHeight);i++){scale*=Math.min(availableWidth/bounds.width,availableHeight/bounds.height)*.999;bounds=projected(w,h,d,scale);}
 const groupWidth=Math.max(bounds.width,infoWidth),reserve=Math.max(side,width*iconSpace+16),maxX=width-side-groupWidth,minX=Math.min(reserve,maxX),groupX=clamp(rect.left+d/2-w*scale*.15+(bounds.width-groupWidth)/2,minX,maxX);
 const x=groupX+(groupWidth-bounds.width)/2,y=clamp(rect.top+h-h*scale+h*.14,top,height-bottom-bounds.height-infoHeight-gap);
 // Raster at the largest visible pose. A downscale-only animation avoids
 // stretching a shelf-sized compositor bitmap while the cover turns.
 const rasterScale=Math.max(1.12,scale),originShift=h*(rasterScale-1)/2;
 return {width:w,height:h,depth:d,scale,rasterScale,model:{width:w*rasterScale,height:h*rasterScale,depth:d*rasterScale},
  start:{transform:transform(rect.left+d/2,rect.top-originShift,90,1/rasterScale)},
  pull:{transform:transform(rect.left+d/2-3,rect.top-h*.07-originShift,90,1.12/rasterScale)},
  end:{transform:transform(x-bounds.left,y-bounds.top-originShift,endY,scale/rasterScale,endX),x,y,width:bounds.width,height:bounds.height},
  info:infoSize?{x:groupX+(groupWidth-infoWidth)/2,y:y+bounds.height+gap,width:infoWidth,height:infoHeight}:null};
}
