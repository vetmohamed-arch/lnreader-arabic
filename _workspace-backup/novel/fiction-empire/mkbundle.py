#!/usr/bin/env python3
"""Pack a novel folder (canon + chapters) into one bundle doc for the project.

    python3 novel/fiction-empire/mkbundle.py <novel-root> <folder> <out.md> [--last N]

e.g. python3 novel/fiction-empire/mkbundle.py . cultivation /tmp/bundle-cultivation.md

Only the canon files and the LAST N chapters (default 3) go in, because project
knowledge is capped at 2 MB; older chapters come back from the published branch
with pull.py. So: always publish (sync.py --only) BEFORE you bundle. --last 0 = all.
Then write <out.md> back to the project at fiction-empire/bundles/<folder>.md
(project_write with local_path). restore.py splits it again."""
import glob, os, sys
root, folder, out = sys.argv[1:4]
last = int(sys.argv[sys.argv.index('--last') + 1]) if '--last' in sys.argv else 3
base = os.path.join(root, 'novel', folder)
chs = sorted(glob.glob(os.path.join(base, 'chapters', '*.md')))
files = sorted(glob.glob(os.path.join(base, '*.md'))) + (chs[-last:] if last else chs)
with open(out, 'w', encoding='utf-8') as o:
    o.write('<!-- Fiction Empire bundle. Restore: python3 novel/fiction-empire/restore.py <this file> --to <dir> -->\n')
    for f in files:
        rel = os.path.relpath(f, root)
        t = open(f, encoding='utf-8').read()
        if not t.endswith('\n'):
            t += '\n'
        o.write(f'<<<<FILE: {rel}>>>>\n' + t + '\n')
print(out, len(files), 'files')
