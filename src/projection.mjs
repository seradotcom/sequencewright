import {createHash} from 'node:crypto';
import {need,rational,validateDocument} from './contracts.mjs';
import {activeScenes,duration} from './model.mjs';
/** DTO projection ONLY. semwright-motion-authoring::realize remains the compiler. */
export function toFilm(doc){
 validateDocument(doc);const p=doc.profile;need(p.width<=4096&&p.height<=4096&&p.width*p.height<=8847360&&p.fps.num/p.fps.den<=120,'Profile exceeds canonical Motion Canvas limits','Unsupported');
 const scenes=activeScenes(doc);need(scenes.length<=32,'Canonical Film supports at most 32 sequences','ResourceExhausted');
 const q=f=>rational(BigInt(f)*BigInt(p.fps.den),p.fps.num);const span=(id,start,len)=>({id,minimum:q(len),preferred:q(len),maximum:q(len),anchor:{kind:'absolute',time:q(start)},preference_priority:0});
 const safeId=s=>'n-'+createHash('sha256').update(s).digest('hex').slice(0,32);const type_scale={body:24};const spans=[];let start=0;
 const sequences=scenes.map(s=>{
  need(s.renderer==='motion_canvas','This canonical Film projection supports Motion Canvas scenes only; select an explicit different production route','Unsupported');
  const sid=safeId(s.id),seq=`seq-${sid}`,shot=`shot-${sid}`;spans.push(span(`time-${seq}`,start,s.duration),span(`time-${shot}`,start,s.duration));const motion=[];
  const subjects=s.objects.filter(o=>!o.archived).map(o=>{
   const oid=`${sid}-${safeId(o.id)}`;need(!['image','video'].includes(o.kind)||o.opacity===1000,'Media opacity needs a tested canonical primitive mapping','Unsupported');need(o.rotation===0,'Static rotation requires a tested canonical primitive mapping','Unsupported');let content;
   if(o.kind==='text'){const style=`size-${o.fontSize}`;type_scale[style]=o.fontSize;content={kind:'text',runs:[{text:o.text,weight:o.weight,color:alpha(o.fill,o.opacity),emphasis:false}],style,direction:'auto',language:'en',wrap:true,truncate:false};}
   else if(o.kind==='rectangle'||o.kind==='line')content={kind:'rectangle',fill:alpha(o.fill,o.opacity),stroke:null,radius:0};
   else if(o.kind==='circle')content={kind:'circle',fill:alpha(o.fill,o.opacity),stroke:null};
   else if(o.kind==='image')content={kind:'image',asset_id:safeId(o.assetId),fit:'contain',ratio:o.width/o.height};
   else if(o.kind==='video')content={kind:'video',asset_id:safeId(o.assetId),fit:'contain',ratio:o.width/o.height,source_offset:q(0)};
   else throw new Error('Audio must be supplied through the canonical audiovisual coordinator, not a visual Film subject');
   if(o.keyframes.length){
    const k=o.keyframes;need(k.length===2&&k.every(x=>x.property==='opacity'&&['linear','ease-in-out'].includes(x.easing))&&k[0].value===0&&k[1].value===1000&&k[1].frame>k[0].frame,'Canonical projection currently supports a two-key opacity fade only; unsupported curves are not silently dropped','Unsupported');
    const mid=`motion-${oid}`;spans.push(span(`time-${mid}`,start+k[0].frame,k[1].frame-k[0].frame));motion.push({id:mid,span_id:`time-${mid}`,easing:k[1].easing==='ease-in-out'?'in_out_cubic':'linear',primitive:{kind:'fade_in',target:oid}});
   }
   return {id:oid,role:o.name,parent:null,layer:'content',content,layout:{kind:'fixed',position:{x:o.x+o.width/2-p.width/2,y:o.y+o.height/2-p.height/2},size:{width:o.width,height:o.height}},initially_visible:true,clip_intentional:false};
  });
  subjects.unshift({id:`${sid}-background`,role:'background',parent:null,layer:'background',content:{kind:'rectangle',fill:s.background,stroke:null,radius:0},layout:{kind:'fixed',position:{x:0,y:0},size:{width:p.width,height:p.height}},initially_visible:true,clip_intentional:true});
  const result={id:seq,span_id:`time-${seq}`,beats:[{id:`beat-${sid}`,role:s.role,shots:[{id:shot,span_id:`time-${shot}`,archetype:s.role==='cta'?'endcard':'statement',subjects,layers:[{id:'background',order:0,intentional_overlay:false},{id:'content',order:1,intentional_overlay:true}],annotations:[],captions:[],motion,constraints:[]}]}]};start+=s.duration;return result;
 });
 need(spans.length<=128,'Canonical temporal span budget exceeded','ResourceExhausted');need(Object.keys(type_scale).length<=32,'Canonical type scale budget exceeded','ResourceExhausted');
 const font={family:'DejaVu Sans',asset_digest:null,fallback:'deny',permitted_fallbacks:[]};return {version:1,id:safeId(doc.id),output:{width:p.width,height:p.height,frame_rate:p.fps,aspect:p.width>p.height?'landscape':p.width===p.height?'square':'portrait',safe_area:{top:32,right:32,bottom:32,left:32}},editorial:{version:1,font,mono_font:{...font,family:'DejaVu Sans Mono'},type_scale,colors:{background:scenes[0].background,text:'#ffffff'},spacing:{base:8},stroke:1,corner_radius:0},timing:{version:1,duration:q(duration(doc)),spans,constraints:[]},sequences,cues:{version:1,cues:[]},assets:doc.assets.map(a=>({id:safeId(a.id),sha256:a.sha256,media_type:a.mime,provenance:a.provenance,license:a.license}))};
}
function alpha(c,opacity){return c+Math.round(opacity*255/1000).toString(16).padStart(2,'0');}
function timestamp(frame,rate,separator){const ms=Number(BigInt(frame)*BigInt(rate.den)*1000n/BigInt(rate.num));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${separator}${String(ms%1000).padStart(3,'0')}`;}
export function toVtt(doc){return 'WEBVTT\n\n'+doc.captions.map(c=>`${c.id}\n${timestamp(c.start,doc.profile.fps,'.')} --> ${timestamp(c.end,doc.profile.fps,'.')}\n${c.text.replaceAll('-->','→').replaceAll('\r','')}\n`).join('\n');}
export function toSrt(doc){return doc.captions.map((c,i)=>`${i+1}\n${timestamp(c.start,doc.profile.fps,',')} --> ${timestamp(c.end,doc.profile.fps,',')}\n${c.text.replaceAll('-->','→').replaceAll('\r','')}\n`).join('\n');}
export function technicalFindings(doc){const out=[];for(const s of activeScenes(doc)){if(s.claimStatus!=='supported')out.push({id:`claim-${s.id}`,scene:s.id,kind:'editorial',severity:'review',message:'Narrative claim has not been marked supported.',coverage:'metadata only'});for(const o of s.objects.filter(x=>!x.archived)){if(o.x<0||o.y<0||o.x+o.width>doc.profile.width||o.y+o.height>doc.profile.height)out.push({id:`bounds-${s.id}-${o.id}`,scene:s.id,object:o.id,kind:'technical',severity:'warning',message:'Design bounds extend beyond the output frame.',coverage:'static design coordinates; not native measurement'});if(o.kind==='text'&&o.fontSize<18)out.push({id:`type-${o.id}`,scene:s.id,object:o.id,kind:'creative-advice',severity:'review',message:'Small text may be hard to read on mobile.',coverage:'advisory; not a measured legibility verdict'});}}
 if(!doc.assets.some(a=>a.mime.startsWith('audio/')))out.push({id:'audio-missing',kind:'technical',severity:'warning',message:'No audio asset is attached. Narration text is not synthesized audio.',coverage:'asset inventory'});
 return out;
}
