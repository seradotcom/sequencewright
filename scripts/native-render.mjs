/** Explicit operator CLI. All planning, effects, rendering and verification stay in Semwright. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {Store} from '../src/store.mjs';
import {toFilm} from '../src/projection.mjs';
import {duration} from '../src/model.mjs';
import {CanonicalConnection,readConnection} from '../src/production.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function require(value,message){if(!value)throw new Error(message);}
function args(argv){
 const allowed=new Set(['connection','data','resource','output','typography','frames']);const out={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i]?.slice(2);require(argv[i]?.startsWith('--')&&allowed.has(key)&&typeof argv[i+1]==='string'&&!Object.hasOwn(out,key),'Use explicit unique --connection --data --resource --output --typography arguments');out[key]=argv[i+1];}
 for(const key of ['connection','data','resource','output','typography'])require(out[key],`Missing --${key}`);
 require(out.typography==='motion-pinned','This renderer requires explicit --typography motion-pinned; typography is never silently substituted');return out;
}
async function main(){
 const options=args(process.argv.slice(2));const config=readConnection(options.connection);require(config.resource===options.resource,'Owner connection is bound to a different application resource');
 const client=new CanonicalConnection(config);const store=new Store(options.data,{readOnly:true});
 const source=store.current(options.resource);const film=toFilm(source.document);
 require(film.assets.length===0,'This native profile has no verified media handoff yet; assets are not silently omitted');
 const originalFonts={font:film.editorial.font,monoFont:film.editorial.mono_font};
 // This is an explicit output-profile decision. It does not edit the application document.
 film.editorial.font={family:'Instrument Sans Variable',asset_digest:null,fallback:'deny',permitted_fallbacks:[]};
 film.editorial.mono_font={family:'IBM Plex Mono',asset_digest:null,fallback:'deny',permitted_fallbacks:[]};
 const frames=options.frames===undefined?duration(source.document):Number(options.frames);
 require(Number.isSafeInteger(frames)&&frames>0&&frames<=duration(source.document)&&frames<=config.maxFrames,'Frame range exceeds the source sequence or owner production budget');
 const output=resolve(options.output);require(!existsSync(output),'Use a new evidence directory; existing files are preserved');mkdirSync(output,{mode:0o700});
 const receipt={schema:'sequencewright/native-render/1',resource:options.resource,sourceVersion:source.version,sourceDocumentSha256:sha(JSON.stringify(source.document)),filmSha256:sha(JSON.stringify(film)),typography:{profile:'motion-pinned',source:originalFonts,output:{font:film.editorial.font,monoFont:film.editorial.mono_font},requiresCreativeReview:true},range:{firstFrame:0,endFrameExclusive:frames,fullSequence:frames===duration(source.document)},calls:[],render:'NOT_RUN',effects:'NOT_RUN',graph:'UNKNOWN'};
 writeFileSync(join(output,'film.json'),JSON.stringify(film),{flag:'wx'});
 const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(receipt,null,2));
 const call=async(name,parameters,mutation=false)=>{const started=performance.now();const value=await client.execute('driver.motion-canvas.'+name,parameters,{mutation});receipt.calls.push({command:'driver.motion-canvas.'+name,durationMs:Math.round(performance.now()-started),...value});save();return value.data;};
 let interrupted=false;const interrupt=()=>{interrupted=true;};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{
  const inspection=await call('composition.inspect',{});require(!inspection.low_level_project&&(!inspection.film||inspection.film.id===film.id),'Use an empty renderer workspace or one already bound to this Film');
  const planned=await call('composition.plan',{film,budget:{max_iterations:4,max_operations:128,max_findings:128,max_observations:16,max_elapsed_ms:120000}},true);require(typeof planned.plan_ref==='string','Canonical planner returned no plan reference');receipt.planRef=planned.plan_ref;save();
  require(store.current(options.resource).version.revision===source.version.revision,'Application changed before production apply; no automatic rebase');
  const applied=await call('composition.apply',{plan_ref:planned.plan_ref,dry_run:false},true);require(applied.applied&&applied.execution_status==='completed','Canonical composition was not applied');
  const started=await call('render.start',{expected_fingerprint:applied.fingerprint,profile:{first_frame:0,end_frame_exclusive:frames,scale:'full',transparent:false,timeout_ms:120000}},true);require(typeof started.job_ref==='string','Canonical renderer returned no job reference');receipt.jobRef=started.job_ref;receipt.render='REQUESTED';save();
  const deadline=Date.now()+150000;let status;
  while(Date.now()<deadline){
   if(interrupted){await call('render.cancel',{job_ref:started.job_ref},true);throw new Error('Operator cancelled this native render');}
   status=await call('render.status',{job_ref:started.job_ref});if(['succeeded','failed','cancelled'].includes(status.state))break;await wait(1000);
  }
  require(status?.state==='succeeded',`Native render did not succeed: ${status?.state??'unknown'}`);
  const rendered=await call('render.result',{job_ref:started.job_ref});require(rendered.state==='succeeded'&&rendered.artifact?.frame_count===frames,'Native artifact range does not match the requested source');
  receipt.render='SUCCEEDED';receipt.artifact=rendered.artifact;save();
  const verified=await call('composition.verify',{plan_ref:planned.plan_ref,job_ref:started.job_ref});receipt.nativeVerification=verified;
  require(verified.report?.execution_status==='completed'&&verified.report?.support_level==='native','Canonical native measurement was not completed');
  const artifact=rendered.artifact;require(typeof artifact.directory==='string'&&!isAbsolute(artifact.directory)&&!artifact.directory.includes('..'),'Invalid native artifact directory');
  const root=realpathSync(config.outputRoot),directory=realpathSync(join(root,artifact.directory));require(directory.startsWith(root+'/'),'Native artifact is outside the owner-selected output root');
  const manifestPath=join(directory,'artifact-manifest.json');require(lstatSync(manifestPath).size<=16*1024*1024,'Native manifest exceeds the evidence budget');const bytes=readFileSync(manifestPath);require(sha(bytes)===artifact.manifest_sha256,'Native manifest digest differs from its canonical receipt');
  const manifest=JSON.parse(bytes);require(manifest.frames.length===frames,'Native frame manifest count is inconsistent');writeFileSync(join(output,'artifact-manifest.json'),bytes,{flag:'wx'});
  for(const index of new Set([0,Math.min(30,frames-1),Math.floor(frames/2),frames-1])){
   const frame=manifest.frames[index];require(/^frames\/\d{6}\.png$/.test(frame.file),'Unexpected native PNG name');
   const path=join(directory,frame.file);const st=lstatSync(path);require(st.isFile()&&!st.isSymbolicLink()&&st.size===frame.bytes&&st.size<=32*1024*1024,'Native sample metadata mismatch');
   require(realpathSync(path).startsWith(directory+'/frames/'),'Native PNG is outside its artifact directory');const png=readFileSync(path);require(sha(png)===frame.sha256,'Native PNG digest mismatch');writeFileSync(join(output,`native-${index}.png`),png,{flag:'wx'});
  }
  receipt.sourceState=store.current(options.resource).version.revision===source.version.revision?'CURRENT_APPLICATION_REVISION':'STALE_APPLICATION_REVISION';
  receipt.completed=true;save();console.log(JSON.stringify({output,sourceVersion:source.version,frames,render:receipt.render,nativeMeasurement:verified.report.support_level,sourceState:receipt.sourceState,effects:receipt.effects,graph:receipt.graph}));
 }catch(error){receipt.completed=false;receipt.error=error.message;save();throw error;}
 finally{store.close();process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
