// Chapter translation, ported from the LNReader Arabic app
// (src/services/translate). Edge's keyless endpoint first since it reads best,
// Google's when Edge is down. Both are undocumented and may change. The
// extension's host permission lets these pages call them without CORS.

import { BUILTIN_GLOSSARY } from './glossary-builtin.js';

const EDGE_URL = 'https://edge.microsoft.com/translate/translatetext';
const GOOGLE_URL = 'https://translate.googleapis.com/translate_a/single';

// Edge rejects requests over 1000 strings or 50k characters; Google ~5k.
const EDGE_MAX_ITEMS = 1000;
const EDGE_MAX_CHARS = 40000;
const GOOGLE_MAX_CHARS = 4000;

async function edgeRequest(texts, to, from) {
  const res = await fetch(
    `${EDGE_URL}?from=${from}&to=${to}&isEnterpriseClient=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
    },
  );
  if (!res.ok) throw new Error(`Edge ${res.status}`);
  const data = await res.json();
  return data.map(item =>
    typeof item === 'string' ? item : item?.translations?.[0]?.text ?? '',
  );
}

async function googleRequest(text, to, from) {
  const res = await fetch(
    `${GOOGLE_URL}?client=gtx&sl=${from || 'auto'}&tl=${to}&dt=t`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(text)}`,
    },
  );
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  return (data[0] || []).map(s => s[0]).join('');
}

async function inBatches(texts, maxItems, maxChars, send) {
  const out = [];
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (batch.length) out.push(...(await send(batch)));
    batch = [];
    size = 0;
  };
  for (const text of texts) {
    if (batch.length >= maxItems || (batch.length && size + text.length > maxChars)) {
      await flush();
    }
    batch.push(text);
    size += text.length + 1;
  }
  await flush();
  return out;
}

export function translateWithEdge(texts, to = 'ar', from = '') {
  return inBatches(texts, EDGE_MAX_ITEMS, EDGE_MAX_CHARS, b => edgeRequest(b, to, from));
}

/** Joins paragraphs with newlines, which Google keeps; retries one by one if not. */
export function translateWithGoogle(texts, to = 'ar', from = '') {
  return inBatches(texts, Infinity, GOOGLE_MAX_CHARS, async batch => {
    const lines = (await googleRequest(batch.join('\n'), to, from)).split('\n');
    if (lines.length === batch.length) return lines;
    const one = [];
    for (const t of batch) one.push(await googleRequest(t, to, from));
    return one;
  });
}

export async function translateTexts(texts, to = 'ar', from = '', engine = 'auto') {
  if (engine === 'google') return translateWithGoogle(texts, to, from);
  try {
    return await translateWithEdge(texts, to, from);
  } catch (edgeError) {
    if (engine === 'edge') throw edgeError;
    try {
      return await translateWithGoogle(texts, to, from);
    } catch (googleError) {
      throw new Error(`${edgeError.message}; ${googleError.message}`);
    }
  }
}

// ---------- glossary ----------

const WORD_CHAR = 'A-Za-z0-9\\u0600-\\u06FF';
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseGlossary(text) {
  return String(text || '')
    .split('\n')
    .flatMap(line => {
      const at = line.indexOf('=');
      if (at < 0) return [];
      const from = line.slice(0, at).trim();
      const to = line.slice(at + 1).trim();
      return from && to ? [{ from, to }] : [];
    })
    .filter(
      (e, i, all) => all.findIndex(o => o.from.toLowerCase() === e.from.toLowerCase()) === i,
    )
    .sort((a, b) => b.from.length - a.from.length);
}

export function applyGlossary(text, entries) {
  return entries.reduce(
    (result, { from, to }) =>
      result.replace(
        new RegExp(`(^|[^${WORD_CHAR}])${escapeRegExp(from)}(?=[^${WORD_CHAR}]|$)`, 'gi'),
        (_m, before) => before + to,
      ),
    text,
  );
}

export function glossaryKey(entries) {
  if (!entries.length) return '';
  let hash = 0;
  for (const ch of JSON.stringify(entries)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

export function effectiveGlossary(user, useBuiltin) {
  return useBuiltin ? `${user || ''}\n${BUILTIN_GLOSSARY}` : user || '';
}

/** The novel's own glossary first, then the user's, then the built-in one. */
function glossaryFor(settings) {
  const own = [settings.novelGlossary, settings.glossary].filter(Boolean).join('\n');
  return parseGlossary(effectiveGlossary(own, settings.builtinGlossary !== false));
}

/**
 * Glossary terms put Arabic inside the source text and auto-detection would
 * then return it untranslated, so mostly-Latin chapters are sent as English.
 */
export function detectSource(texts) {
  const all = texts.join('');
  const latin = (all.match(/[A-Za-z]/g) || []).length;
  const letters = (
    all.match(
      /[A-Za-zÀ-ɏ؀-ۿ぀-ヿ一-鿿가-힯Ѐ-ӿ]/g,
    ) || []
  ).length;
  return letters && latin / letters > 0.8 ? 'en' : '';
}

/**
 * Translates a saved chapter ({ title, paragraphs }) and returns
 * { title, paragraphs, glossary } in the same shape.
 */
export async function translateChapter(chapter, settings = {}) {
  const to = settings.targetLang || 'ar';
  const entries = glossaryFor(settings);
  const originals = [chapter.title || '', ...chapter.paragraphs.map(p => p.x)];
  const texts = originals.map(t => applyGlossary(t, entries) || ' ');
  const out = await translateTexts(texts, to, detectSource(originals), settings.engine || 'auto');
  const fix = t => applyGlossary(t || '', entries);
  return {
    title: fix(out[0]) || chapter.title,
    paragraphs: chapter.paragraphs.map((p, i) => ({ t: p.t, x: fix(out[i + 1]) })),
    glossary: glossaryKey(entries),
  };
}

export function translationKey(settings = {}) {
  return glossaryKey(glossaryFor(settings));
}
