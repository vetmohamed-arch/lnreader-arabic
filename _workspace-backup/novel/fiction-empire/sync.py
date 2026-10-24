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
