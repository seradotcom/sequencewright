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
function inspectPcmWav(raw){
 const bytes=Buffer.from(raw);require(bytes.length>=44&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','Audio production requires a valid RIFF/WAVE file');
 let format=null,dataBytes=null,offset=12;
 while(offset+8<=bytes.length){
  const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;require(end<=bytes.length,'WAV chunk exceeds the attached asset');
  if(name==='fmt '){require(size>=16,'WAV fmt chunk is incomplete');format={encoding:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),blockAlign:bytes.readUInt16LE(start+12),bitsPerSample:bytes.readUInt16LE(start+14)};}
  if(name==='data'){require(dataBytes===null,'Multiple WAV data chunks are not accepted by this production profile');dataBytes=size;}
  offset=end+(size&1);
 }
 require(format&&dataBytes!==null,'WAV requires fmt and data chunks');require(format.encoding===1,'Production audio is restricted to uncompressed PCM WAV');require(format.channels===2&&format.sampleRate===48000,'Production audio must be 48 kHz stereo');require([16,24,32].includes(format.bitsPerSample),'PCM WAV must use 16, 24 or 32 bits per sample');
 require(format.blockAlign===format.channels*format.bitsPerSample/8&&format.byteRate===format.sampleRate*format.blockAlign,'WAV PCM format fields are inconsistent');require(dataBytes%format.blockAlign===0,'WAV data is not an integral number of sample frames');
 return {...format,dataBytes,sampleFrames:dataBytes/format.blockAlign};
}
function args(argv){
 const allowed=new Set(['connection','data','resource','output','typography','frames','audio-asset']);const out={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i]?.slice(2);require(argv[i]?.startsWith('--')&&allowed.has(key)&&typeof argv[i+1]==='string'&&!Object.hasOwn(out,key),'Use explicit unique production arguments');out[key]=argv[i+1];}
 for(const key of ['connection','data','resource','output','typography'])require(out[key],`Missing --${key}`);
 require(out.typography==='motion-pinned','This renderer requires explicit --typography motion-pinned; typography is never silently substituted');return out;
}
async function main(){
 const options=args(process.argv.slice(2));const config=readConnection(options.connection);require(config.resource===options.resource,'Owner connection is bound to a different application resource');
 const client=new CanonicalConnection(config);const store=new Store(options.data,{readOnly:true});
 const source=store.current(options.resource);const sourceFilm=toFilm(source.document);const film=structuredClone(sourceFilm);
 let audioAsset=null,audioBytes=null,audioMedia=null;
 if(options['audio-asset']){
  audioAsset=source.document.assets.find(asset=>asset.id===options['audio-asset']);
  require(audioAsset&&audioAsset.mime==='audio/wav','--audio-asset must identify one attached WAV asset');
  require(source.document.assets.length===1,'This production profile accepts exactly one explicit audio asset and no other media assets');
  require(!source.document.scenes.some(scene=>scene.objects.some(object=>object.assetId)),'Placed media objects need a separate verified visual-media handoff');
  const blob=store.blob(audioAsset.sha256,options.resource);audioBytes=Buffer.from(blob.data);require(sha(audioBytes)===audioAsset.sha256&&audioBytes.length===audioAsset.bytes,'Attached audio bytes differ from application provenance');audioMedia=inspectPcmWav(audioBytes);
  film.assets=[]; // Motion Canvas is the visual provider; MLT receives audio explicitly below.
 }else require(sourceFilm.assets.length===0,'Media-bearing projects require an explicit verified handoff; assets are never silently omitted');
 const originalFonts={font:film.editorial.font,monoFont:film.editorial.mono_font};
 // This is an explicit output-profile decision. It does not edit the application document.
 film.editorial.font={family:'Instrument Sans Variable',asset_digest:null,fallback:'deny',permitted_fallbacks:[]};
 film.editorial.mono_font={family:'IBM Plex Mono',asset_digest:null,fallback:'deny',permitted_fallbacks:[]};
 const frames=options.frames===undefined?duration(source.document):Number(options.frames);
 require(Number.isSafeInteger(frames)&&frames>0&&frames<=duration(source.document)&&frames<=config.maxFrames,'Frame range exceeds the source sequence or owner production budget');
 if(audioAsset){require(frames===duration(source.document),'The verified audio profile currently requires the complete sequence range');const fps=source.document.profile.fps;require(BigInt(audioMedia.sampleFrames)*BigInt(fps.num)===BigInt(frames)*48000n*BigInt(fps.den),'Attached WAV duration does not exactly match the sequence timebase');}
 const output=resolve(options.output);require(!existsSync(output),'Use a new evidence directory; existing files are preserved');mkdirSync(output,{mode:0o700});
 const receipt={schema:'sequencewright/native-render/1',resource:options.resource,sourceVersion:source.version,sourceDocumentSha256:sha(JSON.stringify(source.document)),sourceFilmSha256:sha(JSON.stringify(sourceFilm)),filmSha256:sha(JSON.stringify(film)),audio:audioAsset?{state:'VERIFIED_INPUT',assetId:audioAsset.id,sha256:audioAsset.sha256,mime:audioAsset.mime,media:audioMedia,policy:'whole-sequence 48 kHz stereo PCM unity-gain final master'}:{state:'NOT_RUN'},delivery:'NOT_RUN',typography:{profile:'motion-pinned',source:originalFonts,output:{font:film.editorial.font,monoFont:film.editorial.mono_font},requiresCreativeReview:true},range:{firstFrame:0,endFrameExclusive:frames,fullSequence:frames===duration(source.document)},calls:[],render:'NOT_RUN',mlt:'NOT_RUN',effects:'NOT_RUN',graph:'UNKNOWN'};
 writeFileSync(join(output,'source-film.json'),JSON.stringify(sourceFilm),{flag:'wx'});writeFileSync(join(output,'film.json'),JSON.stringify(film),{flag:'wx'});
 const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(receipt,null,2));
 const callCommand=async(command,parameters,mutation=false)=>{const started=performance.now();const value=await client.execute(command,parameters,{mutation});receipt.calls.push({command,durationMs:Math.round(performance.now()-started),...value});save();return value.data;};
 const call=(name,parameters,mutation=false)=>callCommand('driver.motion-canvas.'+name,parameters,mutation);
 const callMlt=(name,parameters,mutation=false)=>callCommand('driver.mlt-video.'+name,parameters,mutation);
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
  // Hand the immutable Motion Canvas frame manifest to Semwright's MLT driver by
  // digest. The MLT provider re-reads and hashes every PNG before encoding it.
  const mezzanineName=`sequencewright-${sha(source.version.revision).slice(0,16)}.mkv`;
  receipt.mlt='REQUESTED';save();
  const mezzanine=await callMlt('frames.encode',{root:'media',manifest_path:`${artifact.directory}/artifact-manifest.json`,expected_manifest_sha256:artifact.manifest_sha256,output_path:mezzanineName,max_bytes:1073741824},true);
  require(mezzanine.codec==='ffv1'&&mezzanine.container==='matroska','MLT did not return the canonical lossless mezzanine profile');
  require(mezzanine.source_manifest_sha256===artifact.manifest_sha256&&mezzanine.frame_count===frames,'MLT mezzanine is not bound to this native frame artifact');
  require(mezzanine.width===manifest.plan.width&&mezzanine.height===manifest.plan.height&&mezzanine.fps_num===manifest.plan.fps&&mezzanine.fps_den===(manifest.plan.fps_denominator??1),'MLT mezzanine timing or dimensions changed');
  require(mezzanine.media?.video===true&&mezzanine.media?.audio===false,'Visual mezzanine must contain verified video and no invented audio');
  require(mezzanine.artifact?.root==='output'&&mezzanine.artifact?.path===mezzanineName&&/^[0-9a-f]{64}$/.test(mezzanine.artifact.sha256),'MLT returned invalid artifact provenance');
  const mezzaninePath=join(root,mezzanineName),mezzanineStat=lstatSync(mezzaninePath);require(mezzanineStat.isFile()&&!mezzanineStat.isSymbolicLink()&&mezzanineStat.size===mezzanine.artifact.bytes,'MLT mezzanine metadata mismatch');
  require(sha(readFileSync(mezzaninePath))===mezzanine.artifact.sha256,'MLT mezzanine digest differs from its canonical receipt');
  receipt.mlt='SUCCEEDED';receipt.mezzanine=mezzanine;save();
  if(audioAsset){
   const audioName=`sequencewright-audio-${audioAsset.sha256}.wav`,audioPath=join(root,audioName);
   if(existsSync(audioPath)){const st=lstatSync(audioPath);require(st.isFile()&&!st.isSymbolicLink()&&st.size===audioBytes.length,'Existing audio handoff file does not match the attached asset');require(sha(readFileSync(audioPath))===audioAsset.sha256,'Existing audio handoff digest differs from application provenance');}
   else writeFileSync(audioPath,audioBytes,{flag:'wx',mode:0o600});
   receipt.audio={...receipt.audio,state:'STAGED_FOR_MLT',handoff:{root:'media',path:audioName,sha256:audioAsset.sha256}};receipt.delivery='REQUESTED';save();
   const deliveryName=`sequencewright-${sha(source.version.revision).slice(0,16)}.mp4`;
   const master=await callMlt('av.mux',{video_root:'output',video_path:mezzanine.artifact.path,video_sha256:mezzanine.artifact.sha256,audio_root:'media',audio_path:audioName,audio_sha256:audioAsset.sha256,width:mezzanine.width,height:mezzanine.height,fps_num:mezzanine.fps_num,fps_den:mezzanine.fps_den,frame_count:frames,sample_rate:48000,channels:2,profile:'h264-aac-mp4',output_path:deliveryName,max_bytes:1073741824},true);
   require(master.profile==='h264-aac-mp4'&&master.frame_count===frames&&master.fps_num===mezzanine.fps_num&&master.fps_den===mezzanine.fps_den,'Final AV master timing differs from the verified mezzanine');
   require(master.video_sha256===mezzanine.artifact.sha256&&master.audio_sha256===audioAsset.sha256,'Final AV master is not digest-bound to the selected video and audio');
   require(master.sample_rate===48000&&master.channels===2&&master.media?.video===true&&master.media?.audio===true,'Final AV master failed the certified media profile');
   require(master.artifact?.root==='output'&&master.artifact?.path===deliveryName&&/^[0-9a-f]{64}$/.test(master.artifact.sha256),'MLT returned invalid final master provenance');
   require(master.decoded_audio?.root==='output'&&/^[0-9a-f]{64}$/.test(master.decoded_audio.sha256)&&master.decoded_audio_media?.audio===true&&master.decoded_audio_media?.video===false&&master.decoded_audio_sample_frames>0,'Post-encode audio readback is missing');
   for(const [label,artifactMeta] of [['final master',master.artifact],['decoded final audio',master.decoded_audio]]){const path=join(root,artifactMeta.path),st=lstatSync(path);require(st.isFile()&&!st.isSymbolicLink()&&st.size===artifactMeta.bytes,`${label} metadata mismatch`);require(sha(readFileSync(path))===artifactMeta.sha256,`${label} digest differs from its canonical receipt`);}
   receipt.audio={...receipt.audio,state:'VERIFIED_IN_FINAL_MASTER',decoded:{sha256:master.decoded_audio.sha256,sampleFrames:master.decoded_audio_sample_frames}};receipt.delivery='SUCCEEDED';receipt.master=master;save();
  }
  receipt.sourceState=store.current(options.resource).version.revision===source.version.revision?'CURRENT_APPLICATION_REVISION':'STALE_APPLICATION_REVISION';
  receipt.completed=true;save();console.log(JSON.stringify({output,sourceVersion:source.version,frames,render:receipt.render,mlt:receipt.mlt,delivery:receipt.delivery,audio:receipt.audio.state,nativeMeasurement:verified.report.support_level,sourceState:receipt.sourceState,effects:receipt.effects,graph:receipt.graph}));
 }catch(error){receipt.completed=false;receipt.error=error.message;save();throw error;}
 finally{store.close();process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
