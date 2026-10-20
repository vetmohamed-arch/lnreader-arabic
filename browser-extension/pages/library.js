import { listNovels, listChapters, deleteNovel, deleteChapter, saveNovel, saveChapter, putChapter, novelIdFor } from '../lib/db.js';
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
  for (const n of novels) {
    const chapters = await listChapters(n.id);
    const s = await getSettings();
    const key = translationKey(s);
    counts[n.id] = {
      total: chapters.length,
      translated: chapters.filter(c => c.translations?.[s.targetLang]?.glossary === key).length,
    };
  }
  render();
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
        el('h2', {}, n.title),
        el('div', { className: 'muted' }, [n.author, n.host].filter(Boolean).join(' · ')),
        el('div', { className: 'muted' }, `${c.total} فصل · ${c.translated} مترجم`),
        el('div', { className: 'muted' }, lastRead),
        el(
          'div',
          { className: 'actions' },
          el('button', { className: 'primary', textContent: n.lastRead ? 'كمّل قراءة' : 'اقرأ', onclick: () => (location.href = readerUrl(n.id, n.lastRead?.chapterId)), disabled: !c.total }),
          toggle,
          translateBtn,
          exportSel,
          n.url && /^https?:/.test(n.url) ? el('button', { textContent: 'الموقع', onclick: () => chrome.tabs.create({ url: n.url }) }) : null,
          del,
        ),
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
  const s = await getSettings();
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

$('settingsBtn').onclick = async () => {
  const s = await getSettings();
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
  });
  await load();
};

// Refresh when a download in another tab saves chapters.
let refresh;
chrome.storage.onChanged.addListener(() => load());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clearTimeout(refresh);
    refresh = setTimeout(load, 200);
  }
});

load();
