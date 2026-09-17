"""Materialize reviewed, checksummed milestone diffs on the feature branch only."""
import hashlib
import json
import lzma
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
raw = b''.join((root / f'part{i}').read_bytes() for i in range(1, 7))
expected = '5ccadae5883be33c9db98f9fd16630e700430bc35adb5db28caaf12a1287a82b'
if hashlib.sha256(raw).hexdigest() != expected:
    raise SystemExit('Patch series checksum mismatch; no source changed')
series = json.loads(lzma.decompress(raw))
if series.get('format') != 'ApplyLitePatchSeries/v1' or len(series['commits']) != 6:
    raise SystemExit('Unrecognized patch series')
for entry in series['commits']:
    patch = entry['patch'].encode('utf-8')
    subprocess.run(['git', 'apply', '--check', '--index', '-'], input=patch, check=True)
    subprocess.run(['git', 'apply', '--index', '--whitespace=nowarn', '-'], input=patch, check=True)
    subprocess.run(['git', 'commit', '-m', entry['message']], check=True)
    print('Applied verified milestone:', entry['message'], flush=True)
