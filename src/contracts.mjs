import {NativeError, requireCondition as need, object, integer, text, validateValue} from '../vendor/semwright-native-sdk/index.mjs';
export {NativeError, need, object, integer, text, validateValue};
export const APP_ID = 'sequencewright';
export const VERSION = '0.1.0';
export const NAMESPACE = `driver.${APP_ID}.`;
export const OPERATIONS = Object.freeze([
 'document.edit','scene.add','scene.update','scene.reorder','scene.archive','object.add','object.update','object.archive',
 'keyframe.set','keyframe.remove','caption.set','caption.remove','brief.update','lock.set','lock.release',
 'proposal.create','proposal.apply','proposal.reject','branch.fork','branch.merge','history.restore',
 'review.add','review.resolve','asset.attach','delivery.profile','project.create','project.import'
]);
export const MUTATIONS = Object.freeze(OPERATIONS.map(x=>NAMESPACE+x));
export const READS = Object.freeze(['document.read','history.list','branch.list','branch.compare','proposal.list','review.list','project.list','document.export','context.read','capabilities.read'].map(x=>NAMESPACE+x));
export const RENDERERS = ['motion_canvas','blender','manim','mlt'];
export function id(value){const s=text(value,96);need(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s),'Invalid stable identifier');return s;}
export function str(value,max=12000){need(typeof value==='string' && value.length<=max && !/[\u0000\u0008]/u.test(value),'Text exceeds allowed size or contains invalid controls');return value;}
export function color(value){need(typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value),'Use a six-digit hex color');return value;}
export function closed(value,keys,required=[]){return object(value,keys,required);}
export function rational(num,den){let n=BigInt(num),d=BigInt(den);need(d>0n,'Positive rational denominator required');const g=(a,b)=>b?g(b,a%b):a;const k=g(n<0n?-n:n,d);return {num:String(n/k),den:String(d/k)};}
export function validateTime(t){closed(t,['num','den'],['num','den']);need(/^(0|-?[1-9][0-9]*)$/.test(t.num)&&/^[1-9][0-9]*$/.test(t.den),'Canonical rational strings required');const q=rational(t.num,t.den);need(q.num===t.num&&q.den===t.den,'Rational must be reduced');need(BigInt(t.num)>=0n&&BigInt(t.num)<=9223372036854775807n&&BigInt(t.den)<=9223372036854775807n,'Time outside canonical i64 range');return t;}
export function validateObject(o){
 closed(o,['id','kind','name','x','y','width','height','rotation','opacity','fill','text','fontSize','weight','assetId','keyframes','archived'],['id','kind','name','x','y','width','height','rotation','opacity','fill','text','fontSize','weight','keyframes','archived']);
 id(o.id);need(['text','rectangle','circle','image','video','audio','line'].includes(o.kind),'Unknown object kind');str(o.name,120);str(o.text,8000);color(o.fill);
 for(const k of ['x','y'])integer(o[k],-16384,16384);for(const k of ['width','height'])integer(o[k],1,16384);
 integer(o.rotation,-3600,3600);integer(o.opacity,0,1000);integer(o.fontSize,8,512);integer(o.weight,100,900);need(typeof o.archived==='boolean','Invalid archive flag');
 need(Array.isArray(o.keyframes)&&o.keyframes.length<=128,'Keyframe budget');let keys=new Set();for(const k of o.keyframes){closed(k,['frame','property','value','easing'],['frame','property','value','easing']);integer(k.frame,0,2160000);need(['x','y','rotation','opacity','width','height'].includes(k.property),'Keyframe property unsupported');integer(k.value,-16384,16384);need(['linear','hold','ease-in-out'].includes(k.easing),'Invalid easing');need(!keys.has(`${k.frame}:${k.property}`),'Duplicate keyframe');keys.add(`${k.frame}:${k.property}`);}
 if(o.assetId!==undefined)id(o.assetId);
 return o;
}
export function validateDocument(doc){
 validateValue(doc);closed(doc,['schema','id','title','description','profile','brief','scenes','assets','captions','locks','proposals','reviews','deliveries'],['schema','id','title','description','profile','brief','scenes','assets','captions','locks','proposals','reviews','deliveries']);
 need(doc.schema==='sequencewright/document/1','Unsupported document version');id(doc.id);str(doc.title,120);str(doc.description,2000);
 const p=closed(doc.profile,['width','height','fps'],['width','height','fps']);integer(p.width,240,7680);integer(p.height,240,7680);closed(p.fps,['num','den'],['num','den']);integer(p.fps.num,1,1000000);integer(p.fps.den,1,100000);need(p.fps.num/p.fps.den<=240,'Frame rate budget');need(rational(p.fps.num,p.fps.den).num===String(p.fps.num),'Frame rate must be reduced');
 closed(doc.brief,['audience','objective','promise','tone','constraints','references'],['audience','objective','promise','tone','constraints','references']);for(const v of Object.values(doc.brief))str(v,6000);
 need(Array.isArray(doc.scenes)&&doc.scenes.length>0&&doc.scenes.length<=60,'Scene count must be 1–60 (canonical solver span budget)');const ids=new Set();let duration=0;
 for(const s of doc.scenes){closed(s,['id','name','role','duration','renderer','background','narration','claimStatus','objects','archived'],['id','name','role','duration','renderer','background','narration','claimStatus','objects','archived']);id(s.id);need(!ids.has(s.id),'Duplicate scene identifier');ids.add(s.id);str(s.name,120);need(['hook','problem','mechanism','evidence','comparison','reveal','payoff','cta'].includes(s.role),'Invalid narrative role');integer(s.duration,1,216000);duration+=s.archived?0:s.duration;need(RENDERERS.includes(s.renderer),'Unknown renderer');color(s.background);str(s.narration,8000);need(['unreviewed','supported','needs-evidence'].includes(s.claimStatus),'Invalid claim state');need(typeof s.archived==='boolean','Invalid archive flag');need(Array.isArray(s.objects)&&s.objects.length<=100,'Object budget');let seen=new Set();for(const o of s.objects){validateObject(o);need(!seen.has(o.id),'Duplicate object identifier');seen.add(o.id);for(const k of o.keyframes)need(k.frame<s.duration,'Keyframe outside half-open scene range');}}
 need(doc.scenes.some(s=>!s.archived)&&duration<=2160000,'No active scenes or total duration limit exceeded');
 need(Array.isArray(doc.assets)&&doc.assets.length<=200,'Asset budget');let assets=new Set();for(const a of doc.assets){closed(a,['id','name','sha256','mime','bytes','license','provenance'],['id','name','sha256','mime','bytes','license','provenance']);id(a.id);need(!assets.has(a.id),'Duplicate asset');assets.add(a.id);need(/^[0-9a-f]{64}$/.test(a.sha256),'Invalid asset digest');integer(a.bytes,1,16*1024*1024);str(a.name,240);str(a.mime,120);str(a.license,200);str(a.provenance,2000);}
 for(const s of doc.scenes)for(const o of s.objects)if(['image','video','audio'].includes(o.kind))need(assets.has(o.assetId),'Media object references missing asset');
 need(Array.isArray(doc.captions)&&doc.captions.length<=500,'Caption budget');const capIds=new Set();for(const c of doc.captions){closed(c,['id','start','end','text','language'],['id','start','end','text','language']);id(c.id);need(!capIds.has(c.id),'Duplicate caption');capIds.add(c.id);integer(c.start,0,duration-1);integer(c.end,c.start+1,duration);str(c.text,2000);str(c.language,20);}
 need(Array.isArray(doc.locks)&&doc.locks.length<=200,'Lock budget');const scopes=new Set();for(const l of doc.locks){closed(l,['scope','owner','reason'],['scope','owner','reason']);str(l.scope,200);id(l.owner);str(l.reason,240);need(!scopes.has(l.scope),'Duplicate lock');scopes.add(l.scope);need(l.scope==='project'||ids.has(l.scope)||doc.scenes.some(s=>s.objects.some(o=>o.id===l.scope)),'Unknown lock scope');}
 need(Array.isArray(doc.proposals)&&doc.proposals.length<=30,'Proposal budget');need(Array.isArray(doc.reviews)&&doc.reviews.length<=300,'Review budget');need(Array.isArray(doc.deliveries)&&doc.deliveries.length<=12,'Delivery budget');
 need(Buffer.byteLength(JSON.stringify(doc))<=175000,'Document exceeds bounded native response budget','ResourceExhausted');return doc;
}
export function operationSchema(name){return {name,version:VERSION,input_schema:{type:'object',additionalProperties:false,required:['ref','request','parameters'],properties:{ref:{type:'string'},request:{type:'object',additionalProperties:false,required:['resource','epoch','key','request_sha256'],properties:{resource:{type:'string'},epoch:{type:'integer',minimum:0},key:{type:'string',maxLength:128},request_sha256:{type:'string',pattern:'^[0-9a-f]{64}$'}}},parameters:{type:'object'}}}};}
