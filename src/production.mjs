/** A client of the canonical Semwright Broker. Never a replacement Host, scheduler, renderer or verifier. */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,dirname,join} from 'node:path';
import {NativeError,sameVersion} from '../vendor/semwright-native-sdk/index.mjs';
import {closed,integer,need,str} from './contracts.mjs';
import {duration} from './model.mjs';
import {toFilm} from './projection.mjs';
const COMMANDS=new Set(['doctor','composition.inspect','composition.plan','composition.apply','composition.verify','render.plan','render.start','render.status','render.cancel','render.result'].map(name=>'driver.motion-canvas.'+name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_OUTPUT=1048576;

function privatePath(path,{directory=false,socket=false}={}){
 need(typeof path==='string'&&isAbsolute(path),'Owner configuration requires absolute paths');
 const st=lstatSync(path);need(!st.isSymbolicLink(),'Connection paths must not be symlinks','PermissionDenied');
 need(socket?st.isSocket():directory?st.isDirectory():st.isFile(),'Connection path has the wrong type');
 need(typeof process.getuid==='function'&&st.uid===process.getuid()&&(st.mode&0o022)===0,'Connection paths must be owner-controlled','PermissionDenied');
 return realpathSync(path);
}
export function readConnection(path){
 const file=privatePath(path);need(lstatSync(file).size<16384,'Connection file is too large');
 const config=JSON.parse(readFileSync(file,'utf8'));
 closed(config,['schema','executable','executableSha256','socket','session','outputRoot','maxFrames','resource'],['schema','executable','executableSha256','socket','session','outputRoot','resource']);
 need(config.schema==='sequencewright/connection/1','Unknown connection schema');
 config.executable=privatePath(config.executable);config.socket=privatePath(config.socket,{socket:true});config.outputRoot=privatePath(config.outputRoot,{directory:true});
 privatePath(dirname(config.session),{directory:true});need(isAbsolute(config.session),'Session must be an absolute owner-selected path');
 need(/^[0-9a-f]{64}$/.test(config.executableSha256)&&sha(readFileSync(config.executable))===config.executableSha256,'Canonical CLI executable digest mismatch','PermissionDenied');
 config.maxFrames=integer(config.maxFrames??1800,1,18000);str(config.resource,160);
 return Object.freeze(config);
}

export class CanonicalConnection{
 constructor(config){this.config=config;this.identity=sha(JSON.stringify(config));}
 async execute(command,args,{mutation=false}={}){
  need(COMMANDS.has(command),'Not an enabled canonical production command','Unsupported');
  const c=this.config;privatePath(c.executable);need(sha(readFileSync(c.executable))===c.executableSha256,'Canonical CLI bytes changed','PermissionDenied');privatePath(c.socket,{socket:true});
  const encoded=JSON.stringify(args);need(Buffer.byteLength(encoded)<=220000,'Native command input exceeds the transport budget','ResourceExhausted');
  return new Promise((resolve,reject)=>{
   const child=spawn(c.executable,['--socket',c.socket,'--session-file',c.session,'--json','execute',command,'--args-json',encoded],{shell:false,stdio:['ignore','pipe','pipe'],env:{HOME:process.env.HOME??dirname(c.session),PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
   let output=[],size=0,stderrSize=0,ended=false;
   const fail=message=>{if(ended)return;ended=true;clearTimeout(timer);child.kill('SIGKILL');reject(new NativeError('BackendFailed',message,!mutation));};
   const timer=setTimeout(()=>fail('Canonical CLI deadline exceeded. Mutation outcome is unknown; do not automatically resubmit.'),45000);
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX_OUTPUT)fail('Canonical CLI output exceeded its response budget');else output.push(chunk);});
   child.stderr.on('data',chunk=>{stderrSize+=chunk.length;if(stderrSize>MAX_OUTPUT)fail('Canonical CLI diagnostic budget exceeded');});
   child.on('error',()=>fail('The owner-selected canonical CLI could not be started'));
   child.on('close',code=>{
    if(ended)return;ended=true;clearTimeout(timer);
    try{
     const value=JSON.parse(Buffer.concat(output).toString('utf8'));
     if(code!==0||value.ok!==true){const error=value.error??{};throw new NativeError(error.code??'BackendFailed',String(error.message??'Canonical command was not completed'),error.outcome_known??!mutation);}
     const provenance=value.execution?.provenance;
     need(provenance?.provider==='driver:motion-canvas'&&provenance.source==='driver'&&typeof provenance.descriptor_sha256==='string'&&provenance.provider_generation!==null&&provenance.provider_generation!==undefined,'Canonical provider provenance is missing','BackendFailed');
     resolve({data:value.data,execution:value.execution});
    }catch(error){reject(error instanceof NativeError?error:new NativeError('BackendFailed','Canonical CLI response could not be validated',!mutation));}
   });
  });
 }
}

/** Production rows are an application receipt journal, never an execution authority.
 * Native references are revalidated by the Broker on every call. Historical rows
 * remain historical if the application document or connection has changed.
 */
export class ProductionClient{
 constructor(store,connection){this.store=store;this.connection=connection;this.busy=false;}
 current(resource,expected){const current=this.store.current(resource);if(expected)need(sameVersion(current.version,expected),'Application changed; prepare production from its current revision','StaleReference');return current;}
 record(value){const payload={schema:'sequencewright/production-receipt/1',...value};const id=randomUUID();this.store.db.prepare('INSERT INTO production_receipts VALUES(?,?,?,?,?,?,?)'.replace('?,?,?,?,?,?,?','?,?,?,?,?,?')).run(id,payload.resource,payload.version.revision,payload.filmDigest??'unplanned',JSON.stringify(payload),new Date().toISOString());return {...payload,receiptId:id};}
 latest(resource){const row=this.store.db.prepare('SELECT id,payload FROM production_receipts WHERE resource=? ORDER BY rowid DESC LIMIT 1').get(resource);if(!row)return null;return {...JSON.parse(row.payload),receiptId:row.id};}
 info(resource){const receipt=this.latest(resource);const version=this.store.current(resource).version;return {configured:!!this.connection,renderer:'motion_canvas',resource,allowedResource:this.connection?.config.resource??null,maxFrames:this.connection?.config.maxFrames??null,receipt,sourceState:receipt?(sameVersion(version,receipt.version)?'CURRENT_APPLICATION_REVISION':'STALE_APPLICATION_REVISION'):'NO_RECEIPT',connectionState:receipt&&this.connection&&receipt.connection!==this.connection.identity?'CHANGED':'UNCHANGED',authority:'canonical Semwright Broker and Driver Host; local rows are historical hints',effects:'NOT_RUN',graph:'UNKNOWN'};}
 async call(operation,parameters,expected,key){
  const p=parameters??{};closed(p,['resource','frames'],['resource']);str(p.resource,160);
  const current=this.current(p.resource,expected);
  if(operation==='production.state')return this.info(p.resource);
  need(this.connection,'An explicit owner-provisioned Semwright connection is required','Unsupported');
  need(p.resource===this.connection.config.resource,'This renderer workspace is bound to another application resource','PermissionDenied');
  need(['production.inspect','production.plan','production.render','production.status','production.cancel','production.verify'].includes(operation),'Unknown production operation','Unsupported');
  if(operation==='production.inspect'){const observed=await this.connection.execute('driver.motion-canvas.composition.inspect',{});return {observed,...this.info(p.resource)};}
  const mutating=['production.plan','production.render','production.cancel'].includes(operation);
  if(mutating){need(expected,'Observe the application revision before requesting production');need(!this.busy,'A production transaction is in progress','Conflict');str(key,128);this.busy=true;}
  try{
   if(operation==='production.plan'){
    const prior=this.latest(p.resource);need(!prior?.jobRef||['succeeded','failed','cancelled'].includes(prior.nativeState),'Observe the terminal state of the previous native job before replacing this production plan','Conflict');
    const film=toFilm(current.document);need(film.assets.length===0,'Native media handoff is not connected for this profile; media-bearing projects are not silently rendered without their assets','Unsupported');
    const inspection=await this.connection.execute('driver.motion-canvas.composition.inspect',{});
    need(!inspection.data.low_level_project,'Refuse to overwrite a preexisting low-level renderer project','Conflict');
    need(!inspection.data.film||inspection.data.film.id===film.id,'Renderer workspace belongs to a different Film','Conflict');
    const base={resource:p.resource,version:current.version,connection:this.connection.identity,filmDigest:sha(JSON.stringify(film)),requestKey:key,stage:'PLANNING',nativeState:null,coverage:'none'};
    this.record(base);
    try{
     const plan=await this.connection.execute('driver.motion-canvas.composition.plan',{film,budget:{max_iterations:4,max_operations:128,max_findings:128,max_observations:16,max_elapsed_ms:120000}},{mutation:true});
     need(typeof plan.data.plan_ref==='string','Canonical planner did not return a native plan reference','BackendFailed');
     const frames=integer(p.frames??duration(current.document),1,this.connection.config.maxFrames);need(frames<=duration(current.document),'Requested native range exceeds the application sequence');
     this.record({...base,stage:'PLANNED',planRef:plan.data.plan_ref,frames,plan,coverage:'canonical planning only; no native render'});
    }catch(error){this.record({...base,stage:'PLAN_FAILED',error:{code:error.code??'BackendFailed',message:error.message}});throw error;}
    return this.info(p.resource);
   }
   const receipt=this.latest(p.resource);need(receipt&&receipt.connection===this.connection.identity,'No usable production receipt for this connection','StaleReference');
   if(operation==='production.render'){
    need(receipt.stage==='PLANNED'&&sameVersion(receipt.version,current.version),'Prepare a fresh plan before rendering','StaleReference');
    const starting={...receipt,stage:'APPLYING',requestKey:key};this.record(starting);
    try{
     this.current(p.resource,receipt.version);
     const applied=await this.connection.execute('driver.motion-canvas.composition.apply',{plan_ref:receipt.planRef,dry_run:false},{mutation:true});
     need(applied.data.applied===true&&applied.data.execution_status==='completed'&&typeof applied.data.fingerprint==='string','Native composition was not applied','BackendFailed');
     this.current(p.resource,receipt.version);
     const rendered=await this.connection.execute('driver.motion-canvas.render.start',{expected_fingerprint:applied.data.fingerprint,profile:{first_frame:0,end_frame_exclusive:receipt.frames,scale:'full',transparent:false,timeout_ms:120000}},{mutation:true});
     need(typeof rendered.data.job_ref==='string','Canonical renderer returned no native job reference','BackendFailed');
     this.record({...starting,stage:'RENDER_REQUESTED',fingerprint:applied.data.fingerprint,jobRef:rendered.data.job_ref,applied,rendered,nativeState:'unknown',coverage:'native job requested; no terminal result yet'});
    }catch(error){this.record({...starting,stage:'OUTCOME_REQUIRES_INSPECTION',error:{code:error.code??'BackendFailed',message:error.message}});throw error;}
    return this.info(p.resource);
   }
   need(typeof receipt.jobRef==='string','No native job is associated with this application revision','NotFound');
   if(operation==='production.cancel'){
    const cancelled=await this.connection.execute('driver.motion-canvas.render.cancel',{job_ref:receipt.jobRef},{mutation:true});
    this.record({...receipt,stage:'CANCEL_REQUESTED',requestKey:key,cancelled});return this.info(p.resource);
   }
   if(operation==='production.status'){
    const status=await this.connection.execute('driver.motion-canvas.render.status',{job_ref:receipt.jobRef});
    let result=null;if(status.data.state==='succeeded')result=await this.connection.execute('driver.motion-canvas.render.result',{job_ref:receipt.jobRef});
    this.record({...receipt,stage:'OBSERVED',nativeState:status.data.state,status,result:result??receipt.result,coverage:result?'canonical native render artifact metadata; verification not implied':'canonical native job observation'});return this.info(p.resource);
   }
   const verified=await this.connection.execute('driver.motion-canvas.composition.verify',{plan_ref:receipt.planRef,job_ref:receipt.jobRef});
   this.record({...receipt,stage:'VERIFIED',verified,coverage:'native composition measurement with explicit report coverage; not independent Effect Conformance'});
   return this.info(p.resource);
  }finally{if(mutating)this.busy=false;}
 }
 frame(resource,index){
  integer(index,0,18000);const receipt=this.latest(resource);need(receipt?.nativeState==='succeeded'&&receipt.result?.data?.artifact,'A terminal native artifact is required','NotFound');
  need(this.connection&&receipt.connection===this.connection.identity,'Renderer connection changed','StaleReference');
  const artifact=receipt.result.data.artifact;need(typeof artifact.directory==='string'&&!artifact.directory.includes('..')&&!isAbsolute(artifact.directory),'Invalid native artifact directory','BackendFailed');
  const root=realpathSync(this.connection.config.outputRoot),directory=realpathSync(join(root,artifact.directory));need(directory.startsWith(root+'/'),'Native artifact is outside the owner output root','PermissionDenied');
  const path=join(directory,'artifact-manifest.json');need(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink()&&lstatSync(path).size<MAX_OUTPUT,'Invalid native artifact manifest');
  const manifest=JSON.parse(readFileSync(path,'utf8'));
  return {manifest,receipt,index,directory};
 }
}
