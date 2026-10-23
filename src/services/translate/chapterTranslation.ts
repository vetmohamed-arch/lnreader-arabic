import NativeFile from '@modules/native-file';
import { TRANSLATION_STORAGE } from '@utils/Storages';
import { getMMKVObject, MMKVStorage, setMMKVObject } from '@utils/mmkv/mmkv';
import {
  CHAPTER_GENERAL_SETTINGS,
  ChapterGeneralSettings,
} from '@hooks/persisted/useSettings';
import {
  escapeHtml,
  extractParagraphs,
  translateTexts as translateWithEdge,
} from './microsoftTranslator';
import { translateWithGoogle } from './googleTranslator';
import { applyGlossary, glossaryKey, parseGlossary } from './glossary';
import { BUILTIN_GLOSSARY } from './builtinGlossary';
import { DEFAULT_GEMINI_MODEL, translateWithGemini } from './geminiTranslator';

/** Where the last Gemini failure is kept, so settings can show why. */
export const GEMINI_LAST_ERROR = 'GEMINI_LAST_ERROR';

type EngineSettings = {
  engine: 'edge' | 'gemini';
  apiKey: string;
  model: string;
  learnedGlossary: string;
  learnTerms: boolean;
};

const readEngineSettings = (): EngineSettings => {
  const settings = getMMKVObject<ChapterGeneralSettings>(
    CHAPTER_GENERAL_SETTINGS,
  );
  const apiKey = settings?.geminiApiKey?.trim() ?? '';
  return {
    engine:
      settings?.translationEngine === 'gemini' && apiKey ? 'gemini' : 'edge',
    apiKey,
    model: settings?.geminiModel?.trim() || DEFAULT_GEMINI_MODEL,
    learnedGlossary: settings?.translationLearnedGlossary ?? '',
    learnTerms: settings?.geminiLearnTerms !== false,
  };
};

/**
 * Adds the terms Gemini translated to the learned glossary, which every
 * translator uses after the user's own glossary.
 */
const saveLearnedTerms = (terms: { source: string; arabic: string }[]) => {
  if (!terms.length) return;
  const settings: Partial<ChapterGeneralSettings> =
    getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ?? {};
  const current = settings.translationLearnedGlossary ?? '';
  const known = new Set(
    parseGlossary(`${settings.translationGlossary ?? ''}\n${current}`).map(
      entry => entry.from.toLowerCase(),
    ),
  );
  const lines = terms
    .filter(term => !known.has(term.source.toLowerCase()))
    .map(term => `${term.source} = ${term.arabic}`);
  if (!lines.length) return;
  setMMKVObject(CHAPTER_GENERAL_SETTINGS, {
    ...settings,
    translationLearnedGlossary: [current.trimEnd(), ...lines]
      .filter(Boolean)
      .join('\n'),
  });
};

/**
 * The glossary actually used: the user's lines first so they win over a
 * built-in entry for the same term.
 */
export const effectiveGlossary = (user: string, useBuiltin: boolean) =>
  useBuiltin ? `${user}\n${BUILTIN_GLOSSARY}` : user;

export type TranslatedPart =
  | { html: string }
  | { tag: string; original: string; text: string };

/** Edge first since it reads best; Google when Edge is down or changed. */
export const translateWithFallback = async (
  texts: string[],
  to = 'ar',
  from = '',
) => {
  try {
    return await translateWithEdge(texts, to, from);
  } catch (edgeError: any) {
    try {
      return await translateWithGoogle(texts, to, from);
    } catch (googleError: any) {
      throw new Error(
        `Edge: ${edgeError?.message ?? edgeError}; Google: ${
          googleError?.message ?? googleError
        }`,
      );
    }
  }
};

/**
 * Glossary terms put Arabic inside the source text, and auto-detection then
 * takes such a paragraph for Arabic and returns it untranslated. So a chapter
 * that is mostly Latin letters is sent as English; anything else is detected.
 */
export const detectSource = (texts: string[]) => {
  const all = texts.join('');
  const latin = all.match(/[A-Za-z]/g)?.length ?? 0;
  const letters =
    all.match(
      /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF]/g,
    )?.length ?? 0;
  return letters && latin / letters > 0.8 ? 'en' : '';
};

/** True when a chapter is already Arabic, so translating it would be wasted. */
export const isArabicText = (html: string) => {
  const text = html.replace(/<[^>]*>/g, ' ');
  const arabic = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const letters =
    text.match(
      /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF]/g,
    )?.length ?? 0;
  return letters > 0 && arabic / letters > 0.8;
};

export const translateChapterParts = async (
  html: string,
  glossary: string,
  engine: Pick<EngineSettings, 'engine' | 'apiKey' | 'model' | 'learnTerms'> = {
    engine: 'edge',
    apiKey: '',
    model: DEFAULT_GEMINI_MODEL,
    learnTerms: false,
  },
): Promise<TranslatedPart[]> => {
  const entries = parseGlossary(glossary);
  const parts = extractParagraphs(html);
  const originals = parts.flatMap(part => ('text' in part ? [part.text] : []));
  let translated: string[] | undefined;
  if (engine.engine === 'gemini') {
    try {
      const result = await translateWithGemini(
        originals,
        entries,
        engine.apiKey,
        engine.model,
      );
      translated = result.translated;
      if (engine.learnTerms) saveLearnedTerms(result.terms);
      MMKVStorage.remove(GEMINI_LAST_ERROR);
    } catch (error: any) {
      // Reading goes on with Edge; settings show what went wrong.
      MMKVStorage.set(GEMINI_LAST_ERROR, String(error?.message ?? error));
    }
  }
  if (!translated) {
    translated = await translateWithFallback(
      originals.map(text => applyGlossary(text, entries)),
      'ar',
      detectSource(originals),
    );
  }
  let i = 0;
  return parts.map(part =>
    'text' in part
      ? {
          tag: part.tag,
          original: part.text,
          text: applyGlossary(translated[i++] ?? '', entries),
        }
      : part,
  );
};

export const renderTranslation = (
  parts: TranslatedPart[],
  bilingual: boolean,
) =>
  `<div class="translated-ar" dir="rtl" lang="ar">${parts
    .map(part => {
      if ('html' in part) return part.html;
      const { tag, original, text } = part;
      const source = bilingual
        ? `<${tag} class="translation-original" dir="auto">${escapeHtml(
            original,
          )}</${tag}>`
        : '';
      return `${source}<${tag}>${escapeHtml(text)}</${tag}>`;
    })
    .join('')}</div>`;

const cacheFile = (
  pluginId: string,
  novelId: number,
  chapterId: number,
  glossary: string,
  engine: EngineSettings['engine'],
) => {
  const key = glossaryKey(parseGlossary(glossary));
  const dir = `${TRANSLATION_STORAGE}/v3/${
    engine === 'gemini' ? 'ar-gemini' : 'ar'
  }/${pluginId}/${novelId}`;
  return { dir, path: `${dir}/${chapterId}${key ? `-${key}` : ''}.json` };
};

/**
 * A short key for the chapter's text, so a translation is only reused while
 * the text it was made from is unchanged. Built from the extracted paragraphs,
 * not the raw HTML, so the reader and the downloader (which sanitize slightly
 * differently) agree on it.
 */
export const sourceKey = (html: string) => {
  let hash = 0x811c9dc5;
  for (const part of extractParagraphs(html)) {
    const text = 'text' in part ? part.text : '';
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 10; // paragraph break
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

type CachedTranslation = { source: string; parts: TranslatedPart[] };

/**
 * Translates a chapter once and keeps it on disk, so it stays readable
 * offline. A changed glossary is cached separately and translated again;
 * learned terms are left out of that key, or each new term would make every
 * saved chapter translate again.
 *
 * The saved translation remembers which text it was made from. When the
 * chapter itself changes (the author edits it, or it is downloaded again with
 * new text), the old translation is not reused: the chapter is translated
 * again. If that fails (offline, say), the old translation is still shown
 * rather than nothing.
 */
export const getChapterTranslation = async (
  chapter: { pluginId: string; novelId: number; chapterId: number },
  html: string,
  glossary: string,
): Promise<TranslatedPart[]> => {
  const engine = readEngineSettings();
  const { dir, path } = cacheFile(
    chapter.pluginId,
    chapter.novelId,
    chapter.chapterId,
    glossary,
    engine.engine,
  );
  const source = sourceKey(html);
  let stale: TranslatedPart[] | undefined;
  try {
    const saved = JSON.parse(await NativeFile.readFile(path)) as
      | CachedTranslation
      | TranslatedPart[];
    // Translations saved before this check have no source key: they may be
    // of an older version of the chapter, so they are only a fallback.
    if (!Array.isArray(saved) && saved.source === source) {
      return saved.parts;
    }
    stale = Array.isArray(saved) ? saved : saved.parts;
  } catch {
    // Not translated yet.
  }
  let parts: TranslatedPart[];
  try {
    parts = await translateChapterParts(
      html,
      `${glossary}\n${engine.learnedGlossary}`,
      engine,
    );
  } catch (error) {
    if (stale) return stale;
    throw error;
  }
  // A failed save only costs offline access; still return the translation.
  try {
    await NativeFile.mkdir(dir);
    const saved: CachedTranslation = { source, parts };
    await NativeFile.writeFile(path, JSON.stringify(saved));
  } catch {}
  return parts;
};

/** Translation settings for code outside React, such as downloads. */
export const getTranslationSettings = () => {
  const settings = getMMKVObject<ChapterGeneralSettings>(
    CHAPTER_GENERAL_SETTINGS,
  );
  return {
    translateOnDownload: Boolean(settings?.translateOnDownload),
    glossary: effectiveGlossary(
      settings?.translationGlossary ?? '',
      settings?.translationBuiltinGlossary !== false,
    ),
    bilingual: Boolean(settings?.translationBilingual),
  };
};
