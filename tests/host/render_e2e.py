#!/usr/bin/env python3
"""Native pixels from three actual Sequencewright projects; disposable CI only."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
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
    text=fixture.config.read_text();old='drivers = ['+json.dumps(str(fixture.paths['config']/'driver.json'))+']'
    assert old in text
    text=text.replace(old,'drivers = ['+json.dumps(str(fixture.paths['config']/'driver.json'))+','+json.dumps(str(path))+']')
    text=text.replace('allow = ["driver:sequencewright"]','allow = ["driver:sequencewright", "driver:motion-canvas"]')
    for name,root,writable in [('project',project,True),('output',output,True),('runtime',runtime,False),('fontconfig',Path('/etc/fonts'),False),('motion-node-tool',node,False)]:
        text+='\n[[policy.filesystem]]\nname = '+json.dumps(name)+'\npath = '+json.dumps(str(root))+'\nread = true\nwrite = '+str(writable).lower()+'\n'
    fixture.config.write_text(text)
    config={'schema':'sequencewright/connection/1','executable':str(cli),'executableSha256':host.digest(cli),'socket':str(fixture.socket),'session':str(fixture.paths['runtime']/'production-session'),'outputRoot':str(output),'maxFrames':1800,'resource':resource}
    connection=fixture.paths['config']/'production.json';connection.write_text(json.dumps(config,indent=2));connection.chmod(0o600)
    return connection


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
            assert fixture.ui_call('document.read',{'resource':resource})['version']==edited['version']
            destination=EVIDENCE/kind
            result=subprocess.run([str(fixture.node),str(ROOT/'scripts/native-render.mjs'),'--connection',str(connection),'--data',str(fixture.paths['data']),'--resource',resource,'--output',str(destination),'--typography','motion-pinned'],env=fixture.env,capture_output=True,text=True,timeout=240)
            (EVIDENCE/(kind+'-cli.log')).write_text(result.stdout+'\n'+result.stderr)
            assert result.returncode==0,result.stderr+result.stdout
            receipt=json.loads((destination/'receipt.json').read_text())
            assert receipt['completed'] and receipt['render']=='SUCCEEDED' and receipt['range']['fullSequence']
            assert receipt['sourceVersion']==edited['version']
            assert receipt['nativeVerification']['report']['support_level']=='native'
            assert receipt['nativeVerification']['measurement']['coverage']['font_resources_digest']
            assert fixture.ui_call('document.read',{'resource':resource})['version']==edited['version'],'Rendering must not rewrite the application document'
            manifest=json.loads((destination/'artifact-manifest.json').read_text())
            assert manifest['renderer']=='motion-canvas-core-renderer-v3.17.2'
            results.append({'project':kind,'sourceVersion':edited['version'],'frameCount':len(manifest['frames']),'render':'PASS','nativeMeasurement':'completed','typography':'explicit motion-pinned profile','effects':'NOT_RUN','audio':'NOT_RUN','mlt':'NOT_RUN'})
        finally:
            fixture.close()
    (EVIDENCE/'result.json').write_text(json.dumps({'sourceSha':subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),'sdkSha':'4d291de26724810017ce7b6d185326514cb79fa6','status':'PASS','projects':results},indent=2))


if __name__=='__main__':
    run()
