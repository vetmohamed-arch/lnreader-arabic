<!-- Fiction Empire bundle. Restore: python3 novel/fiction-empire/restore.py <this file> --to <dir> -->
<<<<FILE: novel/fiction-empire/sync.py>>>>
#!/usr/bin/env python3
"""Publish Mohamed's novels to the Fiction Empire plugin.

Reads novels.json (next to this script) and each novel's chapters/NNN.md,
renders them to HTML and pushes them to the `fiction-empire` branch of
vetmohamed-arch/lnreader-arabic. The plugin reads that branch through
raw.githubusercontent.com, so a push is all it takes for new chapters to
show up in the app (pull down to refresh the novel page).

    python3 /mnt/project-files/novel/fiction-empire/sync.py
    python3 .../sync.py --repo /path/to/lnreader-arabic   # another clone
    python3 .../sync.py --out /tmp/fe                     # build only
    python3 .../sync.py --repo <clone> --only nine-star-emperor
        # publish ONE novel and leave the others as they are on the branch
        # (what a novel thread uses: it only has its own folder)

Dialect gate: a chapter with 3+ strong Egyptian markers (عايز، دلوقتي، كده…)
stops the publish. Chapter 000.md = the reader's guide (دليل القارئ); it is
published LAST in the chapter list so it does not spoil the story.

Covers: covers/<id>.jpg here (made by cover-src/covers2.js) wins; a novel
folder's own cover.jpg / cover.png is used only when that file is missing.
"""
import argparse, glob, hashlib, html, json, os, re, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NOVELS_DIR = os.path.dirname(HERE)
BRANCH = 'fiction-empire'


def md_to_html(text):
    out = []
    for para in re.split(r'\n\s*\n', text.strip()):
        p = para.strip()
        if not p:
            continue
        if re.fullmatch(r'-{3,}|\*{3,}', p):
            out.append('<hr/>')
            continue
        m = re.match(r'^(#{1,3})\s+(.*)$', p)
        if m and '\n' not in p:
            level = len(m.group(1))
            out.append(f'<h{level}>{html.escape(m.group(2))}</h{level}>')
            continue
        quote = all(l.startswith('>') for l in p.split('\n'))
        if quote:
            p = '\n'.join(l[1:].lstrip() for l in p.split('\n'))
        h = html.escape(p, quote=False).replace('\n', '<br/>')
        h = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', h)
        h = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', h)
        out.append(f'<blockquote><p>{h}</p></blockquote>' if quote else f'<p>{h}</p>')
    return '\n'.join(out)


# Strong Egyptian-colloquial markers. Mohamed's rule: narration AND dialogue are
# fusha only. A chapter with COLLOQUIAL_MAX or more hits is not published
# (override with --allow-colloquial only if a hit is a false positive).
COLLOQUIAL = re.compile(r'(?<![\u0621-\u063A\u0641-\u065F\u0670-\u06D3])(عايز|عايزة|عاوز|دلوقتي|دلوقت|إزاي|ازاي|كده|كدا|بتاع|بتاعة|بتاعي|بتاعك|مفيش|معلش|علشان|عشان|إحنا|احنا|إنتو|انتو|هنعمل|هنروح|مافيش|ليه بقى|بقى|يلا|يللا|أوي|اوي)(?![\u0621-\u063A\u0641-\u065F\u0670-\u06D3])')
COLLOQUIAL_MAX = 3
ALLOW_COLLOQUIAL = False


def colloquial_hits(text):
    return COLLOQUIAL.findall(text)


def chapter_title(text, number):
    m = re.search(r'^#\s+(.+)$', text, re.M)
    return m.group(1).strip() if m else f'الفصل {number}'


def render_novel(n, meta, out, old=None):
    """Render one novel into out/ and return its index entry.

    old: the novel's current entry on the branch (if any), used to keep a
    chapter's date when its text did not change, and to keep the cover when
    this copy of the project has none for the novel."""
    src = os.path.join(NOVELS_DIR, n['folder'])
    os.makedirs(os.path.join(out, 'covers'), exist_ok=True)
    cands = [os.path.join(HERE, 'covers', n['id'] + '.jpg'),
             os.path.join(HERE, 'covers', n['id'] + '.png'),
             os.path.join(src, 'cover.jpg'), os.path.join(src, 'cover.png')]
    cover = next((c for c in cands if os.path.exists(c)), None)
    if cover:
        cover_name = n['id'] + os.path.splitext(cover)[1]
        for ext in ('.jpg', '.png'):
            stale = os.path.join(out, 'covers', n['id'] + ext)
            if ext != os.path.splitext(cover)[1] and os.path.exists(stale):
                os.remove(stale)
        shutil.copy(cover, os.path.join(out, 'covers', cover_name))
        cover_rel = 'covers/' + cover_name
    elif old and old.get('cover') and os.path.exists(os.path.join(out, old['cover'])):
        cover_rel = old['cover']            # keep what is already published
    else:
        cover_rel = 'icon.png'              # new novel, no cover yet
    cover_hash = hashlib.sha1(open(os.path.join(out, cover_rel), 'rb').read()).hexdigest()[:10]
    old_dates = {c['n']: (c.get('v'), c.get('date')) for c in (old or {}).get('chapters', [])}
    chapters = []
    ch_dir = os.path.join(out, 'chapters', n['id'])
    if os.path.isdir(ch_dir):
        shutil.rmtree(ch_dir)
    os.makedirs(ch_dir, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(src, 'chapters', '*.md'))):
        stem = os.path.basename(f)[:-3]
        if not stem.isdigit():
            continue
        text = open(f, encoding='utf-8').read()
        if not text.strip():
            continue
        hits = colloquial_hits(text)
        if len(hits) >= COLLOQUIAL_MAX and not ALLOW_COLLOQUIAL:
            sys.exit(f"{n['folder']}/chapters/{stem}.md فيه عامية ({len(hits)}: {'، '.join(sorted(set(hits)))}). "
                     'صلّحها بالفصحى قبل النشر (أو --allow-colloquial لو دي كلمات مقصودة).')
        body = md_to_html(text)
        open(os.path.join(ch_dir, stem + '.html'), 'w', encoding='utf-8').write(body + '\n')
        v = hashlib.sha1(body.encode()).hexdigest()[:10]
        ov, od = old_dates.get(int(stem), (None, None))
        date = od if (ov == v and od) else datetime.fromtimestamp(
            os.path.getmtime(f), timezone.utc).strftime('%Y-%m-%d')
        chapters.append({'n': int(stem), 'file': stem, 'title': chapter_title(text, int(stem)),
                         'words': len(re.findall(r'\S+', text)), 'v': v, 'date': date})
    chapters.sort(key=lambda c: c['n'])
    # The reader's guide (000.md) goes LAST, not first: it summarises the
    # story so far, so at the top it would spoil the novel for a new reader
    # (Mohamed, 23 Oct). The app orders chapters by their place in this list.
    chapters = [c for c in chapters if c['n'] != 0] + [c for c in chapters if c['n'] == 0]
    print(f"{n['name']}: {len(chapters)} فصل")
    return {
        'id': n['id'],
        'name': n['name'],
        'author': n.get('author') or meta.get('author', ''),
        'genres': n.get('genres', []),
        'summary': n.get('summary', ''),
        'status': n.get('status', 'Ongoing'),
        'cover': cover_rel,
        'coverV': cover_hash,
        'chapters': chapters,
    }


def write_index(out, novels):
    json.dump({'name': 'Fiction Empire', 'novels': novels},
              open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    open(os.path.join(out, 'README.md'), 'w', encoding='utf-8').write(
        '# Fiction Empire\n\nData for the Fiction Empire LNReader plugin '
        '(`plugins/fictionempire.js` on master). Generated by '
        '`novel/fiction-empire/sync.py`; do not edit by hand.\n')


def build(out, only=None):
    """Build the branch contents in out/.

    only=None: rebuild everything from this copy (needs every novel folder).
    only=[ids]: update just those novels and keep every other novel exactly as
    it is on the branch. Use this from a thread that has only its own novel."""
    meta = json.load(open(os.path.join(HERE, 'novels.json'), encoding='utf-8'))
    by_id = {n['id']: n for n in meta['novels']}
    old_path = os.path.join(out, 'index.json')
    old = json.load(open(old_path, encoding='utf-8'))['novels'] if os.path.exists(old_path) else []
    old_by_id = {n['id']: n for n in old}
    icon = os.path.join(HERE, 'covers', 'icon.png')
    if os.path.exists(icon):
        shutil.copy(icon, os.path.join(out, 'icon.png'))
    if only is None:
        missing = [n['folder'] for n in meta['novels']
                   if not os.path.isdir(os.path.join(NOVELS_DIR, n['folder'], 'chapters'))]
        if missing:
            sys.exit('Missing novel folders for a full rebuild: ' + ', '.join(missing)
                     + '\nUse --only <id> to publish just your novel.')
        for d in ('chapters', 'covers'):
            if os.path.isdir(os.path.join(out, d)):
                shutil.rmtree(os.path.join(out, d))
        novels = [render_novel(n, meta, out, old_by_id.get(n['id'])) for n in meta['novels']]
    else:
        for i in only:
            if i not in by_id:
                sys.exit(f'{i} is not in novels.json; add it there first.')
        novels = list(old)
        for i in only:
            entry = render_novel(by_id[i], meta, out, old_by_id.get(i))
            pos = next((k for k, n in enumerate(novels) if n['id'] == i), None)
            if pos is None:
                novels.append(entry)
            else:
                novels[pos] = entry
    write_index(out, novels)


def git(repo, *args, check=True):
    return subprocess.run(['git', '-C', repo, *args], check=check, text=True,
                          capture_output=True)


def find_repo(arg):
    for c in [arg, '/home/user/lnreader-arabic', os.getcwd()]:
        if c and os.path.isdir(os.path.join(c, '.git')):
            url = git(c, 'remote', 'get-url', 'origin', check=False).stdout
            if 'lnreader-arabic' in url:
                return c
    sys.exit('No lnreader-arabic clone found; pass --repo /path/to/lnreader-arabic')


def publish(repo, only=None):
    for attempt in range(6):
        if attempt:
            import time; time.sleep(2 * attempt)
        work = tempfile.mkdtemp(prefix='fiction-empire-')
        has_branch = git(repo, 'fetch', 'origin', BRANCH, check=False).returncode == 0
        try:
            if has_branch:
                git(repo, 'worktree', 'add', '-f', '-B', BRANCH + '-sync', work, 'FETCH_HEAD')
            else:
                git(repo, 'worktree', 'add', '-f', '--detach', work)
                git(work, 'checkout', '--orphan', BRANCH + '-sync')
                git(work, 'rm', '-rfq', '.')
            build(work, only)
            git(work, 'add', '-A')
            if not git(work, 'status', '--porcelain').stdout.strip():
                print('Nothing new to publish.')
                return
            stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
            what = ', '.join(only) if only else 'all novels'
            git(work, '-c', 'user.name=Fiction Empire sync', '-c', 'user.email=noreply@anthropic.com',
                'commit', '-qm', f'Sync {what} ({stamp})')
            r = git(work, 'push', 'origin', f'HEAD:{BRANCH}', check=False)
            if r.returncode == 0:
                print(f'Published to {BRANCH}.')
                return
            # Usually another thread pushed first: fetch again and rebuild on top.
            print(r.stderr.strip(), file=sys.stderr)
        finally:
            git(repo, 'worktree', 'remove', '--force', work, check=False)
            git(repo, 'branch', '-D', BRANCH + '-sync', check=False)
    sys.exit('Push failed.')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo')
    ap.add_argument('--out')
    ap.add_argument('--only', action='append',
                    help='novel id to publish (repeatable); other novels stay as they are')
    ap.add_argument('--allow-colloquial', action='store_true',
                    help='publish even if the dialect check finds colloquial words')
    a = ap.parse_args()
    ALLOW_COLLOQUIAL = a.allow_colloquial
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        build(a.out, a.only)
    else:
        publish(find_repo(a.repo), a.only)

<<<<FILE: novel/fiction-empire/restore.py>>>>
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

<<<<FILE: novel/fiction-empire/pull.py>>>>
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

<<<<FILE: novel/fiction-empire/mkbundle.py>>>>
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

<<<<FILE: novel/fiction-empire/handoff.py>>>>
#!/usr/bin/env python3
"""Build the Fiction Empire handoff (Markdown + HTML page) from the project files.

Live parts come from the files themselves: chapters/NNN.md in each novel
folder, novels.json, covers, and the published index.json on the
`fiction-empire` branch. Hand-written parts (plan, what's next, Mohamed's
notes) come from handoff-notes.json next to this script. The old project
handoff (/mnt/project-files/HANDOFF.md) is embedded as the last section.

    python3 /mnt/project-files/novel/fiction-empire/handoff.py
    python3 .../handoff.py --html /path/page.html   # also write the page here
"""
import argparse, base64, glob, html, io, json, os, re, sys, urllib.request, zipfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NOVELS_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(NOVELS_DIR)
MD_OUT = os.path.join(NOVELS_DIR, 'FICTION-EMPIRE-HANDOFF.md')
HTML_OUT = os.path.join(HERE, 'handoff.html')
INDEX_URL = 'https://raw.githubusercontent.com/vetmohamed-arch/lnreader-arabic/fiction-empire/index.json'
ARTIFACT_URL_FILE = os.path.join(HERE, 'handoff-artifact-url.txt')
PACK_OUT = os.path.join(NOVELS_DIR, 'fiction-empire-pack.zip')
PACK_SKIP = {'__pycache__', 'handoff.html', 'fiction-empire-pack.zip'}

# Common Egyptian words; a rough signal that a chapter still has colloquial dialogue.
COLLOQUIAL = re.compile(r'(?<![؀-ۿ])(إيه|ايه|عشان|علشان|دلوقتي|دلوقت|ازاي|إزاي|كده|كدا|بتاع|بتاعي|بتاعك|مفيش|معلش|خلاص|يلا|يللا|أوي|اوي|ليه|فين|هنا كده|عايز|عاوز|عايزة|بقى|مش)(?![؀-ۿ])')


def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def fetch_index():
    try:
        with urllib.request.urlopen(INDEX_URL, timeout=20) as r:
            return json.load(r)
    except Exception:
        return None


def chapter_info(folder):
    rows = []
    for path in sorted(glob.glob(os.path.join(NOVELS_DIR, folder, 'chapters', '*.md'))):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        first = text.strip().split('\n', 1)[0]
        title = re.sub(r'^#+\s*', '', first).strip()
        rows.append({
            'n': int(re.sub(r'\D', '', os.path.basename(path)) or 0),
            'title': title,
            'words': len(text.split()),
            'colloquial': len(COLLOQUIAL.findall(text)),
            'mtime': os.path.getmtime(path),
        })
    return rows


def cover_data_uri(folder, novel_id):
    cands = [os.path.join(NOVELS_DIR, folder, n) for n in ('cover.jpg', 'cover.png')]
    cands.append(os.path.join(HERE, 'covers', f'{novel_id}.jpg'))
    for p in cands:
        if os.path.exists(p):
            try:
                from PIL import Image
                im = Image.open(p).convert('RGB')
                im.thumbnail((360, 540))
                buf = io.BytesIO()
                im.save(buf, 'JPEG', quality=82)
                data = buf.getvalue()
            except Exception:
                with open(p, 'rb') as f:
                    data = f.read()
            return 'data:image/jpeg;base64,' + base64.b64encode(data).decode(), os.path.relpath(p, ROOT)
    return None, None


def fmt_time(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%d %H:%M UTC')


def thread_url(notes, tid):
    return f"{notes['project_url']}?thread={tid}"


def collect():
    meta = load(os.path.join(HERE, 'novels.json'), {'novels': []})
    notes = load(os.path.join(HERE, 'handoff-notes.json'), {})
    index = fetch_index()
    published = {}
    if index:
        for n in index.get('novels', []):
            published[n['id']] = len(n.get('chapters', []))
    novels = []
    for n in meta['novels']:
        chs = chapter_info(n['folder'])
        cover, cover_path = cover_data_uri(n['folder'], n['id'])
        folder = os.path.join(NOVELS_DIR, n['folder'])
        epubs = [os.path.basename(p) for p in glob.glob(os.path.join(folder, '*.epub'))]
        novels.append({
            **n,
            'chapters': chs,
            'words': sum(c['words'] for c in chs),
            'colloquial_chapters': [c['n'] for c in chs if c['colloquial'] >= 15],
            'last': max((c['mtime'] for c in chs), default=None),
            'published': published.get(n['id']) if index else None,
            'cover': cover,
            'cover_path': cover_path,
            'epubs': epubs,
            'docs': [os.path.basename(p) for p in sorted(glob.glob(os.path.join(folder, '0*.md')))],
            'notes': notes.get('novels', {}).get(n['folder'], {}),
        })
    old = ''
    try:
        with open(os.path.join(ROOT, 'HANDOFF.md'), encoding='utf-8') as f:
            old = f.read()
    except Exception:
        pass
    url = ''
    if os.path.exists(ARTIFACT_URL_FILE):
        url = open(ARTIFACT_URL_FILE).read().strip()
    return {
        'now': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'novels': novels, 'notes': notes, 'index_ok': index is not None,
        'old': old, 'artifact_url': url,
    }


# ---------- Markdown ----------

RULES = [
    'رواية واحدة في المرة (قرار محمد 21 أكتوبر). الشغالة دلوقتي «إمبراطور النجوم التسع»، والباقي واقف لحد ما يقول.',
    'البطل ذكي وداهية: مؤامرات بطبقات، ومؤامرات مضادة، وخطط تتزرع قبلها بفصول وتتحصد بعدين. ومفيش عدو غبي.',
    'الأسماء فخمة وليها معنى أو قصة، خصوصاً الأماكن المهمة. مفيش أسماء عشوائية أو مضحكة. معنى كل اسم مهم يتكتب في الدستور. (القاعدة دي بتتطبق على الروايات الواقفة لما ترجع.)',
    'السرد **والحوار** بالفصحى المتقنة فقط. ممنوع العامية في أي مكان، حتى في الحوار. (مسموح تكتب مسودة بالإنجليزي وتترجمها، بشرط إن العربي النهائي يبقى سليم ومتقن.) ولو فصل قديم فيه عامية، يتصلّح وينشر تاني.',
    'الكتابة متواصلة: دفعة ورا دفعة لحد ما الرواية تخلص، والنشر على التطبيق أول بأول. مفيش وقوف للسؤال بعد كل فصل.',
    'أسلوب كاتب مخضرم: عمق، دراما، تشويق، أسرار مخفية، قتالات صادمة ومفصّلة، وصف حسي وجسدي دقيق، بروح الجسد المهيمن / ضد الآلهة / أشورا القتالي.',
    'الفصل ~1500–2000 كلمة (الرواية الصيني 2000–3000)، ونهاية كل فصل خطّاف. إشعارات النظام بين 【】.',
    'رواية الزراعة الصيني لازم فيها الداو وفيلق دم التنين، والوحش المرتبط بالبطل تنين مميز.',
    'كل رواية ليها ثريد لوحدها. الكلام مع محمد في الشات بالمصري؛ الرواية نفسها فصحى.',
    'الدستور `00-دستور-الرواية.md` هو المرجع (canon). أي قرار جديد يتكتب فيه.',
]


STATUS = {'active': 'شغالة دلوقتي', 'paused': 'واقفة مؤقتاً'}

ACCOUNT_STEPS = [
    'الحساب التاني مش هيشوف ثريدات المشروع ده ولا فولدر `/mnt/project-files` ولا الصفحة (إلا لو اتشاركت). عشان كده كل حاجة متجمعة في ملف واحد:',
    '- **`fiction-empire-pack.zip`**: فيه فولدر `novel/` كامل (دستور كل رواية، الفصول `chapters/NNN.md`، الأغلفة، و`fiction-empire/` بالسكربتات و`novels.json`)، وملف التسليم ده، وملف التسليم القديم للمشروع كله `PROJECT-HANDOFF.md`. نزّله من ثريد ملف التسليم وارفعه في المشروع الجديد.',
    '- **أول رسالة في الحساب الجديد:** «فك الـ zip واقرا `FICTION-EMPIRE-HANDOFF.md` ودستور الرواية الشغالة وآخر فصلين، وكمّل الكتابة بنفس القواعد».',
    '- **اللي على GitHub (عام):** كود الإضافة `plugins/fictionempire.js` على `master` في `vetmohamed-arch/lnreader-arabic`، والفصول المنشورة (HTML) و`index.json` على فرع `fiction-empire`. الدساتير مش منشورة هناك.',
    '- **النشر على التطبيق من الحساب الجديد:** اربط الريبو `vetmohamed-arch/lnreader-arabic` (بحساب GitHub بتاع محمد)، وشغّل `python3 novel/fiction-empire/sync.py --repo <clone>` من نسخة `novel/` اللي اتفكت. السكربت بيقرا من الفولدر اللي هو فيه، وبيعمل push على فرع `fiction-empire` بس.',
    '- لينكات الثريدات تحت بتفتح بس من حساب محمد الأولاني؛ المحتوى المهم مكتوب هنا وفي الدساتير.',
]


def build_md(d):
    notes = d['notes']
    pr = notes.get('pr', {})
    L = []
    L.append('# Fiction Empire: ملف التسليم')
    L.append('')
    L.append(f"آخر تحديث: {d['now']} (بيتولّد لوحده بـ `handoff.py`) · صاحب المشروع: محمد (GitHub: `vetmohamed-arch`)")
    if d['artifact_url']:
        L.append(f"\nالصفحة: {d['artifact_url']}")
    L.append('')
    L.append('## 1. الفكرة')
    L.append('روايات محمد الأصلية (فانفيك ون بيس وناروتو + روايتين زراعة صيني)، بتتكتب في ثريدات المشروع وبتتنشر في تطبيق **LNReader عربي** عن طريق إضافة اسمها **Fiction Empire**. كل رواية ليها ثريد، وفولدر في `/mnt/project-files/novel/<folder>/` فيه الدستور والفصول.')
    L.append('')
    L.append('## 0. لو بتكمّل من حساب تاني (ابدأ هنا)')
    for x in ACCOUNT_STEPS:
        L.append(x)
    L.append('')
    if notes.get('mode'):
        L.append(f"**طريقة الشغل دلوقتي:** {notes['mode']}")
        L.append('')
    L.append('## 2. التقدم')
    L.append('| الرواية | الفولدر | الفصول المكتوبة | على التطبيق | الكلمات | آخر فصل | فصول فيها عامية |')
    L.append('|---|---|---|---|---|---|---|')
    for n in d['novels']:
        pub = '؟' if n['published'] is None else str(n['published'])
        last = fmt_time(n['last']) if n['last'] else '-'
        col = '، '.join(map(str, n['colloquial_chapters'])) or 'لا'
        L.append(f"| {n['name']} | `{n['folder']}` | {len(n['chapters'])} | {pub} | {n['words']:,} | {last} | {col} |")
    L.append('')
    L.append('«فصول فيها عامية» عدّ تقريبي لكلمات مصرية شائعة (15 كلمة أو أكتر في الفصل)، عشان نتابع تحويل الحوار للفصحى.')
    L.append('')
    L.append('## 3. الروايات')
    for n in d['novels']:
        nt = n['notes']
        L.append(f"### {n['name']} ({STATUS.get(nt.get('status'), 'شغالة')})")
        if nt.get('thread'):
            L.append(f"- الثريد: [{nt.get('thread_title', n['name'])}]({thread_url(notes, nt['thread'])})")
        L.append(f"- الفولدر: `novel/{n['folder']}/` · id في الإضافة: `{n['id']}` · الطول المخطط: {nt.get('length', '-')}")
        if n['docs']:
            L.append('- ملفات الخطة: ' + '، '.join(f'`{x}`' for x in n['docs']))
        if n['chapters']:
            last = n['chapters'][-1]['n']
            L.append(f"- **إزاي تكمّل:** اقرا الدستور كله، وآخر فصلين ({last - 1} و{last}) من `chapters/`، وبعدين اكتب `chapters/{last + 1:03d}.md` وانشر بـ sync.py.")
        if n['epubs']:
            L.append('- EPUB: ' + '، '.join(f'`{x}`' for x in n['epubs']))
        L.append(f"- الغلاف: `{n['cover_path'] or 'مفيش'}`")
        for key, label in (('premise', 'الفكرة'), ('must', 'لازم'), ('plan', 'الخطة'), ('now', 'شغال على'), ('next', 'التالي')):
            if nt.get(key):
                L.append(f'- **{label}:** {nt[key]}')
        if n['chapters']:
            L.append('- الفصول: ' + ' · '.join(f"{c['n']}. {re.sub(r'^الفصل [^:]+:\s*', '', c['title'])}" for c in n['chapters']))
        L.append('')
    L.append('## 4. إضافة Fiction Empire')
    L.append(f"- الكود: `plugins/fictionempire.js` في `vetmohamed-arch/lnreader-arabic`، [PR #{pr.get('number', 15)}]({pr.get('url', '')}): {pr.get('state', '')}")
    L.append('- المحتوى على فرع **`fiction-empire`** (`index.json` + `covers/` + `chapters/<id>/<NNN>.html` + `icon.png`) والإضافة بتقراه من raw.githubusercontent.com. أي push بيظهر في التطبيق خلال دقايق من غير APK جديد (اسحب لتحت في صفحة الرواية).')
    L.append('- **النشر:** بعد أي فصل جديد أو تعديل: `python3 /mnt/project-files/novel/fiction-empire/sync.py` (محتاج clone من lnreader-arabic في `/home/user/lnreader-arabic` أو `--repo`). محمد سمح بالـ push على فرع `fiction-empire`.')
    L.append('- البيانات (الاسم، الملخص، التصنيفات، الحالة): `novel/fiction-empire/novels.json`. **الـ id ميتغيرش.** الغلاف: `cover.jpg/png` في فولدر الرواية، وإلا `fiction-empire/covers/<id>.jpg`.')
    L.append('- نفس الـ PR بيخلي التطبيق ميترجمش فصل مكتوب عربي أصلاً.')
    if notes.get('plugin_now'):
        L.append(f"- شغال دلوقتي: {notes['plugin_now']} ([ثريد الإضافة]({thread_url(notes, notes['plugin_thread'])}))")
    L.append('')
    L.append('## 5. قواعد الكتابة (من محمد)')
    for r in RULES:
        L.append(f'- {r}')
    L.append('')
    L.append('## 6. أدوات')
    L.append('- EPUB: `python3 /mnt/project-files/novel/mkepub.py <out.epub> <chapters_dir> "<title>"`')
    L.append('- أغلفة: `novel/fiction-empire/cover-src/covers.js` (`node covers.js`) و`novel/cover-tools/`.')
    L.append('- ملف التسليم ده: `python3 /mnt/project-files/novel/fiction-empire/handoff.py` (الأجزاء اليدوية في `handoff-notes.json`).')
    L.append('')
    L.append('## 7. التحديث التلقائي')
    L.append('Claude مبيقدرش يعرف إمتى الليميت هيخلص، فبدل كده فيه مهمة مجدولة كل 3 ساعات بتصحّي ثريد ملف التسليم: بتقرا آخر حالة في ثريدات الروايات، تحدّث `handoff-notes.json`، تشغّل `handoff.py --pack`، وتنشر الصفحة على نفس اللينك، وتجدد الـ zip. الأرقام (الفصول، الكلمات، المنشور) بتتحسب من الملفات كل مرة.')
    L.append('')
    if d['old']:
        L.append('## 8. ملف التسليم القديم (مشروع Entertainment كله)')
        L.append('نسخة من `/mnt/project-files/HANDOFF.md` (والـ Claude Doc: https://claude.ai/artifact/ET3iNP9JoNFyuB4ajcj6Fw).')
        L.append('')
        for line in d['old'].splitlines():
            L.append('#' + line if line.startswith('#') else line)
    return '\n'.join(L).rstrip() + '\n'


# ---------- HTML ----------

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r'(?<![">])(https?://[^\s<)،]+)', r'<a href="\1" target="_blank" rel="noopener">\1</a>', s)
    return s


def md_to_html(text):
    out, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            j = i + 1
            buf = []
            while j < len(lines) and not lines[j].startswith('```'):
                buf.append(lines[j]); j += 1
            out.append('<pre dir="ltr"><code>' + html.escape('\n'.join(buf)) + '</code></pre>')
            i = j + 1; continue
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            lvl = min(len(m.group(1)) + 1, 6)
            out.append(f'<h{lvl}>{inline(m.group(2))}</h{lvl}>'); i += 1; continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip('|').split('|')] for r in rows if not re.match(r'^\|[\s|:-]+\|$', r)]
            t = '<div class="tw"><table><thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in cells[0]) + '</tr></thead><tbody>'
            for r in cells[1:]:
                t += '<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>'
            out.append(t + '</tbody></table></div>'); continue
        if re.match(r'^\s*(-|\d+\.)\s+', line):
            ordered = bool(re.match(r'^\s*\d+\.', line))
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < len(lines) and re.match(r'^\s*(-|\d+\.)\s+', lines[i]):
                items.append(re.sub(r'^\s*(-|\d+\.)\s+', '', lines[i])); i += 1
            out.append(f'<{tag}>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + f'</{tag}>'); continue
        if line.startswith('>'):
            out.append(f'<blockquote>{inline(line.lstrip("> "))}</blockquote>'); i += 1; continue
        if line.strip():
            out.append(f'<p>{inline(line)}</p>')
        i += 1
    return '\n'.join(out)


CSS = """
/* Layout: one reading column; a progress ledger up top, then a card per novel (cover beside its facts), then reference sections. */
:root{
  --bg:#f3f4f8; --surface:#ffffff; --fg:#1a1d2b; --muted:#5b6078; --line:#dcdfea;
  --gold:#8a6514; --ink:#2b3a86; --warn:#a2401f; --ok:#2f6b3c;
  --display:"Reem Kufi","Noto Naskh Arabic",serif; --body:"IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif; --mono:ui-monospace,"SFMono-Regular",Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0e1020;--surface:#171a2e;--fg:#e7e8f2;--muted:#a3a8c3;--line:#2a2e4a;--gold:#d8b25a;--ink:#9fb0ff;--warn:#f08c6a;--ok:#7fcf8e;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1020;--surface:#171a2e;--fg:#e7e8f2;--muted:#a3a8c3;--line:#2a2e4a;--gold:#d8b25a;--ink:#9fb0ff;--warn:#f08c6a;--ok:#7fcf8e;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--body);font-size:16px;line-height:1.85;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 64px}
main{max-width:860px;margin:0 auto;display:grid;gap:36px}
header{display:grid;gap:6px;border-bottom:2px solid var(--gold);padding-bottom:18px}
.eyebrow{font-size:13px;letter-spacing:.04em;color:var(--gold);font-weight:600}
h1{font-family:var(--display);font-size:clamp(34px,7vw,52px);line-height:1.15;margin:0;font-weight:600;text-wrap:balance}
h2{font-family:var(--display);font-size:26px;margin:0 0 12px;font-weight:600;color:var(--ink);text-wrap:balance}
h3{font-size:19px;margin:18px 0 6px}
h4,h5,h6{font-size:16px;margin:14px 0 4px}
p{margin:0 0 10px}
.meta{color:var(--muted);font-size:14px}
a{color:var(--ink)} a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
code{font-family:var(--mono);font-size:.86em;background:color-mix(in srgb,var(--ink) 9%,transparent);padding:1px 5px;border-radius:4px;direction:ltr;unicode-bidi:isolate;word-break:break-word}
pre{background:var(--surface);border:1px solid var(--line);padding:12px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:14.5px;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600;white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
.num{font-family:var(--display);font-size:22px;color:var(--fg)}
.pill{display:inline-block;font-size:12.5px;padding:1px 9px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.pill.warn{color:var(--warn)} .pill.ok{color:var(--ok)}
.novels{display:grid;gap:22px}
.novel{display:grid;grid-template-columns:150px 1fr;gap:18px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px}
.novel img{width:150px;aspect-ratio:2/3;object-fit:cover;border-radius:4px;max-width:100%;box-shadow:0 4px 14px rgb(0 0 0 / .18)}
.novel .body{min-width:0;display:grid;gap:6px}
.novel h3{margin:0;font-family:var(--display);font-size:24px;font-weight:600}
.facts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:4px 0 0;font-size:15px}
.facts dt{color:var(--muted);font-weight:600}
.facts dd{margin:0;min-width:0}
details{border-top:1px solid var(--line);padding-top:8px}
summary{cursor:pointer;color:var(--ink);font-weight:600}
summary:focus-visible{outline:2px solid var(--gold)}
ol.chs{columns:2;column-gap:24px;margin:8px 0 0;padding-inline-start:22px;font-size:14.5px}
ol.chs li{break-inside:avoid}
.old{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px}
ul,ol{margin:0 0 10px;padding-inline-start:22px}
blockquote{margin:0 0 10px;padding-inline-start:12px;border-inline-start:3px solid var(--gold);color:var(--muted)}
@media (max-width:560px){.novel{grid-template-columns:1fr}.novel img{width:120px}ol.chs{columns:1}}
"""


def build_html(d):
    notes = d['notes']
    pr = notes.get('pr', {})
    e = lambda s: html.escape(str(s))
    H = ['<title>Fiction Empire</title>',
         '<meta name="claude:viewport-fit-sides" content="cover">',
         '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600&family=Reem+Kufi:wght@500;600&display=swap">',
         f'<style>{CSS}</style>', '<main dir="rtl" lang="ar">']
    H.append('<header><div class="eyebrow">ملف التسليم · روايات محمد</div><h1>Fiction Empire</h1>'
             f'<div class="meta">آخر تحديث: <span dir="ltr">{e(d["now"])}</span> · بيتحدّث لوحده كل 3 ساعات من ملفات الروايات</div></header>')
    acct = '\n'.join(ACCOUNT_STEPS[1:])
    H.append('<section><h2>لو بتكمّل من حساب تاني</h2><p>' + inline(ACCOUNT_STEPS[0]) + '</p>' + md_to_html(acct)
             + (f'<p><strong>طريقة الشغل دلوقتي:</strong> {inline(notes["mode"])}</p>' if notes.get('mode') else '') + '</section>')
    # Progress ledger
    total = sum(len(n['chapters']) for n in d['novels'])
    words = sum(n['words'] for n in d['novels'])
    H.append('<section><h2>التقدم</h2>')
    H.append(f'<p class="meta">{total} فصل مكتوب في {len(d["novels"])} روايات، حوالي {words:,} كلمة.'
             + ('' if d['index_ok'] else ' (مقدرتش أقرا المنشور على التطبيق المرة دي.)') + '</p>')
    H.append('<div class="tw"><table><thead><tr><th>الرواية</th><th>مكتوب</th><th>على التطبيق</th><th>كلمات</th><th>آخر فصل</th><th>الفصحى</th></tr></thead><tbody>')
    for n in d['novels']:
        pub = '؟' if n['published'] is None else n['published']
        col = n['colloquial_chapters']
        pill = (f'<span class="pill warn">عامية في {len(col)} فصل</span>' if col else '<span class="pill ok">فصحى</span>')
        last = fmt_time(n['last']) if n['last'] else '-'
        H.append(f'<tr><td><a href="#{e(n["id"])}">{e(n["name"])}</a></td><td class="num">{len(n["chapters"])}</td><td>{pub}</td>'
                 f'<td>{n["words"]:,}</td><td dir="ltr" style="text-align:right">{e(last)}</td><td>{pill}</td></tr>')
    H.append('</tbody></table></div><p class="meta">«عامية» عدّ تقريبي لكلمات مصرية شائعة (15 أو أكتر في الفصل)، عشان نتابع تحويل الحوار للفصحى.</p></section>')
    # Novels
    H.append('<section><h2>الروايات</h2><div class="novels">')
    for n in d['novels']:
        nt = n['notes']
        img = f'<img src="{n["cover"]}" alt="غلاف {e(n["name"])}">' if n['cover'] else '<div></div>'
        facts = []
        if nt.get('thread'):
            facts.append(('الثريد', f'<a href="{e(thread_url(notes, nt["thread"]))}" target="_blank" rel="noopener">{e(nt.get("thread_title", n["name"]))}</a>'))
        facts.append(('الفولدر', f'<code>novel/{e(n["folder"])}/</code> · id <code>{e(n["id"])}</code>'))
        facts.append(('الطول', e(nt.get('length', '-'))))
        for key, label in (('premise', 'الفكرة'), ('must', 'لازم'), ('plan', 'الخطة'), ('now', 'شغال على'), ('next', 'التالي')):
            if nt.get(key):
                facts.append((label, inline(nt[key])))
        files = ' '.join(f'<code>{e(x)}</code>' for x in n['docs'] + n['epubs'])
        if n['chapters']:
            last = n['chapters'][-1]['n']
            facts.append(('تكمّل إزاي', f'اقرا الدستور كله وآخر فصلين ({last - 1} و{last})، واكتب <code>chapters/{last + 1:03d}.md</code> وانشر بـ sync.py.'))
        if files:
            facts.append(('ملفات', files))
        dl = ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in facts)
        chs = ''.join(f'<li value="{c["n"]}">{e(re.sub(r"^الفصل [^:]+:\s*", "", c["title"]))}</li>' for c in n['chapters'])
        st = nt.get('status', 'active')
        badge = f'<span class="pill {"ok" if st == "active" else "warn"}">{STATUS.get(st, "")}</span>'
        H.append(f'<article class="novel" id="{e(n["id"])}">{img}<div class="body"><h3>{e(n["name"])} {badge}</h3>'
                 f'<dl class="facts">{dl}</dl>'
                 f'<details><summary>الفصول ({len(n["chapters"])})</summary><ol class="chs">{chs}</ol></details></div></article>')
    H.append('</div></section>')
    # Plugin, rules, tools, auto-update
    plugin_md = '\n'.join([
        f"- الكود: `plugins/fictionempire.js` في `vetmohamed-arch/lnreader-arabic`، [PR #{pr.get('number', 15)}]({pr.get('url', '')}): {pr.get('state', '')}",
        '- المحتوى على فرع **`fiction-empire`** (`index.json` + `covers/` + `chapters/<id>/<NNN>.html`)، والإضافة بتقراه من raw.githubusercontent.com. أي push بيظهر في التطبيق خلال دقايق من غير APK جديد (اسحب لتحت في صفحة الرواية).',
        '- **النشر بعد أي فصل:** `python3 /mnt/project-files/novel/fiction-empire/sync.py` (محتاج clone من lnreader-arabic في `/home/user/lnreader-arabic` أو `--repo`). محمد سمح بالـ push على فرع `fiction-empire`.',
        '- البيانات (الاسم، الملخص، التصنيفات، الحالة): `novel/fiction-empire/novels.json`. **الـ id ميتغيرش.** الغلاف: `cover.jpg/png` في فولدر الرواية، وإلا `fiction-empire/covers/<id>.jpg`.',
        '- نفس الـ PR بيخلي التطبيق ميترجمش فصل مكتوب عربي أصلاً.',
    ] + ([f"- شغال دلوقتي: {notes['plugin_now']} ([ثريد الإضافة]({thread_url(notes, notes['plugin_thread'])}))"] if notes.get('plugin_now') else []))
    H.append('<section><h2>إضافة Fiction Empire</h2>' + md_to_html(plugin_md) + '</section>')
    H.append('<section><h2>قواعد الكتابة</h2>' + md_to_html('\n'.join(f'- {r}' for r in RULES)) + '</section>')
    H.append('<section><h2>أدوات</h2>' + md_to_html('\n'.join([
        '- EPUB: `python3 /mnt/project-files/novel/mkepub.py <out.epub> <chapters_dir> "<title>"`',
        '- أغلفة: `novel/fiction-empire/cover-src/covers.js` (`node covers.js`) و`novel/cover-tools/`.',
        '- ملف التسليم: `python3 /mnt/project-files/novel/fiction-empire/handoff.py` يكتب `novel/FICTION-EMPIRE-HANDOFF.md` والصفحة دي. الأجزاء اليدوية في `handoff-notes.json`.',
    ])) + '</section>')
    H.append('<section><h2>التحديث التلقائي</h2><p>مفيش طريقة نعرف بيها إمتى الليميت هيخلص، فبدل كده فيه مهمة مجدولة كل 3 ساعات بتصحّي ثريد ملف التسليم: بتقرا آخر حالة في ثريدات الروايات، تحدّث الملاحظات، وتبني الصفحة دي والـ zip من جديد. الأرقام بتتحسب من الملفات نفسها كل مرة، فحتى لو ثريد وقف فجأة، آخر فصل اتكتب هيبان هنا.</p></section>')
    if d['old']:
        H.append('<section><h2>ملف التسليم القديم</h2><p class="meta">مشروع Entertainment كله (التطبيق، الإضافات، الريبوهات). نسخة من <code>/mnt/project-files/HANDOFF.md</code>، والـ <a href="https://claude.ai/artifact/ET3iNP9JoNFyuB4ajcj6Fw" target="_blank" rel="noopener">Claude Doc</a>.</p>'
                 f'<details class="old"><summary>افتح الملف القديم</summary>{md_to_html(d["old"])}</details></section>')
    H.append('</main>')
    return '\n'.join(H) + '\n'


def pack():
    """Zip novel/ plus both handoffs so another Claude account can pick the work up."""
    with zipfile.ZipFile(PACK_OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(MD_OUT, 'FICTION-EMPIRE-HANDOFF.md')
        old = os.path.join(ROOT, 'HANDOFF.md')
        if os.path.exists(old):
            z.write(old, 'PROJECT-HANDOFF.md')
        for dirpath, dirs, files in os.walk(NOVELS_DIR):
            dirs[:] = [x for x in dirs if x not in PACK_SKIP]
            for f in files:
                if f in PACK_SKIP or f.endswith('.pyc') or f == 'FICTION-EMPIRE-HANDOFF.md' and dirpath == NOVELS_DIR:
                    continue
                full = os.path.join(dirpath, f)
                z.write(full, os.path.join('novel', os.path.relpath(full, NOVELS_DIR)))
    print(PACK_OUT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', help='extra path to write the HTML page to')
    ap.add_argument('--pack', action='store_true', help='also write fiction-empire-pack.zip for another account')
    a = ap.parse_args()
    d = collect()
    with open(MD_OUT, 'w', encoding='utf-8') as f:
        f.write(build_md(d))
    page = build_html(d)
    for p in filter(None, [HTML_OUT, a.html]):
        with open(p, 'w', encoding='utf-8') as f:
            f.write(page)
    print(f'{MD_OUT}\n{HTML_OUT}' + (f'\n{a.html}' if a.html else ''))
    for n in d['novels']:
        print(f"{n['folder']}: {len(n['chapters'])} written, {n['published']} published, colloquial in {n['colloquial_chapters']}")
    if a.pack:
        pack()


if __name__ == '__main__':
    main()

<<<<FILE: novel/fiction-empire/novels.json>>>>
{
  "author": "محمد",
  "novels": [
    {
      "id": "nine-star-emperor",
      "folder": "cultivation",
      "name": "إمبراطور النجوم التسع",
      "genres": ["شيانشيا", "زراعة", "عودة بالزمن", "خيمياء", "تنين"],
      "summary": "كان شيا يوان إمبراطور الحبوب، أعظم خيميائي في القارة، لكنه عاش ستين عاماً بجسد معطوب بعدما سُرق جذره الروحي ودمه وعظمه وهو في العاشرة. ومات تحت أنقاض العاصمة وهو يرى المدّ الأسود يبتلع إمبراطوريته وأباه وكل من أحب.\n\nثم فتح عينيه في زقاق موحل، ينزف، وعمره ستة عشر عاماً... في اليوم نفسه الذي بدأ فيه سقوطه. وفي صدره بيضة مختومة وضعتها أمه فيه يوم وُلد، فيها آخر تنين نجمي في الكون.\n\n«في حياتي الأولى تعلّمت أن أنحني. في هذه الحياة، ستتعلم السماء أن تنحني لي.»"
    },
    {
      "id": "nine-heavens-sect",
      "folder": "sect-master",
      "name": "سيد طائفة السماوات التسع",
      "genres": ["شيانشيا", "زراعة", "بناء طائفة", "نظام", "تلاميذ"],
      "summary": "قبل مليون عام، حكمت طائفة السماوات التسع الكون كله، وعلى أسوارها انكسرت موجات غزاة الفراغ مرة بعد مرة. ثم اختفت في «الليلة الأخيرة».\n\nاليوم، على جبل أصلع في ركن منسي من السماء الأولى، يرث تشين شيوان ذو التسعة عشر عاماً طائفة السحاب الصافي: ثلاثة أعضاء، ودَين ثقيل، وطائفة جارة تريد الجبل. وفي ليلة جنازة معلّمه يستيقظ لوح حجري أسود:\n\n【نظام الطائفة الشامل — الوريث الشرعي لطائفة السماوات التسع: تم العثور عليه.】"
    },
    {
      "id": "pirate-king-returns",
      "folder": "one-piece",
      "name": "ون بيس: ملك القراصنة يعود",
      "genres": ["ون بيس", "رواية معجبين", "عودة بالزمن", "نظام", "مغامرة"],
      "summary": "في إلباف، تدخّل «إم» بنفسه ومحا الشجرة العملاقة ومن عليها في بياض واحد. لكن قلب لوفي رفض أن يقف، ودقّت طبول التحرير حتى شقّت المحو.\n\nيستيقظ لوفي صباح إبحاره من قرية فوشا، ومعه الطاقم كله، كل واحد في مكانه من الزمن، بذكرياته كاملة حتى إلباف. الأجساد عادت ضعيفة، والخبرة باقية، و«نظام الطاقم» يفتح لهم طريقاً لم يمشه أحد. وفوق، في ماري جوا، عين تنفتح."
    },
    {
      "id": "yellow-flash-returns",
      "folder": "minato",
      "name": "ناروتو: البرق الأصفر يعود",
      "genres": ["ناروتو", "رواية معجبين", "عودة بالزمن", "نظام", "بناء قرية"],
      "summary": "في نهاية الحرب العالمية الرابعة، وروحه المستحضَرة تتفتت، يرى ناميكازي ميناتو كل ما فاته: ابن كبر وحيداً، وتلميذ صار وحشاً، ومذبحة، وإلهة تجهّز جيشها الأبيض.\n\nيعود بذكرياته كاملة إلى ما قبل تتويجه بيومين. وحين يضع الهوكاجي الثالث قبعة النار على رأسه، يكتمل «نظام التطوير الشامل للقرية». أمامه عشرة أشهر حتى ليلة الثعلب، وحرب أكبر من العالم كله."
    },
    {
      "id": "i-am-the-hokage",
      "folder": "naruto-hokage",
      "name": "ناروتو: أنا الهوكاجي",
      "genres": ["ناروتو", "رواية معجبين", "عودة بالزمن", "نظام", "دراما"],
      "summary": "كوراما مات، وناروتو الهوكاجي السابع مختوم في بُعد لا يتحرك فيه الزمن، يرى من شق رفيع كونوها تحترق وبوروتو يقاتل وحده.\n\nآخر ذرة من تشاكرا الحكيم تتحول إلى «نظام الهوكاجي السابع»، فيعود عكس الزمن إلى شقته الفارغة وهو في السابعة، قبل ليلة القمر الدموي بأربعة وتسعين يوماً. بعقل هوكاجي، ومعه «ختم الذاكرة» الذي يوقظ ذكريات المستقبل في قلوب الآخرين."
    }
  ]
}

<<<<FILE: novel/fiction-empire/handoff-notes.json>>>>
{
  "_about": "يدوي: الملاحظات اللي مش موجودة في الملفات (الخطة، التالي، ملاحظات محمد). handoff.py بيقراه ويبني منه ملف التسليم. عدّله لما الحالة تتغير.",
  "updated": "2026-10-21",
  "project_url": "https://claude.ai/code/project/chan_013Yojd9E7FDP3d714WDucfy",
  "handoff_thread": "cmsg_013Yojd9E7FDP3d714WDucfy8FsDnUkUYWgfqNHyjMLnSK",
  "plugin_thread": "cmsg_013Yojd9E7FDP3d714WDucfy1X7vmXHrDsSrDmaeF33mcP",
  "pr": {
    "number": 15,
    "url": "https://github.com/vetmohamed-arch/lnreader-arabic/pull/15",
    "state": "اتدمج في master. الإضافة موجودة في التطبيق تحت العربي."
  },
  "plugin_now": "الأغلفة الجديدة نزلت: لوحات قديمة ملكية عامة من Wikimedia Commons بالعنوان فوقها (تنين عصر مينغ، جبل فان كوان، «الموجة التاسعة» لأيفازوفسكي لون بيس، إله الرعد لسوتاتسو، الثعلب ذو التسعة ذيول لكونييوشي). أي تغيير في الأغلفة بيعدّي على ثريد الإضافة بس عشان الثريدات متكتبش فوق بعض.",
  "novels": {
    "cultivation": {
      "thread": "cmsg_013Yojd9E7FDP3d714WDucfyLYrU4BaQuvsdE9mSq9DAh6",
      "thread_title": "الإمبراطور العائد",
      "length": "3000–5000 فصل",
      "premise": "شيا يوان، إمبراطور الحبوب، يعود لسن 16 يوم بداية سقوطه، وفي صدره بيضة آخر تنين نجمي (شي لوان). الأساس: الجسد المهيمن ذو النجوم التسع، ممزوج بضد الآلهة وأشورا القتالي وحكايات الشياطين والآلهة وملك الزمن (الساعة الرملية).",
      "must": "لازم يكون فيها الداو (لمحة ← بذرة ← نية ← مجال ← قلب الداو؛ داو النجوم والزمن والحبوب) وفيلق دم التنين جنب البطل دايماً (فانغ دا هاي، لي مو، سو تشينغ، شيا يو). الوحش المرتبط = تنين مميز (شي لوان).",
      "plan": "القوس الأول 50 فصل (مخطط في 02-مخطط-القوس-الأول.md)، وبعده المجلدات حسب قسم 9 في الدستور.",
      "now": "الفصول 1–10 اتكتبت ونزلت. بيراجع الأسماء دلوقتي (أسماء فخمة لها قصة) ويعدّل الفصول المنشورة. الدستور فيه الداو وفيلق دم التنين وقسم الذكاء والمؤامرات (العم، الأمير التالت، رئيس الوزراء، ولي العهد = الخصم الذكي، طائفة الشمس السوداء، وفوقهم الهاوية).",
      "next": "الفصول 11–20 (جبال المخلب الأسود)، وبعدين 21–50 لحد نهاية القوس الأول.",
      "status": "active"
    },
    "one-piece": {
      "thread": "cmsg_013Yojd9E7FDP3d714WDucfyE4s3NC2ekbRCPDFV7e2Rpr",
      "thread_title": "ملك القراصنة يعود",
      "length": "800–1000 فصل",
      "premise": "إم يمحو إلباف، وطبول التحرير ترجّع لوفي والطاقم كله (9) لصباح إبحار لوفي من فوشا، بذكرياتهم كاملة لحد إلباف (~فصل 1195). الأجساد ضعيفة والخبرة باقية، و«نظام الطاقم».",
      "plan": "المجلد الأول «بحر الشرق» ف1–35: سيروب (7–12)، فواصل (13–14)، باراتي (15–20)، أرلونغ بارك وفخ الغراب (21–30)، لوغ تاون والجبل المعكوس (31–35). وبعده مجلد ورا مجلد.",
      "now": "واقفة عند الفصل 14 (قرار رواية واحدة في المرة). لما ترجع: طبّق قاعدة الأسماء الفخمة والفصحى على الفصول المكتوبة الأول.",
      "next": "الفصل 14 (فرانكي، بروك، جينبي) وبعده قوس باراتي.",
      "status": "paused"
    },
    "minato": {
      "thread": "cmsg_013Yojd9E7FDP3d714WDucfyM2FotsbzrMSR2wAbfLxqAW",
      "thread_title": "البرق الأصفر يعود",
      "length": "800–1000 فصل",
      "premise": "ميناتو يرجع من نهاية الحرب الرابعة لقبل تتويجه بيومين، و«نظام التطوير الشامل للقرية» يكتمل لما الثالث يحط القبعة على راسه. الهدف الكبير: الحرب ضد الأوتسوتسكي.",
      "plan": "القوس الأول «قبعة النار» ف1–30، وبعده أقواس قسم 4 في الدستور.",
      "now": "واقفة عند الفصل 19 (قرار رواية واحدة في المرة). لما ترجع: طبّق قاعدة الأسماء الفخمة والفصحى على الفصول المكتوبة الأول.",
      "next": "الفصول 15–30 مع النشر أول بأول، وغلاف cover.png للتطبيق.",
      "status": "paused"
    },
    "naruto-hokage": {
      "thread": "cmsg_013Yojd9E7FDP3d714WDucfyCrBDkUCUfmwJT3iKyksuv2",
      "thread_title": "ناروتو: أنا الهوكاجي",
      "length": "800–1000 فصل",
      "premise": "ناروتو الهوكاجي السابع (بعد موت كوراما) يرجع لسن 7 قبل مذبحة الأوتشيها بـ94 يوم، ومعاه «نظام الهوكاجي السابع» و«ختم الذاكرة» اللي يصحّي ذكريات المستقبل في غيره (أو يختمها).",
      "plan": "المجلد الأول «الريح التي لا تنطفئ» ف1–60، خطة فصل بفصل في قسم 10 من الدستور، وذروته إنقاذ شيسوي من دانزو.",
      "now": "واقفة عند الفصل 14 (قرار رواية واحدة في المرة). لما ترجع: طبّق قاعدة الأسماء الفخمة والفصحى على الفصول المكتوبة الأول.",
      "next": "الفصول 13–60، وبعدين المجلد التاني.",
      "status": "paused"
    },
    "sect-master": {
      "thread": "cmsg_013Yojd9E7FDP3d714WDucfyAsbeARMC7iS7wneL7knj7F",
      "thread_title": "سيد طائفة السماوات التسع",
      "length": "~5000 فصل (10 مجلدات)",
      "premise": "تشين شيوان (19) يورث طائفة السحاب الصافي (3 أفراد ودين 5000 حجر)، فيصحى «نظام الطائفة الشامل»، إرث طائفة السماوات التسع اللي حكمت الكون وحمته من غزاة الفراغ قبل مليون سنة.",
      "plan": "القوس الأول «الجبل لنا» ف1–20 (قسم 10 في الدستور): المطبخ، مستنقع الضباب، ملك الجياو، دم التنين، المعارك الثلاث، الذئب الشيطاني، العمود الأول.",
      "now": "واقفة عند الفصل 14 (قرار رواية واحدة في المرة). لما ترجع: طبّق قاعدة الأسماء الفخمة والفصحى على الفصول المكتوبة الأول.",
      "next": "باقي الفصول لحد 20 (آخر القوس)، وبعدين المجلد الأول.",
      "status": "paused"
    }
  },
  "mode": "رواية واحدة في المرة (قرار محمد 21 أكتوبر): «الإمبراطور العائد / إمبراطور النجوم التسع» هي الشغالة دلوقتي، والأربعة التانيين واقفين لحد ما يقول. الكتابة دفعة ورا دفعة بهدوء، والنشر أول بأول."
}

<<<<FILE: novel/fiction-empire/README.md>>>>
# Fiction Empire: روايات محمد جوه التطبيق

إضافة في LNReader عربي اسمها **Fiction Empire**، فيها الروايات الأصلية، كل رواية باسمها وغلافها وفصولها، تتقري وتتحمل من التطبيق.

## الفكرة
- كود الإضافة: `plugins/fictionempire.js` على `master` في `vetmohamed-arch/lnreader-arabic` (PR #15).
- المحتوى على فرع **`fiction-empire`** في نفس الريبو (`index.json` + `covers/` + `chapters/<id>/<NNN>.html` + `icon.png`)، والإضافة بتقراه من raw.githubusercontent.com. يعني أي push على الفرع ده بيظهر في التطبيق خلال دقيقة لـ 5 دقايق (اسحب لتحت في صفحة الرواية عشان تحدّث). ومن غير بناء APK.
- محمد طلب الإعداد ده بنفسه (21 أكتوبر 2026)، فالـ push على فرع `fiction-empire` مسموح للمزامنة.

## إزاي تنشر فصول جديدة
بعد ما تكتب فصل في `novel/<folder>/chapters/NNN.md`:

```
python3 /mnt/project-files/novel/fiction-empire/sync.py
```

السكربت بيدوّر على نسخة من `lnreader-arabic` في `/home/user/lnreader-arabic` (أو `--repo <path>`)، وبيبني كل حاجة من جديد ويعمل commit وpush على `fiction-empire` لو فيه تغيير. `--out <dir>` بيبني بس من غير نشر.

- عنوان الفصل = أول سطر `# ...` في الملف.
- **الأغلفة:** بيتاخد `covers/<id>.jpg` من هنا الأول (اترسمت بـ `cover-src/covers2.js` فوق لوحات قديمة ملكية عامة، المصادر في `cover-src/art/CREDITS.md`). غلاف فولدر الرواية (`cover.jpg`/`cover.png`) بيتاخد بس لو ملف الـ id ده مش موجود.
- **رواية جديدة أو تغيير الاسم أو الملخص أو التصنيفات أو الحالة:** عدّل `novels.json` (`status`: `Ongoing` أو `Completed`). الـ `id` متغيّروش، لأن التطبيق بيحفظ الرواية بيه.

| id | الفولدر | الاسم |
|---|---|---|
| nine-star-emperor | cultivation | إمبراطور النجوم التسع |
| nine-heavens-sect | sect-master | سيد طائفة السماوات التسع |
| pirate-king-returns | one-piece | ون بيس: ملك القراصنة يعود |
| yellow-flash-returns | minato | ناروتو: البرق الأصفر يعود |
| i-am-the-hokage | naruto-hokage | ناروتو: أنا الهوكاجي |

(فولدر `naruto/` القديم، "السابع يعود"، مش داخل لأن `naruto-hokage` حلّ مكانه.)

<<<<FILE: novel/mkepub.py>>>>
import zipfile, re, html, glob, os, sys, uuid
src = sys.argv[2]
out = sys.argv[1]
title = sys.argv[3]
def md2html(t):
    lines=[]; 
    for para in re.split(r'\n\s*\n', t.strip()):
        p=para.strip()
        if p=='---': lines.append('<hr/>'); continue
        if p.startswith('# '): lines.append(f'<h1>{html.escape(p[2:])}</h1>'); continue
        h=html.escape(p).replace('\n','<br/>')
        h=re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', h)
        h=re.sub(r'\*(.+?)\*', r'<i>\1</i>', h)
        lines.append(f'<p>{h}</p>')
    return '\n'.join(lines)
files=sorted(glob.glob(src+'/*.md'))
chs=[]
for f in files:
    t=open(f,encoding='utf-8').read()
    name=re.search(r'^# (.+)$',t,re.M).group(1)
    chs.append((os.path.basename(f)[:-3],name,md2html(t)))
css="body{direction:rtl;text-align:right;line-height:1.9;font-family:serif}h1{text-align:center}hr{margin:1.5em 20%}"
uid=str(uuid.uuid5(uuid.NAMESPACE_URL,title))
with zipfile.ZipFile(out,'w') as z:
    z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('OEBPS/style.css',css)
    man=[];spine=[];nav=[]
    for i,(fid,name,body) in enumerate(chs):
        x=f'<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ar" lang="ar" dir="rtl"><head><title>{html.escape(name)}</title><link rel="stylesheet" href="style.css"/></head><body>{body}</body></html>'
        z.writestr(f'OEBPS/c{fid}.xhtml',x,compress_type=zipfile.ZIP_DEFLATED)
        man.append(f'<item id="c{fid}" href="c{fid}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{fid}"/>')
        nav.append(f'<li><a href="c{fid}.xhtml">{html.escape(name)}</a></li>')
    z.writestr('OEBPS/nav.xhtml',f'<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ar" dir="rtl"><head><title>الفهرس</title></head><body><nav epub:type="toc"><h1>الفهرس</h1><ol>{"".join(nav)}</ol></nav></body></html>',compress_type=zipfile.ZIP_DEFLATED)
    ncx=''.join(f'<navPoint id="n{i}" playOrder="{i+1}"><navLabel><text>{html.escape(n)}</text></navLabel><content src="c{f}.xhtml"/></navPoint>' for i,(f,n,_) in enumerate(chs))
    z.writestr('OEBPS/toc.ncx',f'<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="{uid}"/></head><docTitle><text>{title}</text></docTitle><navMap>{ncx}</navMap></ncx>',compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('OEBPS/content.opf',f'<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid" dir="rtl"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:{uid}</dc:identifier><dc:title>{title}</dc:title><dc:language>ar</dc:language><dc:creator>محمد و Claude</dc:creator><meta property="dcterms:modified">2026-10-21T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>{"".join(man)}</manifest><spine toc="ncx" page-progression-direction="rtl">{"".join(spine)}</spine></package>',compress_type=zipfile.ZIP_DEFLATED)
print(len(chs),"chapters")

<<<<FILE: novel/fiction-empire/cover-src/covers2.js>>>>
// Fiction Empire covers v2: public-domain paintings (see art/CREDITS.md)
// under a graded overlay, gold frame and Arabic title. 800x1200 JPEG.
// Run: node covers2.js            (all)   node covers2.js <id> ...  (some)
const path = require('path');
const { chromium } = require(require('child_process')
  .execSync('npm root -g').toString().trim() + '/playwright');

const here = __dirname;
const out = path.join(here, '..', 'covers');
const art = f => `file://${path.join(here, 'art', f)}`;

const css = `
@font-face{font-family:Amiri;src:url(file://${here}/amiri.ttf)}
@font-face{font-family:Cairo;src:url(file://${here}/cairo.ttf)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:800px;height:1200px;overflow:hidden;background:#000}
.c{position:relative;width:800px;height:1200px;overflow:hidden;direction:rtl}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tint{position:absolute;inset:0}
.vig{position:absolute;inset:0;box-shadow:inset 0 0 220px 60px rgba(0,0,0,.85)}
.low{position:absolute;left:0;right:0;bottom:0;height:560px;
  background:linear-gradient(to bottom,rgba(0,0,0,0),rgba(0,0,0,.72) 38%,rgba(0,0,0,.93))}
.frame{position:absolute;inset:26px;border:2px solid var(--g);opacity:.8}
.frame:after{content:"";position:absolute;inset:9px;border:1px solid var(--g);opacity:.5}
.corner{position:absolute;width:46px;height:46px;border:3px solid var(--g)}
.tl{top:18px;left:18px;border-right:0;border-bottom:0}.tr{top:18px;right:18px;border-left:0;border-bottom:0}
.bl{bottom:18px;left:18px;border-right:0;border-top:0}.br{bottom:18px;right:18px;border-left:0;border-top:0}
.top{position:absolute;top:58px;left:0;right:0;text-align:center;font-family:Cairo;font-weight:700;
  font-size:22px;letter-spacing:2px;color:var(--g);text-shadow:0 2px 6px #000}
.block{position:absolute;left:50px;right:50px;bottom:92px;text-align:center}
.tag{font-family:Cairo;font-weight:600;font-size:25px;color:var(--g);text-shadow:0 2px 6px #000;margin-bottom:16px}
.orn{display:block;margin:0 auto 14px;width:340px;height:22px}
.t{font-family:Amiri;color:var(--tc);line-height:1.28;
  text-shadow:0 0 26px var(--glow),0 0 6px var(--glow),0 4px 10px #000}
.pre{font-size:50px;display:block;line-height:1.2;margin-bottom:6px}
.brand{position:absolute;bottom:46px;left:0;right:0;text-align:center;font-family:Cairo;font-weight:700;
  font-size:17px;letter-spacing:8px;color:var(--g);direction:ltr}
`;
const orn = c => `<svg class="orn" viewBox="0 0 340 22"><path d="M0 11H135M205 11H340" stroke="${c}" stroke-width="1.4"/>
<path d="M170 1l10 10-10 10-10-10z" fill="${c}"/><circle cx="146" cy="11" r="3" fill="${c}"/><circle cx="194" cy="11" r="3" fill="${c}"/></svg>`;

const covers = {
  'nine-star-emperor': {
    img: 'dragon.jpg', pos: '45% 28%', scale: 1.7, filter: 'contrast(1.7) brightness(1.35) saturate(.9) sepia(.5)',
    tint: 'radial-gradient(circle at 50% 30%,rgba(255,190,80,.18),rgba(20,10,60,.55) 70%)',
    vars: '--g:#e9c770;--tc:#fff4d2;--glow:#ff9d2e', top: 'شيانشيا · الجسد المهيمن · التنين النجمي',
    tag: 'الجسد معطوب... والسماء ستنحني', title: '<span style="font-size:96px">إمبراطور<br>النجوم التسع</span>',
  },
  'nine-heavens-sect': {
    img: 'mountain.jpg', pos: '50% 12%', scale: 1.1, filter: 'contrast(1.35) brightness(1.4) saturate(.9)',
    tint: 'linear-gradient(to bottom,rgba(10,40,45,.35),rgba(5,20,25,.15) 40%,rgba(0,0,0,0))',
    vars: '--g:#dcc683;--tc:#f4fff9;--glow:#4fe0bd', top: 'نظام الطائفة الشامل',
    tag: 'ثلاثة أفراد، ودَين... ونظام من زمن الآلهة', title: '<span style="font-size:92px">سيد طائفة<br>السماوات التسع</span>',
  },
  // Not drawn by default: Mohamed's chosen One Piece cover is the novel
  // thread's Ninth Wave one (one-piece/cover.jpg), copied into ../covers.
  'pirate-king-returns': {
    manual: true,
    img: 'wave.jpg', pos: '24% 50%', scale: 1, filter: 'contrast(1.1) saturate(1.15)',
    tint: 'linear-gradient(to bottom,rgba(120,20,10,.15),rgba(0,0,0,0) 45%)',
    vars: '--g:#f2c86a;--tc:#fff8ea;--glow:#ff5a36', top: 'رواية معجبين · نظام الطاقم',
    tag: 'الطاقم كله يعود... والطبول ما زالت تدق', title: '<span class="pre">ون بيس</span><span style="font-size:88px">ملك القراصنة يعود</span>',
  },
  'yellow-flash-returns': {
    img: 'thunder.jpg', pos: '30% 30%', scale: 1, filter: 'contrast(1.2) saturate(1.2)',
    tint: 'linear-gradient(to bottom,rgba(10,20,60,.25),rgba(0,0,0,0) 50%)',
    vars: '--g:#ffd84a;--tc:#fffbe8;--glow:#ffbf00', top: 'رواية معجبين · نظام تطوير القرية',
    tag: 'قبل التتويج بيومين... يبدأ كل شيء من جديد', title: '<span class="pre">ناروتو</span><span style="font-size:90px">البرق الأصفر يعود</span>',
  },
  'i-am-the-hokage': {
    img: 'fox.jpg', pos: '60% 0%', scale: 1.3, filter: 'contrast(1.12) saturate(1.1)',
    tint: 'linear-gradient(to bottom,rgba(255,110,0,.12),rgba(0,0,0,0) 50%)',
    vars: '--g:#ff9f45;--tc:#fff5ea;--glow:#ff6a00', top: 'رواية معجبين · ختم الذاكرة',
    tag: 'السابع يعود إلى طفولته... قبل ليلة القمر الدموي', title: '<span class="pre">ناروتو</span><span style="font-size:100px">أنا الهوكاجي</span>',
  },
};

(async () => {
  const only = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
  for (const [id, c] of Object.entries(covers)) {
    if (only.length ? !only.includes(id) : c.manual) continue;
    const g = c.vars.match(/--g:([^;]+)/)[1];
    const file = path.join(here, '.render.html');
    require('fs').writeFileSync(file, `<html><head><style>${css}</style></head><body><div class="c" style="${c.vars}">
<img class="bg" src="${art(c.img)}" style="object-position:${c.pos};filter:${c.filter};transform:scale(${c.scale});transform-origin:${c.pos}">
<div class="tint" style="background:${c.tint}"></div><div class="vig"></div><div class="low"></div>
<div class="frame"></div><div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
<div class="top">${c.top}</div>
<div class="block"><div class="tag">${c.tag}</div>${orn(g)}<div class="t">${c.title}</div></div>
<div class="brand">FICTION EMPIRE</div></div></body></html>`);
    await page.goto('file://' + file);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    await page.screenshot({ path: path.join(out, id + '.jpg'), type: 'jpeg', quality: 90 });
    console.log('cover', id);
  }
  await browser.close();
})();

<<<<FILE: novel/fiction-empire/cover-src/art/CREDITS.md>>>>
# Cover art sources (all public domain / CC0, via Wikimedia Commons)

- dragon.jpg: Anonymous, Ming dynasty, "Dragon Amid Clouds and Waves" (Metropolitan Museum of Art 2007.438), CC0.
- mountain.jpg: Fan Kuan, "Travelers Among Mountains and Streams" (Song dynasty, National Palace Museum), public domain.
- wave.jpg: Katsushika Hokusai, "Under the Wave off Kanagawa" (MET DP141063), CC0.
- thunder.jpg: Tawaraya Sōtatsu, "The Gods of Wind and Thunder", left screen (Raijin), public domain.
- fox.jpg: Utagawa Kuniyoshi, "Prince Hanzoku terrorised by a nine-tailed fox", public domain.

