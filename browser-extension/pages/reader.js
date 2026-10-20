import { getNovel, getChapter, chapterIds, listChapters, putChapter, updateNovel } from '../lib/db.js';
import { getSettings, setSettings, FONTS } from '../lib/settings.js';
import { translateChapter } from '../lib/translate.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const novelId = params.get('novel');

let novel;
let ids = [];
let chapter;
let settings;
let showOriginal = false; // this chapter only: the reader asked for the original

const isRtlText = text => {
  const sample = String(text).slice(0, 600);
  const rtl = (sample.match(/[֐-ࣿ]/g) || []).length;
  const ltr = (sample.match(/[A-Za-zÀ-ɏЀ-ӿ]/g) || []).length;
  return rtl > ltr;
};

function applyLook() {
  document.body.dataset.theme = settings.theme;
  const page = $('page');
  page.style.fontSize = `${settings.fontSize}px`;
  page.style.lineHeight = settings.lineHeight;
  page.style.maxWidth = `${settings.width}px`;
  page.style.fontFamily = FONTS[settings.font] || FONTS.system;
  page.style.textAlign = settings.align === 'justify' ? 'justify' : 'start';
  $('pager').style.maxWidth = `${settings.width}px`;
  $('fontSizeVal').textContent = settings.fontSize;
  $('lineHeightVal').textContent = settings.lineHeight.toFixed(1);
  $('widthVal').textContent = settings.width;
  for (const k of ['font', 'direction', 'align']) $(k).value = settings[k];
  for (const k of ['showTranslation', 'autoTranslate', 'bilingual']) $(k).checked = settings[k];
}

function currentTranslation() {
  return chapter?.translations?.[settings.targetLang] || null;
}

function render() {
  const tr = currentTranslation();
  const useTr = tr && settings.showTranslation && !showOriginal;
  const title = useTr ? tr.title : chapter.title;
  const paragraphs = useTr ? tr.paragraphs : chapter.paragraphs;
  const page = $('page');
  const dir = settings.direction === 'auto' ? (isRtlText(paragraphs.map(p => p.x).join(' ')) ? 'rtl' : 'ltr') : settings.direction;
  page.dir = dir;
  page.lang = useTr ? settings.targetLang : dir === 'rtl' ? 'ar' : '';
  const nodes = [];
  const h1 = document.createElement('h1');
  h1.textContent = title;
  nodes.push(h1);
  paragraphs.forEach((p, i) => {
    if (useTr && settings.bilingual && chapter.paragraphs[i]) {
      const o = document.createElement('p');
      o.className = 'orig';
      o.dir = 'auto';
      o.textContent = chapter.paragraphs[i].x;
      nodes.push(o);
    }
    const n = document.createElement(p.t === 'h' ? 'h3' : 'p');
    n.textContent = p.x;
    nodes.push(n);
  });
  page.replaceChildren(...nodes);
  document.title = `${title} · ${novel.title}`;
  $('translate').textContent = tr ? (useTr ? 'الأصلي' : 'المترجم') : 'ترجم';
  const at = ids.indexOf(chapter.id);
  $('prev').disabled = at <= 0;
  $('next').disabled = at < 0 || at >= ids.length - 1;
  $('pager').hidden = false;
  for (const a of $('toc').querySelectorAll('a')) a.classList.toggle('cur', a.dataset.id === chapter.id);
}

function note(text) {
  const p = document.createElement('p');
  p.id = 'note';
  p.className = 'muted';
  p.textContent = text;
  $('page').prepend(p);
  return p;
}

async function translateCurrent() {
  const target = chapter;
  const n = note('بيترجم الفصل...');
  $('translate').disabled = true;
  try {
    const tr = await translateChapter(target, { ...settings, novelGlossary: novel.glossary });
    target.translations = { ...(target.translations || {}), [settings.targetLang]: tr };
    await putChapter(target);
    if (chapter === target) {
      showOriginal = false;
      render();
    }
  } catch (e) {
    n.textContent = `الترجمة ما نفعتش: ${e.message}. محتاج نت للترجمة أول مرة بس.`;
    n.classList.add('error');
  } finally {
    $('translate').disabled = false;
  }
}

async function open(id, { scroll = 0 } = {}) {
  const next = await getChapter(id);
  if (!next) return;
  chapter = next;
  showOriginal = false;
  render();
  window.scrollTo(0, scroll * (document.documentElement.scrollHeight - innerHeight));
  history.replaceState(null, '', `?novel=${encodeURIComponent(novelId)}&chapter=${encodeURIComponent(id)}`);
  await updateNovel(novelId, { lastRead: { chapterId: id, title: chapter.title, scroll } });
  if (settings.autoTranslate && !chapter.translations?.[settings.targetLang]) translateCurrent();
}

function step(delta) {
  const at = ids.indexOf(chapter.id) + delta;
  if (at >= 0 && at < ids.length) open(ids[at]);
}

async function fillToc() {
  const chapters = await listChapters(novelId);
  const q = $('tocSearch').value.trim().toLowerCase();
  const links = chapters
    .filter(c => !q || `${c.order} ${c.title} ${c.translations?.[settings.targetLang]?.title || ''}`.toLowerCase().includes(q))
    .map(c => {
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.id = c.id;
      a.textContent = `${c.order}. ${c.translations?.[settings.targetLang]?.title || c.title}`;
      a.dir = 'auto';
      a.onclick = e => {
        e.preventDefault();
        $('tocPanel').hidden = true;
        open(c.id);
      };
      if (c.id === chapter?.id) a.className = 'cur';
      return a;
    });
  $('toc').replaceChildren(...links);
  $('toc').querySelector('.cur')?.scrollIntoView({ block: 'center' });
}

async function change(patch) {
  settings = await setSettings(patch);
  applyLook();
  if (chapter) render();
}

// ---------- events ----------

$('back').onclick = () => (location.href = chrome.runtime.getURL('pages/library.html'));
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('translate').onclick = () => {
  if (!chapter) return;
  if (chapter.translations?.[settings.targetLang]) {
    if (!settings.showTranslation) {
      showOriginal = false;
      change({ showTranslation: true });
    } else {
      showOriginal = !showOriginal;
      render();
    }
  } else translateCurrent();
};
$('tocBtn').onclick = () => {
  $('setPanel').hidden = true;
  $('tocPanel').hidden = !$('tocPanel').hidden;
  if (!$('tocPanel').hidden) fillToc();
};
$('tocSearch').oninput = fillToc;
$('setBtn').onclick = () => {
  $('tocPanel').hidden = true;
  $('setPanel').hidden = !$('setPanel').hidden;
};
for (const b of document.querySelectorAll('[data-theme-btn]')) b.onclick = () => change({ theme: b.dataset.themeBtn });
for (const b of document.querySelectorAll('[data-step]')) {
  b.onclick = () => {
    const [k, d] = b.dataset.step.split(':');
    const limits = { fontSize: [12, 40], lineHeight: [1.2, 3], width: [400, 1400] };
    const v = Math.round((settings[k] + Number(d)) * 10) / 10;
    change({ [k]: Math.min(limits[k][1], Math.max(limits[k][0], v)) });
  };
}
for (const k of ['font', 'direction', 'align']) $(k).onchange = () => change({ [k]: $(k).value });
for (const k of ['showTranslation', 'autoTranslate', 'bilingual']) {
  $(k).onchange = () => {
    change({ [k]: $(k).checked });
    if (k === 'autoTranslate' && $(k).checked && chapter && !chapter.translations?.[settings.targetLang]) translateCurrent();
  };
}
document.addEventListener('click', e => {
  if (!e.target.closest('.panel, #bar')) $('tocPanel').hidden = $('setPanel').hidden = true;
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  const rtl = $('page').dir === 'rtl';
  if (e.key === 'ArrowRight') step(rtl ? -1 : 1);
  else if (e.key === 'ArrowLeft') step(rtl ? 1 : -1);
  else if (e.key === 'n') step(1);
  else if (e.key === 'p') step(-1);
});

let lastY = 0;
let saveTimer;
addEventListener('scroll', () => {
  const y = scrollY;
  $('bar').classList.toggle('hide', y > lastY && y > 80);
  lastY = y;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!chapter) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    updateNovel(novelId, { lastRead: { chapterId: chapter.id, title: chapter.title, scroll: max > 0 ? scrollY / max : 0 } });
  }, 600);
});

// ---------- adding a selected word to the novel's glossary ----------

const addTerm = $('addTerm');
document.addEventListener('mouseup', e => {
  if (e.target === addTerm) return;
  setTimeout(() => {
    const sel = getSelection();
    const term = sel.toString().replace(/\s+/g, ' ').trim();
    if (!term || term.length > 60 || !$('page').contains(sel.anchorNode)) {
      addTerm.hidden = true;
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    addTerm.style.top = `${scrollY + r.bottom + 8}px`;
    addTerm.style.left = `${Math.max(8, scrollX + r.left + r.width / 2 - 60)}px`;
    addTerm.dataset.term = term;
    addTerm.hidden = false;
  });
});
addTerm.onclick = async () => {
  const term = addTerm.dataset.term;
  addTerm.hidden = true;
  const isArabic = /[\u0600-\u06FF]/.test(term);
  const answer = prompt(
    isArabic ? `الكلمة «${term}» تتكتب إزاي بدالها في الترجمة؟` : `«${term}» تتترجم إيه بالعربي؟ (هتفضل كده في كل فصول الرواية دي)`,
  );
  if (!answer || !answer.trim()) return;
  const line = `${term} = ${answer.trim()}`;
  novel.glossary = novel.glossary ? `${novel.glossary.trimEnd()}\n${line}` : line;
  await updateNovel(novelId, { glossary: novel.glossary });
  if (chapter?.translations?.[settings.targetLang]) await translateCurrent();
  else note(`اتضافت للقاموس: ${line}`);
};

// ---------- start ----------

(async () => {
  settings = await getSettings();
  applyLook();
  novel = await getNovel(novelId);
  if (novel?.newCount) {
    await updateNovel(novelId, { newCount: 0 });
    chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  }
  if (!novel) {
    $('note').textContent = 'الرواية دي مش في المكتبة.';
    return;
  }
  $('novelTitle').textContent = novel.title;
  ids = await chapterIds(novelId);
  if (!ids.length) {
    $('note').textContent = 'مفيش فصول محفوظة للرواية دي لسه.';
    return;
  }
  const wanted = params.get('chapter');
  const start = ids.includes(wanted) ? wanted : ids[0];
  const scroll = novel.lastRead?.chapterId === start ? novel.lastRead.scroll || 0 : 0;
  await open(start, { scroll });
})();
