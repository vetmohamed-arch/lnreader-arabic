import { withTimeout } from '@utils/fetch/fetch';

/**
 * Fallback translator: the keyless Google Translate endpoint used by its
 * browser extension. Undocumented like Edge's, but run by a different company,
 * so it rarely breaks at the same time.
 */

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const TRANSLATE_TIMEOUT_MS = 30000;

// Google answers 413 on long bodies; stay well under its ~5k character limit.
const MAX_BATCH_CHARS = 4000;

type GoogleResponse = [[string, string, ...unknown[]][] | null, ...unknown[]];

const requestTranslation = async (text: string, to: string, from: string) => {
  // A stalled connection would otherwise hang a chapter, and a download
  // queue waiting on it, forever.
  return withTimeout(TRANSLATE_TIMEOUT_MS, async signal => {
    const res = await fetch(
      `${TRANSLATE_URL}?client=gtx&sl=${from || 'auto'}&tl=${to}&dt=t`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
        body: `q=${encodeURIComponent(text)}`,
      },
    );
    if (!res.ok) {
      throw new Error(`Google translation failed (${res.status})`);
    }
    const data: GoogleResponse = await res.json();
    return (data[0] ?? []).map(sentence => sentence[0]).join('');
  });
};

/**
 * Translates paragraphs in as few requests as possible by joining them with
 * newlines, which Google keeps. A batch whose line count comes back different
 * is retried one paragraph at a time.
 */
export const translateWithGoogle = async (
  texts: string[],
  to = 'ar',
  from = '',
) => {
  const translated: string[] = [];
  let batch: string[] = [];
  let size = 0;
  const flush = async () => {
    if (batch.length) {
      const lines = (
        await requestTranslation(batch.join('\n'), to, from)
      ).split('\n');
      if (lines.length === batch.length) {
        translated.push(...lines);
      } else {
        for (const text of batch) {
          translated.push(await requestTranslation(text, to, from));
        }
      }
    }
    batch = [];
    size = 0;
  };
  for (const text of texts) {
    if (batch.length && size + text.length > MAX_BATCH_CHARS) {
      await flush();
    }
    batch.push(text);
    size += text.length + 1;
  }
  await flush();
  return translated;
};
