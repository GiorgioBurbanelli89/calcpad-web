"""Generate index.json from public/examples/ directory."""
import os
import json
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'examples')
ROOT = os.path.abspath(ROOT)

files = []
for dirpath, _, filenames in os.walk(ROOT):
    for fn in filenames:
        if fn.lower().endswith('.cpd'):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
            files.append(rel)

files.sort()

groups = {}
for f in files:
    parts = f.split('/')
    if len(parts) == 1:
        cat = 'Raíz'
    elif len(parts) == 2:
        cat = parts[0]
    else:
        cat = parts[0] + ' / ' + parts[1]
    name = parts[-1][:-4]  # remove .cpd
    groups.setdefault(cat, []).append({'path': f, 'name': name})

out = {'groups': groups, 'total': len(files)}
out_path = os.path.join(ROOT, 'index.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2, ensure_ascii=False)

print(f'Generated {out_path}')
print(f'Total: {len(files)} files in {len(groups)} groups')
for cat, items in sorted(groups.items()):
    print(f'  {cat}: {len(items)}')
