#!/usr/bin/env python3
"""Prepare an explicit local owner configuration. Does not launch services or change OS policy."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--driver',required=True,type=Path,help='Built sequencewright-driver binary')
    parser.add_argument('--bundle',required=True,type=Path,help='Matching dist/sequencewright.cjs')
    parser.add_argument('--node',required=True,type=Path,help='Owner-selected Node 24.21 runtime')
    parser.add_argument('--data',required=True,type=Path,help='Existing application-owned data directory')
    parser.add_argument('--output',required=True,type=Path,help='New private configuration directory; must not exist')
    args=parser.parse_args()
    sources={key:getattr(args,key).resolve(strict=True) for key in ['driver','bundle','node']}
    for key,path in sources.items():
        if not path.is_file():
            raise ValueError(f'{key} must be an existing regular file')
    if sources['bundle'].stat().st_size>48*1024:
        raise ValueError('Bundle exceeds the tested Native SDK bridge profile')
    data=args.data.resolve(strict=True)
    if not data.is_dir() or not (data/'sequencewright.db').is_file():
        raise ValueError('Open the local application once to initialize its database first')
    output=args.output.absolute()
    if output.exists():
        raise FileExistsError('Configuration already exists; choose a new output directory')
    if os.name!='posix':
        raise ValueError('This provisioning profile is verified only on Linux')
    if data.stat().st_uid!=os.getuid() or stat.S_IMODE(data.stat().st_mode)&0o022:
        raise PermissionError('Data must be owner-controlled and not group/world-writable')
    output.mkdir(parents=True,mode=0o700)
    private=output/'binary';private.mkdir(mode=0o700)
    runtime=output/'native-runtime';runtime.mkdir(mode=0o700)
    driver=private/'sequencewright-driver';node=private/'node';bundle=runtime/'sequencewright.cjs'
    for key,target in [('driver',driver),('node',node),('bundle',bundle)]:
        shutil.copyfile(sources[key],target)
        target.chmod(0o400 if key=='bundle' else 0o500)
        if digest(target)!=digest(sources[key]):
            raise RuntimeError('Staged bytes differ from their selected source')
    manifest={
        'manifest_version':1,'protocol':5,'id':'sequencewright','version':'0.1.0',
        'publisher':'sequencewright-local-owner','executable':str(driver),'sha256':digest(driver),
        'application':{'desktop_id':None,'process_names':['sequencewright-driver'],'supported_versions':[]},
        'transport':'stdio_v1','network':False,
        'mounts':[{'root':'native-runtime','read_only':True,'execute':False},{'root':'sequencewright-data','read_only':False,'execute':False}],
        'tools':[{'root':'native-node','name':'node','sha256':digest(node),'mounts':['sequencewright-data']}],
        'resources':{'open_files':128,'processes':32,'cpu_seconds':120,'operation_cpu_seconds':0,'address_space_bytes':4294967296,'file_size_bytes':16777216},
        'request_timeout_ms':10000,
        'interfaces':{'dynamic_capabilities':False,'cooperative_cancellation':True,'events':False,'progress':False,'artifacts':False,'health':True,'native_refs':True,'host_tools':True},
    }
    path=output/'driver.json';path.write_text(json.dumps(manifest,indent=2)+'\n');path.chmod(0o600)
    text='drivers = ['+json.dumps(str(path))+']\ndriver_network = false\n[policy]\nprofile = "observe"\nallow = ["driver:sequencewright"]\n'
    for name,root,writable in [('native-runtime',runtime,False),('sequencewright-data',data,True),('native-node',node,False)]:
        text+='\n[[policy.filesystem]]\nname = '+json.dumps(name)+'\npath = '+json.dumps(str(root))+'\nread = true\nwrite = '+str(writable).lower()+'\n'
    config=output/'owner.toml';config.write_text(text);config.chmod(0o600)
    receipt={'schema':'sequencewright/provisioning/1','driver_sha256':digest(driver),'node_sha256':digest(node),'bundle_sha256':digest(bundle),'data':str(data),'configuration':str(config),'services_started':False,'kernel_policy_modified':False,'renderers_connected':False}
    (output/'provisioning.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))


if __name__=='__main__':
    main()
