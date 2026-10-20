import { listNovels, listChapters, deleteNovel, deleteChapter, saveNovel, saveChapter, putChapter, novelIdFor, updateNovel } from '../lib/db.js';
import { makeBackup, restoreBackup } from '../lib/backup.js';
import { getSettings, setSettings } from '../lib/settings.js';
import { translateChapter, translationKey } from '../lib/translate.js';
import { buildEpub, buildHtml, buildTxt, download, importEpub, importText } from '../lib/books.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined));
  return node;
};

let novels = [];
const counts = {};
const busy = new Map(); // novelId -> { cancelled }

function message(text) {
  $('msg').hidden = !text;
  $('msg').textContent = text || '';
}

function readerUrl(novelId, chapterId) {
  const q = new URLSearchParams({ novel: novelId });
  if (chapterId) q.set('chapter', chapterId);
  return chrome.runtime.getURL(`pages/reader.html?${q}`);
}

async function load() {
  novels = await listNovels();
  const s = await getSettings();
  for (const n of novels) {
    const chapters = await listChapters(n.id);
    const key = translationKey({ ...s, novelGlossary: n.glossary });
    counts[n.id] = {
      total: chapters.length,
      translated: chapters.filter(c => c.translations?.[s.targetLang]?.glossary === key).length,
    };
  }
  render();
  showUpdateState();
}

const when = t =>
  new Date(t).toLocaleString('ar-EG', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

async function showUpdateState() {
  const { updateState: u = {} } = await chrome.storage.local.get('updateState');
  const s = await getSettings();
  $('checkBtn').disabled = !!u.running;
  if (u.running) {
    $('updateStatus').textContent = `بشيّك على الجديد (${u.progress || ''}): ${u.current || ''}`;
    return;
  }
  const parts = [];
  if (u.lastCheck) {
    const found = (u.results || []).reduce((t, r) => t + r.found, 0);
    parts.push(`آخر تشييك: ${when(u.lastCheck)}، ولقيت ${found} فصل جديد.`);
  }
  parts.push(s.checkHours ? `بيشيّك لوحده كل ${s.checkHours} ساعة على الروايات المتابَعة.` : 'المتابعة التلقائية مقفولة من الإعدادات.');
  $('updateStatus').textContent = parts.join(' ');
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const shown = novels.filter(n => !q || `${n.title} ${n.author || ''} ${n.host || ''}`.toLowerCase().includes(q));
  $('empty').hidden = novels.length > 0;
  $('grid').replaceChildren(...shown.map(card));
}

function card(n) {
  const c = counts[n.id] || { total: 0, translated: 0 };
  const cover = n.cover
    ? el('img', { className: 'cover', src: n.cover, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror() { this.replaceWith(el('div', { className: 'cover' }, '📖')); } })
    : el('div', { className: 'cover' }, '📖');
  const progress = el('div', { className: 'progress' });
  const list = el('div', { className: 'chapters', hidden: true });

  const exportSel = el(
    'select',
    { title: 'تصدير' },
    el('option', { value: '' }, 'تصدير...'),
    el('option', { value: 'epub' }, 'EPUB (الأصلي)'),
    el('option', { value: 'epub-ar' }, 'EPUB (المترجم)'),
    el('option', { value: 'html' }, 'صفحة HTML واحدة'),
    el('option', { value: 'html-ar' }, 'صفحة HTML (المترجم)'),
    el('option', { value: 'txt' }, 'TXT'),
  );
  exportSel.onchange = async () => {
    const kind = exportSel.value;
    exportSel.value = '';
    if (!kind) return;
    const chapters = await listChapters(n.id);
    const s = await getSettings();
    const opts = { useTranslation: kind.endsWith('-ar'), lang: s.targetLang };
    const name = n.title + (opts.useTranslation ? ' - عربي' : '');
    if (kind.startsWith('epub')) download(buildEpub(n, chapters, opts), `${name}.epub`);
    else if (kind.startsWith('html')) download(buildHtml(n, chapters, opts), `${name}.html`);
    else download(buildTxt(n, chapters, opts), `${name}.txt`);
  };

  const translateBtn = el('button', { textContent: c.translated >= c.total && c.total ? 'مترجمة ✓' : 'ترجم الكل' });
  translateBtn.onclick = () => translateAll(n, translateBtn, progress);

  const toggle = el('button', { textContent: 'الفصول' });
  toggle.onclick = async () => {
    list.hidden = !list.hidden;
    if (!list.hidden) await fillChapters(n, list);
  };

  const del = el('button', { className: 'danger', textContent: 'احذف' });
  del.onclick = async () => {
    if (!confirm(`تحذف «${n.title}» وكل فصولها من المكتبة؟`)) return;
    await deleteNovel(n.id);
    await load();
  };

  const lastRead = n.lastRead?.title ? `آخر فصل قريته: ${n.lastRead.title}` : 'لسه ما بدأتهاش';
  const canFollow = n.source !== 'file';
  const follow = el('input', { type: 'checkbox', checked: n.follow !== false });
  follow.onchange = () => updateNovel(n.id, { follow: follow.checked });
  const glossaryBtn = el('button', { textContent: n.glossary ? 'القاموس ✓' : 'القاموس', onclick: () => editGlossary(n) });
  const checkOne = el('button', { textContent: 'شيّك عليها', onclick: () => chrome.runtime.sendMessage({ type: 'checkNow', novelIds: [n.id] }) });
  return el(
    'article',
    { className: 'card' },
    el(
      'div',
      { className: 'novel' },
      cover,
      el(
        'div',
        { className: 'grow' },
        el('h2', {}, el('bdi', {}, n.title), n.newCount ? el('span', { className: 'tag new', dir: 'rtl' }, `${n.newCount} جديد`) : null),
        el('div', { className: 'muted' }, [n.author, n.host].filter(Boolean).join(' · ')),
        el('div', { className: 'muted' }, `${c.total} فصل · ${c.translated} مترجم`),
        el('div', { className: 'muted' }, lastRead),
        n.lastError ? el('div', { className: 'muted error' }, `آخر تشييك: ${n.lastError}`) : null,
        el(
          'div',
          { className: 'actions' },
          el('button', { className: 'primary', textContent: n.lastRead ? 'كمّل قراءة' : 'اقرأ', onclick: () => (location.href = readerUrl(n.id, n.lastRead?.chapterId)), disabled: !c.total }),
          toggle,
          translateBtn,
          glossaryBtn,
          exportSel,
          canFollow ? checkOne : null,
          /^https?:/.test(n.tocUrl || n.url || '') ? el('button', { textContent: 'الموقع', onclick: () => chrome.tabs.create({ url: n.tocUrl || n.url }) }) : null,
          del,
        ),
        canFollow ? el('label', { className: 'row muted' }, follow, 'تابع الفصول الجديدة') : null,
        progress,
      ),
    ),
    list,
  );
}

async function fillChapters(n, list) {
  const chapters = await listChapters(n.id);
  const s = await getSettings();
  list.replaceChildren(
    ...chapters.map(ch => {
      const tr = ch.translations?.[s.targetLang];
      const x = el('button', { className: 'x', title: 'احذف الفصل', textContent: '✕' });
      x.onclick = async () => {
        await deleteChapter(ch.id);
        await fillChapters(n, list);
        counts[n.id].total--;
      };
      return el(
        'div',
        { className: 'row' },
        el('span', { className: 'muted' }, String(ch.order)),
        el('a', { className: 'grow', href: readerUrl(n.id, ch.id), title: ch.title }, tr?.title || ch.title),
        tr ? el('span', { className: 'tag' }, 'ع') : null,
        x,
      );
    }),
  );
}

async function translateAll(n, button, progress) {
  if (busy.has(n.id)) {
    busy.get(n.id).cancelled = true;
    return;
  }
  const job = { cancelled: false };
  busy.set(n.id, job);
  button.textContent = 'وقّف الترجمة';
  const s = { ...(await getSettings()), novelGlossary: (await listNovels()).find(x => x.id === n.id)?.glossary };
  const key = translationKey(s);
  const chapters = (await listChapters(n.id)).filter(c => c.translations?.[s.targetLang]?.glossary !== key);
  let done = 0;
  try {
    for (const ch of chapters) {
      if (job.cancelled) break;
      progress.textContent = `بترجم ${done + 1} من ${chapters.length}: ${ch.title}`;
      const tr = await translateChapter(ch, s);
      ch.translations = { ...(ch.translations || {}), [s.targetLang]: tr };
      await putChapter(ch);
      done++;
    }
    progress.textContent = job.cancelled ? `وقفت. اترجم ${done} فصل.` : `خلصت! اترجم ${done} فصل، وتقدر تقراهم من غير نت.`;
  } catch (e) {
    progress.textContent = `الترجمة وقفت: ${e.message}. اتأكد إن النت شغال وجرب تاني.`;
  } finally {
    busy.delete(n.id);
    counts[n.id].translated += done;
    button.textContent = 'ترجم الكل';
  }
}

let glossaryNovel = null;
function editGlossary(n) {
  glossaryNovel = n;
  $('ngTitle').textContent = `قاموس «${n.title}»`;
  $('ngText').value = n.glossary || '';
  $('novelGlossary').showModal();
}

$('ngSave').onclick = async () => {
  const n = glossaryNovel;
  await updateNovel(n.id, { glossary: $('ngText').value });
  if ($('ngRetranslate').checked) {
    // Only chapters that were translated before; the rest wait for "ترجم الكل".
    const translated = (await listChapters(n.id)).filter(c => c.translations && Object.keys(c.translations).length);
    if (translated.length) {
      message(`بعيد ترجمة ${translated.length} فصل بالقاموس الجديد...`);
      const s = { ...(await getSettings()), novelGlossary: $('ngText').value };
      let done = 0;
      try {
        for (const ch of translated) {
          ch.translations = { ...ch.translations, [s.targetLang]: await translateChapter(ch, s) };
          await putChapter(ch);
          message(`بعيد الترجمة: ${++done} من ${translated.length}`);
        }
        message(`خلصت إعادة ترجمة ${done} فصل.`);
      } catch (e) {
        message(`إعادة الترجمة وقفت بعد ${done} فصل: ${e.message}`);
      }
    }
  }
  await load();
};

async function importFiles(files) {
  for (const file of files) {
    try {
      message(`بستورد ${file.name}...`);
      const book = /\.epub$/i.test(file.name) ? await importEpub(file) : await importText(file);
      if (!book.chapters.length) throw new Error('ما لقيتش فيه نص');
      const novel = await saveNovel({ id: novelIdFor('local', book.title), title: book.title, author: book.author, summary: book.summary, host: 'ملف', source: 'file' });
      let order = 1;
      for (const ch of book.chapters) {
        await saveChapter(novel.id, { key: ch.key || `i${order}`, order, title: ch.title, paragraphs: ch.paragraphs });
        order++;
      }
      message(`اتستورد «${book.title}» (${book.chapters.length} فصل).`);
    } catch (e) {
      message(`مقدرتش أستورد ${file.name}: ${e.message}`);
    }
  }
  await load();
}

$('search').oninput = render;
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = e => importFiles([...e.target.files]);

$('checkBtn').onclick = async () => {
  $('checkBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'checkNow' });
};
$('backupBtn').onclick = async () => {
  message('بجهّز النسخة الاحتياطية...');
  const { blob, novels: count } = await makeBackup();
  download(blob, `LNReader-backup-${new Date().toISOString().slice(0, 10)}.json.gz`);
  message(`اتعملت نسخة احتياطية فيها ${count} رواية. احتفظ بالملف في مكان آمن (Google Drive مثلًا).`);
};
$('restoreBtn').onclick = () => $('restoreFile').click();
$('restoreFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    message('بسترجع النسخة الاحتياطية...');
    const r = await restoreBackup(file);
    message(`اترجعت ${r.novels} رواية و${r.chapters} فصل.`);
  } catch (err) {
    message(`مقدرتش أسترجع الملف: ${err.message}`);
  }
  e.target.value = '';
  await load();
};

$('settingsBtn').onclick = async () => {
  const s = await getSettings();
  $('checkHours').value = String(s.checkHours);
  $('autoTranslateNew').checked = s.autoTranslateNew;
  $('notify').checked = s.notify;
  $('engine').value = s.engine;
  $('builtinGlossary').checked = s.builtinGlossary;
  $('glossary').value = s.glossary;
  $('delayMs').value = s.delayMs;
  $('settings').showModal();
};
$('saveSettings').onclick = async () => {
  await setSettings({
    engine: $('engine').value,
    builtinGlossary: $('builtinGlossary').checked,
    glossary: $('glossary').value,
    delayMs: Number($('delayMs').value) || 0,
    checkHours: Number($('checkHours').value),
    autoTranslateNew: $('autoTranslateNew').checked,
    notify: $('notify').checked,
  });
  await load();
};

// Refresh when a download in another tab saves chapters.
let refresh;
chrome.storage.onChanged.addListener(changes => {
  clearTimeout(refresh);
  refresh = setTimeout(changes.updateState?.newValue?.running ? showUpdateState : load, 150);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clearTimeout(refresh);
    refresh = setTimeout(load, 200);
  }
});

load();
