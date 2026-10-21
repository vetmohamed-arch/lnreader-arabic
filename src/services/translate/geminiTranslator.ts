import { withTimeout } from '@utils/fetch/fetch';
import type { GlossaryEntry } from './glossary';

/**
 * AI translation with the user's own Gemini API key. Unlike Edge or Google it
 * reads the chapter as a whole, follows the glossary, and reports the names
 * and terms it translated so they can be added to the glossary for the other
 * translators.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 120000;
// Keeps each request's answer well inside the model's output limit.
const MAX_CHUNK_CHARS = 12000;
// Only glossary entries that occur in the chunk are sent, up to this many.
const MAX_GLOSSARY_ENTRIES = 300;

const INSTRUCTIONS = `You translate web novels (mostly Chinese xianxia, wuxia and cultivation stories, also fan fiction) into natural, fluent Modern Standard Arabic for Egyptian readers.
- Translate every paragraph of "paragraphs" in order. Return exactly one Arabic paragraph for each input paragraph, never merging or splitting them.
- Keep the meaning, tone and dialogue; write smooth literary Arabic, not word-for-word translation.
- Always use the Arabic given in "glossary" for those names and terms.
- Transliterate personal names; translate the meaning of sects, techniques, realms, treasures and titles.
- In "terms", list the proper names and cultivation terms you translated that are not already in the glossary: "source" exactly as written in the input, "arabic" as you translated it. Skip common words.`;

export type GeminiTerm = { source: string; arabic: string };

type GeminiReply = { paragraphs: string[]; terms: GeminiTerm[] };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
    terms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          source: { type: 'STRING' },
          arabic: { type: 'STRING' },
        },
        required: ['source', 'arabic'],
      },
    },
  },
  required: ['paragraphs', 'terms'],
};

class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const request = (model: string, apiKey: string, body: unknown) =>
  withTimeout(TIMEOUT_MS, async signal => {
    const res = await fetch(
      `${API}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      throw new GeminiError(
        `Gemini: ${data?.error?.message ?? `HTTP ${res.status}`}`,
        res.status,
      );
    }
    return data;
  });

/** The newest Flash model the key can use, for when the saved one is gone. */
const findFlashModel = async (apiKey: string) =>
  withTimeout(TIMEOUT_MS, async signal => {
    const res = await fetch(`${API}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    const data = await res.json();
    const names: string[] = (data?.models ?? [])
      .filter((m: any) =>
        (m.supportedGenerationMethods ?? []).includes('generateContent'),
      )
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter(
        (name: string) =>
          /flash/.test(name) && !/lite|image|tts|live|audio|exp/.test(name),
      );
    return names.sort().reverse()[0];
  });

const translateChunk = async (
  paragraphs: string[],
  glossary: GlossaryEntry[],
  model: string,
  apiKey: string,
): Promise<GeminiReply> => {
  const text = paragraphs.join('\n').toLowerCase();
  const relevant = glossary
    .filter(entry => text.includes(entry.from.toLowerCase()))
    .slice(0, MAX_GLOSSARY_ENTRIES)
    .map(entry => ({ term: entry.from, arabic: entry.to }));
  const data = await request(model, apiKey, {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: JSON.stringify({ glossary: relevant, paragraphs }) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const answer = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((part: { text?: string }) => part.text ?? '')
    .join('');
  let reply: GeminiReply;
  try {
    reply = JSON.parse(answer);
  } catch {
    throw new GeminiError('Gemini: the answer was cut off or not JSON');
  }
  if (
    !Array.isArray(reply.paragraphs) ||
    reply.paragraphs.length !== paragraphs.length
  ) {
    throw new GeminiError('Gemini: paragraph count did not match');
  }
  return {
    paragraphs: reply.paragraphs.map(String),
    terms: Array.isArray(reply.terms) ? reply.terms : [],
  };
};

const chunk = (texts: string[]) => {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length && size + text.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
};

/**
 * Translates paragraphs to Arabic. Terms learned in one part of the chapter
 * are passed on to the next part so names stay the same throughout.
 */
export const translateWithGemini = async (
  texts: string[],
  glossary: GlossaryEntry[],
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
) => {
  const known = [...glossary];
  const knownTerms = new Set(glossary.map(e => e.from.toLowerCase()));
  const translated: string[] = [];
  const terms: GeminiTerm[] = [];
  let activeModel = model || DEFAULT_GEMINI_MODEL;
  for (const part of chunk(texts)) {
    let reply: GeminiReply;
    try {
      reply = await translateChunk(part, known, activeModel, apiKey);
    } catch (error) {
      // An old model name: switch to the newest Flash the key offers.
      if (!(error instanceof GeminiError) || error.status !== 404) throw error;
      const fallback = await findFlashModel(apiKey);
      if (!fallback || fallback === activeModel) throw error;
      activeModel = fallback;
      reply = await translateChunk(part, known, activeModel, apiKey);
    }
    translated.push(...reply.paragraphs);
    for (const term of reply.terms) {
      const source = String(term.source ?? '').trim();
      const arabic = String(term.arabic ?? '').trim();
      if (
        source &&
        arabic &&
        source.length <= 60 &&
        !source.includes('=') &&
        !knownTerms.has(source.toLowerCase())
      ) {
        knownTerms.add(source.toLowerCase());
        known.push({ from: source, to: arabic });
        terms.push({ source, arabic });
      }
    }
  }
  return { translated, terms };
};
