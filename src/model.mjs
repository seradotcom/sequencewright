/** App-specific editable scene intent. Canonical Film is generated, never redefined here. */
import {randomUUID} from 'node:crypto';
import {need,closed,id,str,color,integer,validateDocument,validateObject,RENDERERS} from './contracts.mjs';
export const uid=prefix=>`${prefix}-${randomUUID().slice(0,12)}`;
export const clone=x=>structuredClone(x);
export function makeObject(kind='text',overrides={}){return {id:uid('obj'),kind,name:kind==='text'?'New title':'New shape',x:120,y:160,width:780,height:100,rotation:0,opacity:1000,fill:'#f1f3ee',text:kind==='text'?'Make the next frame matter.':'',fontSize:64,weight:600,keyframes:[],archived:false,...overrides};}
export function makeScene(overrides={}){return {id:uid('scene'),name:'Untitled scene',role:'mechanism',duration:180,renderer:'motion_canvas',background:'#131c22',narration:'',claimStatus:'unreviewed',objects:[],archived:false,...overrides};}
export function createDocument(title='Untitled sequence',projectId=uid('project')){return {schema:'sequencewright/document/1',id:projectId,title,description:'',profile:{width:1280,height:720,fps:{num:30,den:1}},brief:{audience:'',objective:'',promise:'',tone:'',constraints:'',references:''},scenes:[makeScene({objects:[makeObject()]})],assets:[],captions:[],locks:[],proposals:[],reviews:[],deliveries:[]};}
export function demoDocument(kind='product'){
 const d=createDocument(kind==='lesson'?'A quieter kind of learning':kind==='brand'?'Made for the long way home':'From intent to real software',`demo-${kind}`);
 d.description='An original, editable starter project. Design preview only; no supplied voice or native render.';
 const palettes=kind==='brand'?['#24201c','#f5eee0','#dcc5a1']:kind==='lesson'?['#ebe7dc','#223c38','#a0b6a2']:['#142023','#eff3e8','#b7d7a0'];
 const [bg,fg,accent]=palettes;
 const titles=kind==='lesson'?['Small steps.\nLasting understanding.','See the pattern.','Give curiosity room.','Try. Reflect. Repeat.']:kind==='brand'?['Go somewhere\nthat stays with you.','Less noise.\nMore horizon.','Built for the everyday.','Take the long way home.']:['Good ideas need\na way into the world.','Reasoning is only\nthe beginning.','Intent. Action.\nEvidence.','Make real work\nhappen.'];
 d.brief={audience:kind==='lesson'?'Curious learners':'People who make things',objective:'Explain one idea with clarity, pacing and visual continuity.',promise:'A story that can be revised, not just generated.',tone:'Confident, deliberate, warm.',constraints:'Do not invent measurements or a voiceover. Preserve readable text.',references:'Original editorial composition; no third-party brand assets.'};
 d.scenes=titles.map((title,i)=>makeScene({id:`s-${i+1}`,name:['An idea begins','The missing step','A connected workflow','A clear invitation'][i],role:['hook','problem','mechanism','cta'][i],duration:[240,210,300,210][i],background:bg,narration:['Ideas become useful when they meet the real world.','Understanding the task is different from completing it.','Keep intent, action and evidence connected.','Create, review and refine the next version.'][i],objects:[
 makeObject('text',{id:`o-${i+1}-eyebrow`,name:'Section label',x:80,y:66,width:800,height:28,fontSize:18,weight:500,fill:accent,text:`0${i+1}  /  ${['THE IDEA','THE CHALLENGE','THE APPROACH','THE INVITATION'][i]}`}),
 makeObject('text',{id:`o-${i+1}-title`,name:'Main statement',x:80,y:204,width:760,height:190,fontSize:70,weight:500,fill:fg,text:title,keyframes:[{frame:0,property:'opacity',value:0,easing:'linear'},{frame:20,property:'opacity',value:1000,easing:'ease-in-out'}]}),
 makeObject('text',{id:`o-${i+1}-caption`,name:'Supporting line',x:83,y:468,width:660,height:55,fontSize:22,weight:400,fill:accent,text:i===2?'A shared state. A verifiable result.':'A film made one thoughtful decision at a time.'}),
 makeObject('circle',{id:`o-${i+1}-orb`,name:'Signal',x:962,y:237,width:182,height:182,fill:accent,opacity:1000}),
 makeObject('circle',{id:`o-${i+1}-core`,name:'Signal center',x:1000,y:275,width:106,height:106,fill:bg}),
 makeObject('line',{id:`o-${i+1}-line`,name:'Connection',x:80,y:621,width:1060,height:2,fill:accent,opacity:350}),
 makeObject('text',{id:`o-${i+1}-footer`,name:'Film identifier',x:80,y:649,width:600,height:25,fontSize:16,weight:400,fill:accent,text:'SEQUENCEWRIGHT  /  ORIGINAL STUDY'})]}));
 let t=0;d.captions=d.scenes.map((s,i)=>{const c={id:`c-${i}`,start:t,end:t+s.duration,text:s.narration,language:'en'};t+=s.duration;return c;});return validateDocument(d);
}
export function activeScenes(doc){return doc.scenes.filter(s=>!s.archived);}
export function duration(doc){return activeScenes(doc).reduce((n,s)=>n+s.duration,0);}
export function scene(doc,sceneId){const x=doc.scenes.find(s=>s.id===sceneId);need(x,'Scene not found','NotFound');return x;}
export function subject(doc,sceneId,objectId){const x=scene(doc,sceneId).objects.find(o=>o.id===objectId);need(x,'Object not found','NotFound');return x;}
export function assertUnlocked(doc,scopes,actor){for(const l of doc.locks){need(l.owner===actor||!(l.scope==='project'||scopes.includes(l.scope)),`${l.scope} is locked by ${l.owner}: ${l.reason}`,'Conflict');}}
export const EDITS=['document.edit','scene.add','scene.update','scene.reorder','scene.archive','object.add','object.update','object.archive','keyframe.set','keyframe.remove','caption.set','caption.remove','brief.update','delivery.profile'];
export function applyEdit(doc,op,p,actor){
 need(EDITS.includes(op),'Operation cannot be used inside a proposal','Unsupported');
 const targetScopes=[p.sceneId,p.objectId].filter(Boolean);if(p.sceneId&&!p.objectId)targetScopes.push(...scene(doc,p.sceneId).objects.map(o=>o.id));if(!targetScopes.length)targetScopes.push(...doc.locks.map(l=>l.scope));assertUnlocked(doc,targetScopes,actor);
 switch(op){
 case 'document.edit':closed(p,['title','description','profile']);if(p.title!==undefined)doc.title=str(p.title,120);if(p.description!==undefined)doc.description=str(p.description,2000);if(p.profile!==undefined)doc.profile=clone(p.profile);break;
 case 'brief.update':closed(p,['audience','objective','promise','tone','constraints','references']);for(const[k,v]of Object.entries(p))doc.brief[k]=str(v,6000);break;
 case 'scene.add':closed(p,['scene','afterId'],['scene']);need(!doc.scenes.some(s=>s.id===p.scene.id),'Scene id already exists','Conflict');if(p.afterId){const i=doc.scenes.findIndex(s=>s.id===p.afterId);need(i>=0,'Insertion anchor not found','NotFound');doc.scenes.splice(i+1,0,clone(p.scene));}else doc.scenes.push(clone(p.scene));break;
 case 'scene.update':{closed(p,['sceneId','changes'],['sceneId','changes']);const s=scene(doc,p.sceneId);closed(p.changes,['name','role','duration','renderer','background','narration','claimStatus']);Object.assign(s,clone(p.changes));break;}
 case 'scene.reorder':{closed(p,['order'],['order']);need(Array.isArray(p.order)&&p.order.length===doc.scenes.length&&new Set(p.order).size===p.order.length&&p.order.every(x=>doc.scenes.some(s=>s.id===x)),'Order must contain every scene exactly once');doc.scenes=p.order.map(x=>scene(doc,x));break;}
 case 'scene.archive':{closed(p,['sceneId','archived'],['sceneId','archived']);need(typeof p.archived==='boolean','Archive must be boolean');scene(doc,p.sceneId).archived=p.archived;break;}
 case 'object.add':{closed(p,['sceneId','object'],['sceneId','object']);const s=scene(doc,p.sceneId);need(!s.objects.some(o=>o.id===p.object.id),'Object id already exists','Conflict');s.objects.push(clone(p.object));break;}
 case 'object.update':{closed(p,['sceneId','objectId','changes'],['sceneId','objectId','changes']);closed(p.changes,['name','x','y','width','height','rotation','opacity','fill','text','fontSize','weight']);Object.assign(subject(doc,p.sceneId,p.objectId),clone(p.changes));break;}
 case 'object.archive':closed(p,['sceneId','objectId','archived'],['sceneId','objectId','archived']);need(typeof p.archived==='boolean','Archive must be boolean');subject(doc,p.sceneId,p.objectId).archived=p.archived;break;
 case 'keyframe.set':{closed(p,['sceneId','objectId','keyframe'],['sceneId','objectId','keyframe']);const o=subject(doc,p.sceneId,p.objectId);const key=p.keyframe;o.keyframes=o.keyframes.filter(k=>!(k.frame===key.frame&&k.property===key.property));o.keyframes.push(clone(key));o.keyframes.sort((a,b)=>a.frame-b.frame||a.property.localeCompare(b.property));break;}
 case 'keyframe.remove':{closed(p,['sceneId','objectId','frame','property'],['sceneId','objectId','frame','property']);const o=subject(doc,p.sceneId,p.objectId);o.keyframes=o.keyframes.filter(k=>!(k.frame===p.frame&&k.property===p.property));break;}
 case 'caption.set':{closed(p,['caption'],['caption']);const i=doc.captions.findIndex(c=>c.id===p.caption.id);if(i<0)doc.captions.push(clone(p.caption));else doc.captions[i]=clone(p.caption);break;}
 case 'caption.remove':closed(p,['captionId'],['captionId']);doc.captions=doc.captions.filter(c=>c.id!==p.captionId);break;
 case 'delivery.profile':{closed(p,['id','name','width','height','captions','language'],['id','name','width','height','captions','language']);id(p.id);str(p.name,80);integer(p.width,240,7680);integer(p.height,240,7680);need(typeof p.captions==='boolean','Invalid captions flag');str(p.language,20);const i=doc.deliveries.findIndex(x=>x.id===p.id);if(i<0)doc.deliveries.push(clone(p));else doc.deliveries[i]=clone(p);break;}
 }
 return doc;
}
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Three-way structured merge; incompatible edits are never silently selected. */
export function merge3(base,left,right,path='',conflicts=[],resolutions={}){
 if(eq(left,right))return clone(left);if(eq(base,left))return clone(right);if(eq(base,right))return clone(left);
 if([base,left,right].every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const out={};for(const k of new Set([...Object.keys(base),...Object.keys(left),...Object.keys(right)])){const v=merge3(base[k],left[k],right[k],`${path}/${k}`,conflicts,resolutions);if(v!==undefined)out[k]=v;}return out;}
 if([base,left,right].every(x=>Array.isArray(x)&&x.every(v=>v&&typeof v==='object'&&typeof v.id==='string'))){
 const maps=[base,left,right].map(a=>new Map(a.map(x=>[x.id,x])));let order=merge3(base.map(x=>x.id),left.map(x=>x.id),right.map(x=>x.id),path+'/$order',conflicts,resolutions);
 order=[...new Set([...order,...left.map(x=>x.id),...right.map(x=>x.id)])];return order.map(key=>merge3(...maps.map(m=>m.get(key)),`${path}/${key}`,conflicts,resolutions)).filter(x=>x!==undefined);
 }
 if(resolutions[path]==='left')return clone(left);if(resolutions[path]==='right')return clone(right);
 conflicts.push({path,base:base??null,left:left??null,right:right??null});return clone(left);
}
export function diff(a,b,path=''){
 if(eq(a,b))return [];if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],`${path}/${k}`));
 if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(v=>v&&typeof v==='object'&&typeof v.id==='string')){const am=new Map(a.map(x=>[x.id,x])),bm=new Map(b.map(x=>[x.id,x]));const order=eq([...am.keys()],[...bm.keys()])?[]:[{path:path+'/$order',before:[...am.keys()],after:[...bm.keys()]}];return [...order,...new Set([...am.keys(),...bm.keys()])].flatMap(x=>typeof x==='object'?[x]:diff(am.get(x),bm.get(x),`${path}/${x}`));}
 return [{path,before:a??null,after:b??null}];
}
