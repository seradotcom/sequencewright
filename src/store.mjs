import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {NativeError,requireCondition as need,version,sameVersion,requestIdentity,exactRequestDigest,checkCancelled,observation} from '../vendor/semwright-native-sdk/index.mjs';
import {closed,id,str,integer,validateDocument,validateValue,NAMESPACE,OPERATIONS,MUTATIONS,READS} from './contracts.mjs';
import {clone,createDocument,demoDocument,uid,applyEdit,EDITS,assertUnlocked,merge3,diff,duration} from './model.mjs';
import {toFilm,toVtt,toSrt,technicalFindings} from './projection.mjs';
const json=JSON.stringify;
const parse=JSON.parse;
const hash=x=>createHash('sha256').update(typeof x==='string'||ArrayBuffer.isView(x)?x:json(x)).digest('hex');
const emptyWorkspace=()=>({schema:'sequencewright/workspace/1',title:'Sequencewright',projects:[]});
export function requestDigest(operation,expected,key,parameters){return exactRequestDigest('sequencewright/request/1',{operation,expected,epoch:1,key,parameters});}
export function envelope(operation,expected,parameters,key=randomUUID()){return {ref:expected.resource,request:{resource:expected.resource,epoch:1,key,request_sha256:requestDigest(operation,expected,key,parameters)},parameters};}
export class Store {
 constructor(root,{readOnly=false,actor='local-editor',seed=false}={}){
  this.actor=actor;this.readOnly=readOnly;this.root=resolve(root);
  if(!readOnly)mkdirSync(this.root,{recursive:true,mode:0o700});
  need(!lstatSync(this.root).isSymbolicLink(),'Data root may not be a symlink','SandboxDenied');this.root=realpathSync(this.root);
  const file=join(this.root,'sequencewright.db');try{need(!lstatSync(file).isSymbolicLink(),'Database may not be a symlink','SandboxDenied');}catch(e){if(e.code!=='ENOENT')throw e;}
  this.db=new DatabaseSync(file,{readOnly,allowExtension:false});const schema=this.db.prepare('PRAGMA user_version').get().user_version;if(schema>1){this.db.close();throw new NativeError('Unsupported','Database schema is newer than this application');}this.db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
  if(!readOnly){this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS resources(resource TEXT PRIMARY KEY,generation TEXT NOT NULL,revision TEXT NOT NULL,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,resource TEXT NOT NULL,version TEXT NOT NULL,state TEXT NOT NULL,parents TEXT NOT NULL,operation TEXT NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS revisions_resource ON revisions(resource,created);
   CREATE TABLE IF NOT EXISTS requests(resource TEXT NOT NULL,epoch INTEGER NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(resource,epoch,key));
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,resource TEXT NOT NULL,revision TEXT NOT NULL,operation TEXT NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS blobs(sha256 TEXT PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS production_receipts(id TEXT PRIMARY KEY,resource TEXT NOT NULL,revision TEXT NOT NULL,input_digest TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);
   PRAGMA user_version=1;`);
   this.db.exec('BEGIN IMMEDIATE');try{
    if(!this.db.prepare('SELECT 1 FROM resources WHERE resource=?').get('workspace'))this.insertResource('workspace',emptyWorkspace());
    if(seed&&this.db.prepare('SELECT count(*) AS n FROM resources').get().n===1){const ws=emptyWorkspace();for(const kind of ['product','lesson','brand']){const d=demoDocument(kind);const resource=d.id+'@main';this.insertResource(resource,d);ws.projects.push({id:d.id,title:d.title,resource});}this.writeRevision('workspace',ws,[],'workspace.seed');}
    this.db.exec('COMMIT');
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
 }
 close(){this.db.close();}
 insertResource(resource,state,parents=[]){const v={resource,generation:randomUUID(),revision:randomUUID()};this.db.prepare('INSERT INTO resources VALUES(?,?,?,?)').run(resource,v.generation,v.revision,json(state));this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?)').run(v.revision,resource,json(v),json(state),json(parents),'resource.create',this.actor,new Date().toISOString(),hash(state));return v;}
 writeRevision(resource,state,parents,operation){const current=this.current(resource);const v={...current.version,revision:randomUUID()};this.db.prepare('UPDATE resources SET revision=?,state=? WHERE resource=?').run(v.revision,json(state),resource);this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?)').run(v.revision,resource,json(v),json(state),json(parents),operation,this.actor,new Date().toISOString(),hash(state));this.db.prepare('INSERT INTO events(resource,revision,operation,actor,created) VALUES(?,?,?,?,?)').run(resource,v.revision,operation,this.actor,new Date().toISOString());return v;}
 current(resource){const r=this.db.prepare('SELECT * FROM resources WHERE resource=?').get(resource);need(r,'Project or branch not found','NotFound');return {version:{resource:r.resource,generation:r.generation,revision:r.revision},document:parse(r.state)};}
 revision(revisionId,projectId){const r=this.db.prepare('SELECT * FROM revisions WHERE id=?').get(revisionId);need(r,'Revision not found','NotFound');const document=parse(r.state);if(projectId)need(document.id===projectId,'Revision belongs to a different project','PermissionDenied');return {...r,version:parse(r.version),document,parents:parse(r.parents)};}
 history(resource,limit=100,offset=0){this.current(resource);return this.db.prepare('SELECT id,resource,version,parents,operation,actor,created,digest FROM revisions WHERE resource=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(resource,limit,offset).map(r=>({...r,version:parse(r.version),parents:parse(r.parents)}));}
 branches(resource){const {document}=this.current(resource);return this.db.prepare('SELECT resource,generation,revision,state FROM resources WHERE resource LIKE ? ESCAPE \'\\\'').all(document.id.replaceAll('_','\\_')+'@%').map(r=>({version:{resource:r.resource,generation:r.generation,revision:r.revision},name:r.resource.split('@')[1]}));}
 compare(resource,other){const left=this.current(resource),right=this.current(other);need(left.document.id===right.document.id,'Different projects cannot be merged');const ancestors=new Set();const walk=[left.version.revision];while(walk.length&&ancestors.size<20000){const k=walk.shift();if(ancestors.has(k))continue;ancestors.add(k);walk.push(...this.revision(k).parents);}const pending=[right.version.revision],seen=new Set();let baseId;while(pending.length&&seen.size<20000){const k=pending.shift();if(seen.has(k))continue;seen.add(k);if(ancestors.has(k)){baseId=k;break;}pending.push(...this.revision(k).parents);}need(baseId,'No common revision found within history budget','Conflict');const base=this.revision(baseId,left.document.id).document;const conflicts=[];const merged=merge3(base,left.document,right.document,'',conflicts);return {base:baseId,left:left.version,right:right.version,conflicts,changes:diff(left.document,right.document),merged};}
 lookup(identity){requestIdentity(identity);this.current(identity.resource);const r=this.db.prepare('SELECT digest,result FROM requests WHERE resource=? AND epoch=? AND key=?').get(identity.resource,identity.epoch,identity.key);if(r){need(r.digest===identity.request_sha256,'Request key reused with different content','Conflict');return {state:'recorded',identity,result:parse(r.result)};}if(identity.epoch<1)return {state:'retention_expired',identity,current_epoch:1};return {state:'outcome_unknown',identity};}
 mutate(fullOperation,raw,context){
  need(!this.readOnly,'Read-only application instance','PermissionDenied');need(MUTATIONS.includes(fullOperation),'Unknown typed operation','Unsupported');checkCancelled(context);
  const args=closed(raw,['ref','request','parameters'],['ref','request','parameters']);const identity=requestIdentity(args.request);need(context.expected,'Expected resource version required','StaleReference');const expected=version(context.expected);
  str(args.ref,128);need(identity.resource===expected.resource,'Target binding differs','Conflict');need(identity.epoch===1,'Unsupported request epoch','Conflict');
  validateValue(args.parameters);need(identity.request_sha256===requestDigest(fullOperation,expected,identity.key,args.parameters),'Request digest does not bind the operation and base','Conflict');
  const operation=fullOperation.slice(NAMESPACE.length);let commitAttempted=false;this.db.exec('BEGIN IMMEDIATE');
  try{
   const before=this.current(identity.resource);const recorded=this.lookup(identity);if(recorded.state==='recorded'){this.db.exec('ROLLBACK');return {...recorded.result,replayed:true,historical_only:true};}
   need(sameVersion(expected,before.version),'This revision changed. Reload and review the conflict before applying.','StaleReference');checkCancelled(context);
   let doc=clone(before.document);let metadata={};let parents=[before.version.revision];const p=args.parameters;
   if(EDITS.includes(operation)){need(identity.resource!=='workspace','Select a project','InvalidArgument');applyEdit(doc,operation,p,this.actor);}
   else switch(operation){
    case 'project.create':case 'project.import':{
     need(identity.resource==='workspace','Project creation targets the workspace resource');
     closed(p,operation==='project.create'?['title','template']:['document','blobs'],operation==='project.create'?['title']:['document']);
     let d=operation==='project.create'?(p.template?demoDocument(p.template):createDocument(str(p.title,120))):clone(p.document);
     d.id=uid('project');if(operation==='project.create')d.title=str(p.title,120);d.proposals=[];d.locks=[];
     validateDocument(d);need(doc.projects.length<100,'Workspace project budget','ResourceExhausted');
     if(operation==='project.import'){need(Array.isArray(p.blobs??[])&&(p.blobs??[]).length<=200,'Blob import budget');for(const b of p.blobs??[])this.putBlob(b);for(const a of d.assets)need(this.db.prepare('SELECT 1 FROM blobs WHERE sha256=?').get(a.sha256),'Archive references missing asset bytes');}
     const resource=d.id+'@main';const v=this.insertResource(resource,d);doc.projects.push({id:d.id,title:d.title,resource});metadata={created:v};break;
    }
    case 'lock.set':{closed(p,['scope','reason'],['scope','reason']);assertUnlocked(doc,[p.scope],this.actor);need(!doc.locks.some(l=>l.scope===p.scope),'Scope already locked','Conflict');doc.locks.push({scope:str(p.scope,200),owner:this.actor,reason:str(p.reason,240)});break;}
    case 'lock.release':{closed(p,['scope'],['scope']);const l=doc.locks.find(x=>x.scope===p.scope);need(l,'Lock not found','NotFound');need(l.owner===this.actor,'Only the owning application role can release this lock','PermissionDenied');doc.locks=doc.locks.filter(x=>x.scope!==p.scope);break;}
    case 'proposal.create':{
     closed(p,['id','title','rationale','scope','changes','provider','constraints'],['id','title','rationale','scope','changes','provider','constraints']);id(p.id);need(!doc.proposals.some(x=>x.id===p.id),'Proposal id already exists','Conflict');str(p.title,120);str(p.rationale,2400);str(p.scope,200);str(p.provider,120);need(Array.isArray(p.changes)&&p.changes.length>0&&p.changes.length<=32,'Proposal must contain 1–32 typed changes');need(Array.isArray(p.constraints)&&p.constraints.length<=20,'Constraint budget');p.constraints.forEach(x=>str(x,240));
     const candidate=clone(doc);for(const c of p.changes){closed(c,['operation','parameters'],['operation','parameters']);need(p.scope==='project'||c.parameters.sceneId===p.scope||c.parameters.objectId===p.scope,'Proposal edit exceeds declared selection scope');applyEdit(candidate,c.operation,c.parameters,this.actor);}validateDocument(candidate);
     doc.proposals.push({...clone(p),base:before.version.revision,baseDigest:hash(creativeContent(before.document)),status:'pending',author:this.actor,created:new Date().toISOString()});break;
    }
    case 'proposal.apply':case 'proposal.reject':{
     closed(p,['proposalId'],['proposalId']);const proposal=doc.proposals.find(x=>x.id===p.proposalId);need(proposal&&proposal.status==='pending','Proposal is not pending','Conflict');
     if(operation==='proposal.apply'){need(proposal.baseDigest===hash(creativeContent(doc)),'Proposal base changed; create a rebased proposal after reviewing the differences','StaleReference');for(const c of proposal.changes)applyEdit(doc,c.operation,c.parameters,this.actor);}
     proposal.status=operation==='proposal.apply'?'applied':'rejected';break;
    }
    case 'branch.fork':{closed(p,['name'],['name']);id(p.name);need(p.name!=='main','Reserved branch name');assertUnlocked(doc,doc.locks.map(l=>l.scope),this.actor);const resource=doc.id+'@'+p.name;need(!this.db.prepare('SELECT 1 FROM resources WHERE resource=?').get(resource),'Branch exists','Conflict');metadata={created:this.insertResource(resource,clone(doc),parents)};break;}
    case 'branch.merge':{
     closed(p,['source','sourceVersion','resolutions'],['source','sourceVersion','resolutions']);need(p.source!==args.ref,'Cannot merge a branch into itself');const compare=this.compare(identity.resource,p.source);need(sameVersion(version(p.sourceVersion),compare.right),'Source branch changed before merge','StaleReference');closed(p.resolutions);for(const v of Object.values(p.resolutions))need(['left','right'].includes(v),'Merge choice must be left or right');const conflicts=[];doc=merge3(this.revision(compare.base,doc.id).document,doc,this.current(p.source).document,'',conflicts,p.resolutions);need(!conflicts.length,`Unresolved merge conflicts: ${conflicts.map(x=>x.path).join(', ')}`,'Conflict');assertUnlocked(before.document,before.document.locks.map(l=>l.scope),this.actor);doc.locks=clone(before.document.locks);parents.push(compare.right.revision);break;
    }
    case 'history.restore':{closed(p,['revision'],['revision']);assertUnlocked(doc,doc.locks.map(l=>l.scope),this.actor);const old=this.revision(p.revision,doc.id);doc=clone(old.document);doc.locks=clone(before.document.locks);metadata={restoredFrom:p.revision};break;}
    case 'review.add':{closed(p,['id','sceneId','objectId','frame','text','category'],['id','sceneId','objectId','frame','text','category']);id(p.id);need(!doc.reviews.some(x=>x.id===p.id),'Review id exists','Conflict');need(doc.scenes.some(s=>s.id===p.sceneId),'Review scene missing');if(p.objectId)need(doc.scenes.some(s=>s.id===p.sceneId&&s.objects.some(o=>o.id===p.objectId)),'Review object missing');integer(p.frame,0,duration(doc)-1);need(['comment','creative-advice','technical'].includes(p.category),'Review category invalid');str(p.text,4000);doc.reviews.push({...clone(p),revision:before.version.revision,author:this.actor,status:'open',created:new Date().toISOString()});break;}
    case 'review.resolve':{closed(p,['reviewId','resolved'],['reviewId','resolved']);need(typeof p.resolved==='boolean','Resolved must be boolean');const r=doc.reviews.find(x=>x.id===p.reviewId);need(r,'Review not found','NotFound');r.status=p.resolved?'resolved':'open';break;}
    case 'asset.attach':{closed(p,['asset','blob'],['asset','blob']);assertUnlocked(doc,doc.locks.map(l=>l.scope),this.actor);const digest=this.putBlob(p.blob);need(p.asset.sha256===digest&&p.asset.bytes===Buffer.from(p.blob.base64,'base64').length&&p.asset.mime===p.blob.mime,'Asset and bytes differ','Conflict');need(!doc.assets.some(a=>a.id===p.asset.id),'Asset id exists','Conflict');doc.assets.push(clone(p.asset));break;}
    default:throw new NativeError('Unsupported','Operation not implemented');
   }
   if(identity.resource!=='workspace')validateDocument(doc);else validateValue(doc);
   checkCancelled(context);const after=this.writeRevision(identity.resource,doc,parents,operation);
   const result={version:after,previous:before.version,documentDigest:hash(doc),metadata,replayed:false,historical_only:false};validateValue(result);
   this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(identity.resource,identity.epoch,identity.key,identity.request_sha256,json(result));
   commitAttempted=true;this.db.exec('COMMIT');return result;
  }catch(e){try{this.db.exec('ROLLBACK');}catch{}if(commitAttempted)throw new NativeError('BackendFailed','Commit outcome unknown; recover using the exact request identity',false);throw e;}
 }
 putBlob(b){closed(b,['base64','mime'],['base64','mime']);need(typeof b.base64==='string'&&b.base64.length<=200000,'Inline media exceeds native frame budget');need(['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg','video/mp4'].includes(b.mime),'Unsupported media type');const bytes=Buffer.from(b.base64,'base64');need(bytes.length>0&&bytes.toString('base64')===b.base64,'Noncanonical base64');need(validMagic(bytes,b.mime),'Media content does not match declared type');const digest=hash(bytes);this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(digest,b.mime,bytes);return digest;}
 blob(digest,resource){need(/^[0-9a-f]{64}$/.test(digest),'Invalid blob digest');const {document}=this.current(resource);need(document.assets.some(a=>a.sha256===digest),'Asset is not in this project','PermissionDenied');const r=this.db.prepare('SELECT * FROM blobs WHERE sha256=?').get(digest);need(r,'Asset bytes are missing','NotFound');need(hash(r.data)===digest,'Asset failed integrity validation','Conflict');return r;}
 export(resource){const current=this.current(resource);const blobs=current.document.assets.map(a=>{const b=this.blob(a.sha256,resource);return {base64:Buffer.from(b.data).toString('base64'),mime:b.mime};});const value={schema:'sequencewright/archive/1',version:current.version,document:current.document,blobs};validateValue(value);return value;}
 observe(q,ctx){checkCancelled(ctx);const c=this.current(q.resource);let items;switch(q.scope){case 'document':items=[c.document];break;case 'scenes':items=c.document.scenes??[];break;case 'assets':items=c.document.assets??[];break;case 'proposals':items=c.document.proposals??[];break;case 'reviews':items=c.document.reviews??[];break;case 'projects':need(q.resource==='workspace','Projects scope requires workspace');items=c.document.projects;break;case 'history':items=this.history(q.resource,10000);break;default:throw new NativeError('Unsupported','Unknown observation scope');}
  if(q.cursor)need(sameVersion(q.cursor.version,c.version),'Observation base changed','StaleReference');const offset=q.cursor?Number(q.cursor.token):0;need(Number.isSafeInteger(offset)&&offset>=0&&String(offset)===(q.cursor?.token??'0'),'Invalid continuation');const selected=items.slice(offset,offset+q.limit);const complete=offset+selected.length>=items.length;return observation({version:c.version,scope:q.scope,items:selected,next:complete?null:{version:c.version,scope:q.scope,token:String(offset+selected.length)},complete},q);
 }
 read(operation,p,context){checkCancelled(context);closed(p);const resource=p.resource??context.expected?.resource??'workspace';const current=this.current(resource);
  if(context.expected)need(sameVersion(current.version,context.expected),'Read revision changed','StaleReference');
  switch(operation){
   case 'document.read':closed(p,['resource','revision']);if(p.revision){const r=this.revision(p.revision,current.document.id);return {version:r.version,document:r.document};}return current;
   case 'history.list':closed(p,['resource','limit','offset']);return {items:this.history(resource,integer(p.limit??100,1,100),integer(p.offset??0,0,100000))};
   case 'branch.list':closed(p,['resource']);return {items:this.branches(resource)};
   case 'branch.compare':closed(p,['resource','other'],['other']);return this.compare(resource,p.other);
   case 'project.list':closed(p,['resource']);return {version:this.current('workspace').version,items:this.current('workspace').document.projects};
   case 'proposal.list':closed(p,['resource']);return {version:current.version,items:current.document.proposals};
   case 'review.list':closed(p,['resource']);return {version:current.version,items:current.document.reviews,technicalFindings:technicalFindings(current.document)};
   case 'document.export':closed(p,['resource','format']);if(p.format==='film')return {version:current.version,film:toFilm(current.document),validation:'REQUIRES_CANONICAL_COMPILER'};if(p.format==='vtt'||p.format==='srt')return {text:p.format==='vtt'?toVtt(current.document):toSrt(current.document)};return this.export(resource);
   case 'context.read':{closed(p,['resource','sceneId','objectId']);need(resource!=='workspace','Select a project');let scenes=current.document.scenes;if(p.sceneId)scenes=scenes.filter(s=>s.id===p.sceneId);if(p.objectId)scenes=scenes.map(s=>({...s,objects:s.objects.filter(o=>o.id===p.objectId)}));return {version:current.version,brief:current.document.brief,profile:current.document.profile,scenes,locks:current.document.locks,disclosure:{destination:'caller only',automaticCloudUpload:false,containsAudio:false},instruction:'Propose typed edits. Do not execute source strings.'};}
   case 'capabilities.read':closed(p,['resource']);return capabilities();
   default:throw new NativeError('Unsupported','Unknown read operation');
  }
 }
 application(){return {observe:(q,c)=>this.observe(q,c),lookup:(i,c)=>{checkCancelled(c);return this.lookup(i);},operations:new Map([...MUTATIONS.map(op=>[op,(p,c)=>this.mutate(op,p,c)]),...READS.map(op=>[op,(p,c)=>{const {ref,...parameters}=p;return this.read(op.slice(NAMESPACE.length),parameters,c);}])]),close:()=>this.close()};}
}
function creativeContent(doc){const d=clone(doc);d.proposals=[];d.reviews=[];return d;}
function validMagic(b,m){switch(m){case 'image/png':return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));case 'image/jpeg':return b[0]===255&&b[1]===216&&b[2]===255;case 'image/webp':return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';case 'audio/wav':return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE';case 'audio/mpeg':return b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224);case 'video/mp4':return b.toString('ascii',4,8)==='ftyp';default:return false;}}
export function capabilities(){return {app:'sequencewright',schema:1,authority:'application-owned; not a Broker',sdk:{name:'@semwright/native-sdk',version:'0.9.0-dev.1',revision:'4d291de26724810017ce7b6d185326514cb79fa6'},operations:[...MUTATIONS,...READS],preview:{mode:'design-approximation',native:false},renderers:['motion_canvas','mlt','blender','manim'].map(id=>({id,status:'NOT_CONNECTED',reason:'A verified Semwright Host/runtime session is required'})),graph:{state:'UNKNOWN',source:'Canonical Graph not connected'},effects:{state:'NOT_RUN',coverage:'none'},automaticCloudUpload:false};}
