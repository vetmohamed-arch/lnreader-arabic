#!/usr/bin/env python3
"""Restore a novel's published chapters (HTML on the fiction-empire branch) as md.

    python3 novel/fiction-empire/pull.py <novel-root> <id> [<id> ...] --branch <clone of fiction-empire branch>

<novel-root> is the folder that holds novel/. Each id is looked up in novels.json
to find its folder. Existing local chapter files are NEVER overwritten (local is
newer). The conversion is exact: sync.py renders the result back to the same HTML.
Get the branch with:
    git clone --depth 1 -b fiction-empire https://github.com/vetmohamed-arch/lnreader-arabic fe-branch"""
import glob, html, json, os, re, sys

def h2m(t):
    out = []
    for b in re.split(r'(?=<h[1-3]>|(?<!<blockquote>)<p>|<hr/>|<blockquote>)', t):
        b = b.strip()
        if not b:
            continue
        if b.startswith('<hr'):
            out.append('---'); b = b[5:].strip()
            if not b:
                continue
        m = re.match(r'<h([1-3])>(.*?)</h\1>', b, re.S)
        if m:
            out.append('#' * int(m.group(1)) + ' ' + html.unescape(m.group(2)).strip()); continue
        q = b.startswith('<blockquote>')
        s = re.sub(r'</?(p|blockquote)>', '', b).replace('<br/>', '\n')
        s = re.sub(r'</?b>', '**', s); s = re.sub(r'</?i>', '*', s); s = html.unescape(s).strip()
        out.append('\n'.join('> ' + l for l in s.split('\n')) if q else s)
    return '\n\n'.join(out) + '\n'

args = sys.argv[1:]
i = args.index('--branch'); branch = args[i + 1]; del args[i:i + 2]
root, ids = args[0], args[1:]
meta = json.load(open(os.path.join(root, 'novel', 'fiction-empire', 'novels.json'), encoding='utf-8'))
folders = {n['id']: n['folder'] for n in meta['novels']}
for nid in ids:
    dest = os.path.join(root, 'novel', folders[nid], 'chapters'); os.makedirs(dest, exist_ok=True)
    new = 0
    for h in sorted(glob.glob(os.path.join(branch, 'chapters', nid, '*.html'))):
        p = os.path.join(dest, os.path.basename(h)[:-5] + '.md')
        if not os.path.exists(p):
            open(p, 'w', encoding='utf-8').write(h2m(open(h, encoding='utf-8').read())); new += 1
    print(f'{nid}: {new} chapters restored from the branch, {len(glob.glob(dest + "/*.md"))} now local')
