import NativeFile from '@modules/native-file';
import {
  detectSource,
  effectiveGlossary,
  getChapterTranslation,
  renderTranslation,
  translateChapterParts,
  isArabicText,
  sourceKey,
} from '../chapterTranslation';
import { applyGlossary, glossaryKey, parseGlossary } from '../glossary';
import { BUILTIN_GLOSSARY } from '../builtinGlossary';

jest.mock('@utils/Storages', () => ({ TRANSLATION_STORAGE: '/t' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const edgeEcho = async (_url: string, init: { body: string }) =>
  response(JSON.parse(init.body).map((t: string) => `ar:${t}`));

beforeEach(() => {
  mockFetch.mockReset();
  jest.mocked(NativeFile.readFile).mockReset();
  jest.mocked(NativeFile.writeFile).mockReset();
  jest.mocked(NativeFile.mkdir).mockReset();
});

describe('glossary', () => {
  it('parses lines and replaces whole terms, longest first', () => {
    const entries = parseGlossary(
      'Dragon = تنين\nAzure Dragon Sect = طائفة التنين اللازوردي\nbad line\n',
    );
    expect(entries.map(e => e.from)).toEqual(['Azure Dragon Sect', 'Dragon']);
    expect(
      applyGlossary('The azure dragon sect saw a Dragon. Dragonfly!', entries),
    ).toBe('The طائفة التنين اللازوردي saw a تنين. Dragonfly!');
  });

  it('keys a glossary by content and gives none to an empty one', () => {
    expect(glossaryKey([])).toBe('');
    expect(glossaryKey(parseGlossary('a = ب'))).toBe(
      glossaryKey(parseGlossary(' a=ب ')),
    );
    expect(glossaryKey(parseGlossary('a = ب'))).not.toBe(
      glossaryKey(parseGlossary('a = ج')),
    );
  });
});

describe('translateChapterParts', () => {
  it('applies the glossary before and after translating and keeps tags', async () => {
    mockFetch.mockImplementation(edgeEcho);
    await expect(
      translateChapterParts(
        '<h1>Qi</h1><p>Gather Qi</p><img src="x">',
        'Qi = تشي\nar:Gather = اجمع',
      ),
    ).resolves.toEqual([
      { tag: 'h1', original: 'Qi', text: 'ar:تشي' },
      { tag: 'p', original: 'Gather Qi', text: 'اجمع تشي' },
      { html: '<img src="x">' },
    ]);
  });

  it('falls back to Google when Edge fails', async () => {
    mockFetch.mockResolvedValueOnce(response('', 404)).mockResolvedValueOnce(
      response([
        [
          ['أ\n', 'A\n'],
          ['ب', 'B'],
        ],
      ]),
    );
    const parts = await translateChapterParts('<p>A</p><p>B</p>', '');
    expect(parts.map(p => ('text' in p ? p.text : ''))).toEqual(['أ', 'ب']);
    expect(mockFetch.mock.calls[1][0]).toContain('translate.googleapis.com');
    expect(mockFetch.mock.calls[1][1].body).toBe(
      `q=${encodeURIComponent('A\nB')}`,
    );
  });

  it('retries Google one paragraph at a time when lines do not match', async () => {
    mockFetch
      .mockResolvedValueOnce(response('', 500))
      .mockResolvedValueOnce(response([[['أب', 'A\nB']]]))
      .mockResolvedValueOnce(response([[['أ', 'A']]]))
      .mockResolvedValueOnce(response([[['ب', 'B']]]));
    const parts = await translateChapterParts('<p>A</p><p>B</p>', '');
    expect(parts.map(p => ('text' in p ? p.text : ''))).toEqual(['أ', 'ب']);
  });

  it('reports both errors when every translator fails', async () => {
    mockFetch
      .mockResolvedValueOnce(response('', 404))
      .mockResolvedValueOnce(response('', 429));
    await expect(translateChapterParts('<p>A</p>', '')).rejects.toThrow(
      'Edge: Translation failed (404); Google: Google translation failed (429)',
    );
  });
});

describe('renderTranslation', () => {
  const parts = [
    { tag: 'h2', original: 'One', text: 'واحد' },
    { html: '<img src="x">' },
    { tag: 'p', original: 'a < b', text: 'أ < ب' },
  ];

  it('renders escaped Arabic in an RTL wrapper', () => {
    expect(renderTranslation(parts, false)).toBe(
      '<div class="translated-ar" dir="rtl" lang="ar"><h2>واحد</h2><img src="x"><p>أ &lt; ب</p></div>',
    );
  });

  it('puts the original above each paragraph in bilingual mode', () => {
    expect(renderTranslation(parts, true)).toContain(
      '<p class="translation-original" dir="auto">a &lt; b</p><p>أ &lt; ب</p>',
    );
  });
});

describe('getChapterTranslation', () => {
  const chapter = { pluginId: 'fz', novelId: 1, chapterId: 7 };

  it('uses the cached translation of the same text without calling the network', async () => {
    jest.mocked(NativeFile.readFile).mockResolvedValue(
      JSON.stringify({
        source: sourceKey('<p>A</p>'),
        parts: [{ html: '<hr>' }],
      }),
    );
    await expect(
      getChapterTranslation(chapter, '<p>A</p>', ''),
    ).resolves.toEqual([{ html: '<hr>' }]);
    expect(NativeFile.readFile).toHaveBeenCalledWith('/t/v3/ar/fz/1/7.json');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates again when the chapter text changed since it was saved', async () => {
    jest.mocked(NativeFile.readFile).mockResolvedValue(
      JSON.stringify({
        source: sourceKey('<p>Old</p>'),
        parts: [{ html: '<hr>' }],
      }),
    );
    mockFetch.mockImplementation(edgeEcho);
    await expect(
      getChapterTranslation(chapter, '<p>New</p>', ''),
    ).resolves.toEqual([{ tag: 'p', original: 'New', text: 'ar:New' }]);
    expect(mockFetch).toHaveBeenCalled();
    const [path, body] = jest.mocked(NativeFile.writeFile).mock.calls[0];
    expect(path).toBe('/t/v3/ar/fz/1/7.json');
    expect(JSON.parse(body).source).toBe(sourceKey('<p>New</p>'));
  });

  it('translates again a translation saved before the text was remembered', async () => {
    jest
      .mocked(NativeFile.readFile)
      .mockResolvedValue(JSON.stringify([{ html: '<hr>' }]));
    mockFetch.mockImplementation(edgeEcho);
    await expect(
      getChapterTranslation(chapter, '<p>A</p>', ''),
    ).resolves.toEqual([{ tag: 'p', original: 'A', text: 'ar:A' }]);
  });

  it('falls back to the old translation when translating again fails', async () => {
    jest
      .mocked(NativeFile.readFile)
      .mockResolvedValue(JSON.stringify([{ html: '<hr>' }]));
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(
      getChapterTranslation(chapter, '<p>A</p>', ''),
    ).resolves.toEqual([{ html: '<hr>' }]);
  });

  it('keys the text by its paragraphs, not its markup', () => {
    expect(sourceKey('<p>A</p><p>B</p>')).toBe(
      sourceKey('<div><p class="x">A</p>\n<p>B</p></div>'),
    );
    expect(sourceKey('<p>A</p><p>B</p>')).not.toBe(sourceKey('<p>AB</p>'));
    expect(sourceKey('<p>A</p>')).not.toBe(sourceKey('<p>a</p>'));
  });

  it('translates, saves under a glossary-specific name, and survives a failed save', async () => {
    jest.mocked(NativeFile.readFile).mockRejectedValue(new Error('missing'));
    jest.mocked(NativeFile.writeFile).mockRejectedValue(new Error('full'));
    mockFetch.mockImplementation(edgeEcho);
    await expect(
      getChapterTranslation(chapter, '<p>A</p>', 'A = أ'),
    ).resolves.toEqual([{ tag: 'p', original: 'A', text: 'ar:أ' }]);
    const path = jest.mocked(NativeFile.writeFile).mock.calls[0][0];
    expect(path).toMatch(/^\/t\/v3\/ar\/fz\/1\/7-[a-z0-9]+\.json$/);
  });
});

describe('effectiveGlossary', () => {
  it('lets user entries override built-in ones', () => {
    const entries = parseGlossary(effectiveGlossary('Dantian = البطن', true));
    expect(entries.filter(e => e.from === 'Dantian')).toEqual([
      { from: 'Dantian', to: 'البطن' },
    ]);
    expect(entries.length).toBeGreaterThan(50);
    expect(parseGlossary(effectiveGlossary('a = ب', false))).toHaveLength(1);
  });

  it('has no duplicate or malformed built-in lines', () => {
    const lines = BUILTIN_GLOSSARY.split('\n').filter(l => l.trim());
    expect(parseGlossary(BUILTIN_GLOSSARY)).toHaveLength(lines.length);
  });
});

describe('detectSource', () => {
  it('sends English chapters as English so glossary Arabic is not mistaken for the source', async () => {
    expect(detectSource(['He gathered Qi', 'The Sect frowned'])).toBe('en');
    expect(detectSource(['他运转了真气'])).toBe('');
    mockFetch.mockImplementation(edgeEcho);
    await translateChapterParts('<p>Gather Qi now</p>', 'Qi = تشي');
    expect(mockFetch.mock.calls[0][0]).toContain('from=en&');
  });
});

describe('isArabicText', () => {
  it('recognises a chapter that is already Arabic', () => {
    expect(
      isArabicText('<h1>الفصل الأول</h1><p>كانت <b>إلباف</b> تحترق.</p>'),
    ).toBe(true);
  });

  it('leaves English and mixed chapters for translation', () => {
    expect(isArabicText('<p>Gather Qi now</p>')).toBe(false);
    expect(isArabicText('<p>Lin Feng = لين فنغ walked into the hall</p>')).toBe(
      false,
    );
    expect(isArabicText('<p>   </p>')).toBe(false);
  });
});
