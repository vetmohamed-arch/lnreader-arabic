#!/usr/bin/env python3
"""Split Fiction Empire bundle docs back into files.

    python3 restore.py <bundle.md> [<bundle.md> ...] --to <dir>

Each bundle holds files separated by lines of the form
    <<<<FILE: novel/cultivation/chapters/001.md>>>>
and every file is written under --to at that path."""
import os, re, sys
args = sys.argv[1:]
to = '.'
if '--to' in args:
    i = args.index('--to'); to = args[i + 1]; del args[i:i + 2]
pat = re.compile(r'^<<<<FILE: (.+?)>>>>\n', re.M)
for b in args:
    text = open(b, encoding='utf-8').read()
    parts = pat.split(text)
    n = 0
    for path, body in zip(parts[1::2], parts[2::2]):
        path = path.strip()
        if path.startswith('/') or '..' in path.split('/'):
            sys.exit('bad path: ' + path)
        dest = os.path.join(to, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        body = body[:-1] if body.endswith('\n\n') else body   # drop the separator newline
        open(dest, 'w', encoding='utf-8').write(body)
        n += 1
    print(f'{b}: {n} files')
