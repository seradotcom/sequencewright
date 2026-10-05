/** Browser design projection. Never a substitute for native measurement or rendering. */
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const active = doc => doc.scenes.filter(s => !s.archived);
export const total = doc => active(doc).reduce((n,s) => n+s.duration,0);
export function atFrame(doc, frame) {
 const scenes=active(doc); let start=0; const f=Math.max(0,Math.min(total(doc)-1,Math.floor(frame)));
 for(const scene of scenes){if(f<start+scene.duration)return {scene,local:f-start,start};start+=scene.duration;}
 return {scene:scenes.at(-1),local:0,start:0};
}
export function timecode(frame, fps={num:30,den:1}) {
 const seconds=Math.floor(frame*fps.den/fps.num), base=Math.ceil(fps.num/fps.den);
 const f=Math.floor(frame-seconds*fps.num/fps.den);
 return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60,Math.min(f,base-1)].map(n=>String(n).padStart(2,'0')).join(':');
}
export function animated(object, frame=0) {
 const value={...object};
 for(const property of new Set(object.keyframes.map(k=>k.property))){
  const keys=object.keyframes.filter(k=>k.property===property).sort((a,b)=>a.frame-b.frame);
  if(frame<=keys[0].frame){value[property]=keys[0].value;continue;}
  if(frame>=keys.at(-1).frame){value[property]=keys.at(-1).value;continue;}
  const end=keys.findIndex(k=>k.frame>frame),a=keys[end-1],b=keys[end];let t=(frame-a.frame)/(b.frame-a.frame);
  if(b.easing==='hold')t=0;else if(b.easing==='ease-in-out')t=t<0.5?4*t*t*t:1-((-2*t+2)**3)/2;
  value[property]=a.value+(b.value-a.value)*t;
 }
 value.opacity=Math.max(0,Math.min(1000,value.opacity));value.width=Math.max(1,value.width);value.height=Math.max(1,value.height);return value;
}
export function sceneSvg(doc, scene, frame=60, {selected=null,guides=false,resource='',interactive=false}={}) {
 const {width,height}=doc.profile;
 const objects=scene.objects.filter(o=>!o.archived).map(original=>{
  const o=animated(original,frame),x=o.x,y=o.y,w=o.width,h=o.height;
  const source=doc.assets.find(a=>a.id===o.assetId);
  const url=source?`/api/blob?resource=${encodeURIComponent(resource)}&sha256=${source.sha256}`:'';
  let content='';
  if(o.kind==='text') content=`<text x="${x}" y="${y+o.fontSize*0.82}" fill="${escape(o.fill)}" font-family="DejaVu Sans, sans-serif" font-size="${o.fontSize}" font-weight="${o.weight}">${o.text.split('\n').map((line,i)=>`<tspan x="${x}" dy="${i?o.fontSize*1.15:0}">${escape(line)}</tspan>`).join('')}</text>`;
  else if(o.kind==='circle')content=`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${escape(o.fill)}"/>`;
  else if(o.kind==='image'&&source)content=`<image href="${escape(url)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
  else if(['audio','video'].includes(o.kind))content=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#283d48"/><text x="${x+12}" y="${y+28}" fill="#edf3f5" font-size="18">${escape(o.name)} · ${o.kind} asset</text>`;
  else content=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escape(o.fill)}"/>`;
  const hit=interactive?`<rect class="object-hit" data-object="${escape(o.id)}" x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" pointer-events="all"/>`:'';
  const outline=selected===o.id?`<rect x="${x-3}" y="${y-3}" width="${w+6}" height="${h+6}" fill="none" stroke="#c8e6ae" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`:'';
  return `<g transform="rotate(${o.rotation} ${x+w/2} ${y+h/2})"><g opacity="${o.opacity/1000}" pointer-events="none">${content}</g>${hit}${outline}</g>`;
 }).join('');
 const guide=guides?`<rect x="${width*.05}" y="${height*.05}" width="${width*.9}" height="${height*.9}" fill="none" stroke="#f1f3e980" stroke-dasharray="8 8" vector-effect="non-scaling-stroke" pointer-events="none"/><path d="M${width/2} 0V${height}M0 ${height/2}H${width}" stroke="#f1f3e945" vector-effect="non-scaling-stroke" pointer-events="none"/>`:'';
 return `<svg class="scene-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(scene.name)} — design preview"><rect width="${width}" height="${height}" fill="${escape(scene.background)}"/>${objects}${guide}</svg>`;
}
