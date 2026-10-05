#!/usr/bin/env python3
"""Native pixels from three actual Sequencewright projects; disposable CI only."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import urllib.parse
import urllib.request
import wave
import native_e2e as host

ROOT=Path(__file__).resolve().parents[2]
EVIDENCE=ROOT/'verification/production'


def prepare_motion(fixture,resource):
    project=fixture.root/'motion-project';project.mkdir(mode=0o700)
    output=fixture.root/'motion-output';output.mkdir(mode=0o700)
    runtime=(host.UPSTREAM/'integrations/motion-canvas/runtime').resolve()
    node=fixture.paths['binary']/'motion-node'
    shutil.copyfile(Path(os.environ['SEMWRIGHT_TEST_MOTION_NODE']),node);node.chmod(0o500)
    driver=fixture.paths['binary']/'motion-driver'
    shutil.copyfile(host.BINS/'semwright-motion-canvas-driver',driver);driver.chmod(0o500)
    cli=fixture.paths['binary']/'semwright-cli'
    shutil.copyfile(host.BINS/'semwright',cli);cli.chmod(0o500)
    manifest={
        'manifest_version':1,'protocol':7,'id':'motion-canvas','version':'0.9.0-dev.1',
        'publisher':'sequencewright-native-production-test','executable':str(driver),'sha256':host.digest(driver),
        'application':{'desktop_id':None,'process_names':['node'],'supported_versions':['3.17.2','Node 22.22.0']},
        'transport':'stdio_v1','network':False,
        'mounts':[{'root':'project','read_only':False,'execute':False},{'root':'output','read_only':False,'execute':False},{'root':'runtime','read_only':True,'execute':True},{'root':'fontconfig','read_only':True,'execute':False}],
        'tools':[{'root':'motion-node-tool','name':'motion-node','sha256':host.digest(node),'mounts':['project','output','runtime','fontconfig']}],
        'resources':{'open_files':512,'processes':256,'cpu_seconds':300,'operation_cpu_seconds':0,'address_space_bytes':4294967296,'file_size_bytes':1073741824},
        'request_timeout_ms':300000,
        'interfaces':{'cooperative_cancellation':True,'progress':True,'artifacts':True,'health':True,'host_tools':True},
    }
    path=fixture.paths['config']/'motion-driver.json';path.write_text(json.dumps(manifest,indent=2));path.chmod(0o600)

    # The same verified Motion Canvas output root is exposed read-only as MLT media
    # and writable as the MLT output root. No application or source file is copied.
    scratch=fixture.root/'mlt-scratch';scratch.mkdir(mode=0o700)
    mlt_driver=fixture.paths['binary']/'mlt-driver';shutil.copyfile(host.BINS/'semwright-mlt-video-driver',mlt_driver);mlt_driver.chmod(0o500)
    mlt_runner=fixture.paths['binary']/'mlt-runner';shutil.copyfile(host.BINS/'semwright-mlt-runtime-runner',mlt_runner);mlt_runner.chmod(0o500)
    melt=Path(shutil.which('melt')).resolve();ffprobe=Path(shutil.which('ffprobe')).resolve();ffmpeg=Path(shutil.which('ffmpeg')).resolve()
    mlt_runtime=melt.parent.parent.resolve()
    mlt_manifest={
        'manifest_version':1,'protocol':7,'id':'mlt-video','version':'0.9.0-dev.1',
        'publisher':'sequencewright-native-production-test','executable':str(mlt_driver),'sha256':host.digest(mlt_driver),
        'application':{'desktop_id':None,'process_names':['melt'],'supported_versions':[]},
        'transport':'stdio_v1','network':False,'loopback_port':None,
        'mounts':[{'root':'project','read_only':True,'execute':False},{'root':'media','read_only':True,'execute':False},{'root':'output','read_only':False,'execute':False},{'root':'mlt-runtime','read_only':True,'execute':True},{'root':'scratch','read_only':False,'execute':False}],
        'tools':[
            {'root':'mlt-runner-root','name':'mlt-runner','sha256':host.digest(mlt_runner),'mounts':['mlt-runtime','scratch','project','media','output'],'dependencies':['melt','ffprobe','ffmpeg']},
            {'root':'melt-root','name':'melt','sha256':host.digest(melt),'mounts':[],'dependencies':[]},
            {'root':'ffprobe-root','name':'ffprobe','sha256':host.digest(ffprobe),'mounts':[],'dependencies':[]},
            {'root':'ffmpeg-root','name':'ffmpeg','sha256':host.digest(ffmpeg),'mounts':[],'dependencies':[]},
        ],
        'resources':{'open_files':512,'processes':256,'cpu_seconds':300,'operation_cpu_seconds':0,'address_space_bytes':4294967296,'file_size_bytes':1073741824},
        'request_timeout_ms':300000,
        'interfaces':{'dynamic_capabilities':False,'cooperative_cancellation':False,'events':False,'progress':False,'artifacts':False,'health':True,'native_refs':False,'host_tools':True},
    }
    mlt_path=fixture.paths['config']/'mlt-driver.json';mlt_path.write_text(json.dumps(mlt_manifest,indent=2));mlt_path.chmod(0o600)
    text=fixture.config.read_text();old='drivers = ['+json.dumps(str(fixture.paths['config']/'driver.json'))+']'
    assert old in text
    text=text.replace(old,'drivers = ['+json.dumps(str(fixture.paths['config']/'driver.json'))+','+json.dumps(str(path))+','+json.dumps(str(mlt_path))+']')
    text=text.replace('allow = ["driver:sequencewright"]','allow = ["driver:sequencewright", "driver:motion-canvas", "driver:mlt-video"]')
    for name,root,writable in [('project',project,True),('output',output,True),('runtime',runtime,False),('fontconfig',Path('/etc/fonts'),False),('motion-node-tool',node,False),('media',output,False),('mlt-runtime',mlt_runtime,False),('scratch',scratch,True),('mlt-runner-root',mlt_runner,False),('melt-root',melt,False),('ffprobe-root',ffprobe,False),('ffmpeg-root',ffmpeg,False)]:
        text+='\n[[policy.filesystem]]\nname = '+json.dumps(name)+'\npath = '+json.dumps(str(root))+'\nread = true\nwrite = '+str(writable).lower()+'\n'
    fixture.config.write_text(text)
    config={'schema':'sequencewright/connection/1','executable':str(cli),'executableSha256':host.digest(cli),'socket':str(fixture.socket),'session':str(fixture.paths['runtime']/'production-session'),'outputRoot':str(output),'maxFrames':1800,'resource':resource}
    connection=fixture.paths['config']/'production.json';connection.write_text(json.dumps(config,indent=2));connection.chmod(0o600)
    return connection


def synthetic_wav(frame_count,fps):
    numerator=frame_count*48_000*fps['den'];assert numerator%fps['num']==0
    sample_frames=numerator//fps['num']
    cycle=b''.join(struct.pack('<hh',12000 if i<60 else -12000,12000 if i<60 else -12000) for i in range(120))
    pcm=(cycle*((sample_frames+119)//120))[:sample_frames*4]
    out=io.BytesIO()
    with wave.open(out,'wb') as wav:
        wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(48_000);wav.writeframes(pcm)
    return out.getvalue(),sample_frames


def upload_synthetic_audio(fixture,resource,current,kind):
    frame_count=sum(scene['duration'] for scene in current['document']['scenes'] if not scene.get('archived'))
    audio,sample_frames=synthetic_wav(frame_count,current['document']['profile']['fps'])
    asset_id='ci-voice-'+kind
    metadata={'resource':resource,'expected':current['version'],'key':'ci-audio-'+kind,'asset':{'id':asset_id,'name':'Synthetic CI voice '+kind+'.wav','license':'Synthetic CI fixture; not distributed as product media','provenance':'Generated deterministically on the disposable GitHub Actions runner to verify the native audio handoff.'}}
    request=urllib.request.Request(fixture.base+'/api/assets',data=audio,headers={'Content-Type':'audio/wav','x-sequencewright-csrf':fixture.csrf,'x-sequencewright-asset':urllib.parse.quote(json.dumps(metadata,separators=(',',':')),safe='')},method='POST')
    value=json.load(fixture.http.open(request,timeout=30));assert value['ok'],value
    asset=value['data']['metadata']['asset'];assert asset['id']==asset_id and asset['bytes']==len(audio) and asset['mime']=='audio/wav'
    assert asset['sha256']==hashlib.sha256(audio).hexdigest()
    return {'id':asset_id,'version':value['data']['version'],'sampleFrames':sample_frames,'sha256':asset['sha256']}


def run():
    assert os.environ.get('GITHUB_ACTIONS')=='true','Native rendering belongs on an explicitly provisioned disposable runner'
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    results=[]
    for kind in ['product','lesson','brand']:
        host.EVIDENCE=EVIDENCE/'host'/kind;host.EVIDENCE.mkdir(parents=True,exist_ok=True)
        fixture=host.OwnedFixture();resource='demo-'+kind+'@main'
        connection=prepare_motion(fixture,resource)
        try:
            fixture.start_ui();fixture.start_daemon(kind)
            observed=fixture.invoke('observe',{'resource':resource,'scope':'document','limit':1})
            scene=observed['page']['items'][0]['scenes'][0]
            args=fixture.mutation(observed,'object.update','production-title-'+kind,{'sceneId':scene['id'],'objectId':scene['objects'][1]['id'],'changes':{'text':'Created through the Native SDK.'}})
            edited=fixture.invoke('object.update',args)
            current=fixture.ui_call('document.read',{'resource':resource});assert current['version']==edited['version']
            audio=None
            if kind=='product':
                audio=upload_synthetic_audio(fixture,resource,current,kind)
                native_after_upload=fixture.invoke('observe',{'resource':resource,'scope':'document','limit':1})
                assert native_after_upload['page']['version']==audio['version']
                assert any(asset['id']==audio['id'] and asset['sha256']==audio['sha256'] for asset in native_after_upload['page']['items'][0]['assets'])
                current=fixture.ui_call('document.read',{'resource':resource});assert current['version']==audio['version']
            destination=EVIDENCE/kind
            command=[str(fixture.node),str(ROOT/'scripts/native-render.mjs'),'--connection',str(connection),'--data',str(fixture.paths['data']),'--resource',resource,'--output',str(destination),'--typography','motion-pinned']
            if audio:command+=['--audio-asset',audio['id']]
            result=subprocess.run(command,env=fixture.env,capture_output=True,text=True,timeout=900)
            (EVIDENCE/(kind+'-cli.log')).write_text(result.stdout+'\n'+result.stderr)
            assert result.returncode==0,result.stderr+result.stdout
            receipt=json.loads((destination/'receipt.json').read_text())
            assert receipt['completed'] and receipt['render']=='SUCCEEDED' and receipt['mlt']=='SUCCEEDED' and receipt['range']['fullSequence']
            assert receipt['sourceVersion']==current['version']
            assert receipt['nativeVerification']['report']['support_level']=='native'
            assert receipt['nativeVerification']['measurement']['coverage']['font_resources_digest']
            mezzanine=receipt['mezzanine'];assert mezzanine['codec']=='ffv1' and mezzanine['container']=='matroska' and mezzanine['frame_count']>0
            assert mezzanine['media']['video'] is True and mezzanine['media']['audio'] is False and mezzanine['artifact']['bytes']>0
            mlt_calls=[call for call in receipt['calls'] if call['command']=='driver.mlt-video.frames.encode']
            assert len(mlt_calls)==1 and mlt_calls[0]['execution']['provenance']['provider']=='driver:mlt-video'
            audio_result='NOT_RUN';master_summary=None
            if audio:
                assert receipt['audio']['state']=='VERIFIED_IN_FINAL_MASTER' and receipt['delivery']=='SUCCEEDED'
                assert receipt['audio']['media']['sampleFrames']==audio['sampleFrames']
                master=receipt['master'];assert master['profile']=='h264-aac-mp4' and master['media']['video'] is True and master['media']['audio'] is True
                assert master['audio_sha256']==audio['sha256'] and master['video_sha256']==mezzanine['artifact']['sha256']
                mux_calls=[call for call in receipt['calls'] if call['command']=='driver.mlt-video.av.mux']
                assert len(mux_calls)==1 and mux_calls[0]['execution']['provenance']['provider']=='driver:mlt-video'
                audio_result='PASS';master_summary={'profile':master['profile'],'sha256':master['artifact']['sha256'],'bytes':master['artifact']['bytes'],'decodedAudioSha256':master['decoded_audio']['sha256']}
            else:
                assert receipt['audio']['state']=='NOT_RUN' and receipt['delivery']=='NOT_RUN'
            assert fixture.ui_call('document.read',{'resource':resource})['version']==current['version'],'Rendering must not rewrite the application document'
            manifest=json.loads((destination/'artifact-manifest.json').read_text())
            assert manifest['renderer']=='motion-canvas-core-renderer-v3.17.2'
            results.append({'project':kind,'sourceVersion':current['version'],'frameCount':len(manifest['frames']),'render':'PASS','nativeMeasurement':'completed','typography':'explicit motion-pinned profile','effects':'NOT_RUN','audio':audio_result,'delivery':'PASS' if audio else 'NOT_RUN','mlt':'PASS','mezzanine':{'codec':mezzanine['codec'],'container':mezzanine['container'],'sha256':mezzanine['artifact']['sha256'],'bytes':mezzanine['artifact']['bytes']},'master':master_summary})
        finally:
            fixture.close()
    (EVIDENCE/'result.json').write_text(json.dumps({'sourceSha':subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),'sdkSha':'4d291de26724810017ce7b6d185326514cb79fa6','status':'PASS','projects':results},indent=2))


if __name__=='__main__':
    run()
