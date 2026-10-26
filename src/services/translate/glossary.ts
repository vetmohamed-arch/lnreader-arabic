/**
 * User glossary: one `term = translation` per line. Terms are swapped in
 * before translating, so names and cultivation terms always come out the same
 * way; the translator copies Arabic it is given as-is. Entries whose term is
 * Arabic also fix recurring mistakes in the translated text.
 */

export type GlossaryEntry = { from: string; to: string };

const WORD_CHAR = 'A-Za-z0-9\\u0600-\\u06FF';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ARABIC = /[\u0600-\u06FF]/;

/** True for a term written in Arabic letters, such as «الذي». */
export const isArabicTerm = (term: string) => ARABIC.test(term);

/**
 * Learned terms are what Gemini picked up while translating, so they are only
 * ever source-language names. A learned line whose term is Arabic (a common
 * word Gemini listed by mistake, e.g. «الذي = ...») would rewrite that word in
 * every translated chapter, so such lines are dropped. Only the user's own
 * glossary may hold Arabic fixes.
 */
export const learnedGlossaryLines = (text: string) =>
  text
    .split('\n')
    .filter(line => {
      const at = line.indexOf('=');
      return at < 0 || !isArabicTerm(line.slice(0, at));
    })
    .join('\n');

export const parseGlossary = (text: string): GlossaryEntry[] =>
  text
    .split('\n')
    .flatMap(line => {
      const at = line.indexOf('=');
      if (at < 0) return [];
      const from = line.slice(0, at).trim();
      const to = line.slice(at + 1).trim();
      return from && to ? [{ from, to }] : [];
    })
    // First entry for a term wins, so callers can put overrides first.
    .filter(
      (entry, index, all) =>
        all.findIndex(
          other => other.from.toLowerCase() === entry.from.toLowerCase(),
        ) === index,
    )
    // Longest first, so "Azure Dragon Sect" wins over "Dragon".
    .sort((a, b) => b.from.length - a.from.length);

export const applyGlossary = (text: string, entries: GlossaryEntry[]) =>
  entries.reduce(
    (result, { from, to }) =>
      result.replace(
        new RegExp(
          `(^|[^${WORD_CHAR}])${escapeRegExp(from)}(?=[^${WORD_CHAR}]|$)`,
          'gi',
        ),
        (_match, before: string) => before + to,
      ),
    text,
  );

/** Short stable hash, so a changed glossary gets its own cached translation. */
export const glossaryKey = (entries: GlossaryEntry[]) => {
  if (!entries.length) return '';
  let hash = 0;
  for (const char of JSON.stringify(entries)) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return (hash >>> 0).toString(36);
};
