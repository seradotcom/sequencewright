#!/usr/bin/env python3
"""Create a deterministic, source-only archive from this repository's tracked files."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {'.github', 'src', 'public', 'native', 'contracts', 'tests', 'scripts', 'docs', 'vendor'}
TOP_LEVEL = {'README.md', 'LICENSE', 'PRODUCT.md', 'SOURCE_LOCK.json', 'THIRD_PARTY_NOTICES.md', 'VERIFY.md', 'STATUS.md', '.gitignore', 'package.json', 'package-lock.json', 'rust-toolchain.toml', 'playwright.config.mjs'}


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def main():
    git('diff', '--exit-code')
    git('diff', '--cached', '--exit-code')
    revision = git('rev-parse', 'HEAD').decode().strip()
    files = sorted(n.decode() for n in git('ls-files', '-z').split(b'\0') if n)
    entries = {}
    for name in files:
        parts = PurePosixPath(name).parts
        if not parts or '..' in parts or PurePosixPath(name).is_absolute():
            raise ValueError('Invalid tracked archive path')
        if name not in TOP_LEVEL and parts[0] not in ALLOWED:
            raise ValueError(f'Unreviewed archive member: {name}')
        if any(p in {'node_modules', 'target', '__pycache__', '.cache', '.data', '.git'} for p in parts):
            raise ValueError(f'Build or private data is tracked: {name}')
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Archive source must be a regular file: {name}')
        entries[name] = path.read_bytes()
    manifest = {'schema': 'sequencewright/source-archive/1', 'source_revision': revision, 'release_status': 'development-source-not-a-finished-product', 'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries.items()}}
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    path = output / f'sequencewright-{revision[:12]}-source.zip'
    with path.open('xb') as stream, zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in [*entries.items(), ('MANIFEST_SHA256.json', (json.dumps(manifest, indent=2, sort_keys=True)+'\n').encode())]:
            info = zipfile.ZipInfo('sequencewright/'+name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    with path.with_suffix('.zip.sha256').open('x') as stream:
        stream.write(f'{checksum}  {path.name}\n')
    result = {'source_revision': revision, 'files': len(entries), 'bytes': path.stat().st_size, 'sha256': checksum, 'archive': path.name}
    with (output/'source-package.json').open('x') as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
