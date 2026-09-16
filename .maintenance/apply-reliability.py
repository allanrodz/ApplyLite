"""One-time, hash-checked source materialization for the reliability branch.
This file is removed before merge. It never reads user data or secrets.
"""
import hashlib
import json
from pathlib import Path
root = Path.cwd().resolve()
changes = json.loads((root / '.maintenance/reliability-edits.json').read_text(encoding='utf-8'))
prepared = []
for entry in changes:
    path = (root / entry['path']).resolve()
    if not path.is_relative_to(root):
        raise RuntimeError('Path outside repository')
    original = path.read_bytes().replace(b'\r\n', b'\n')
    digest = hashlib.sha256(original).hexdigest()
    if digest == entry['after']:
        continue
    if digest != entry['before']:
        raise RuntimeError('Baseline changed: ' + entry['path'])
    lines = original.decode('utf-8').splitlines(keepends=True)
    for start, end, replacement in reversed(entry['changes']):
        lines[start:end] = [replacement]
    updated = ''.join(lines).encode('utf-8')
    if hashlib.sha256(updated).hexdigest() != entry['after']:
        raise RuntimeError('Result checksum mismatch: ' + entry['path'])
    prepared.append((path, updated))
for path, updated in prepared:
    path.write_bytes(updated)
    print('Verified source update:', path.relative_to(root))
print('All source changes verified:', len(prepared))
