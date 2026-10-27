import NativeFile from '@modules/native-file';
import { getMMKVObject, MMKVStorage, setMMKVObject } from '@utils/mmkv/mmkv';
import { CHAPTER_GENERAL_SETTINGS } from '@hooks/persisted/useSettings';
import {
  GEMINI_LAST_ERROR,
  getChapterTranslation,
} from '../chapterTranslation';
import { translateWithGemini } from '../geminiTranslator';

jest.mock('@utils/Storages', () => ({ TRANSLATION_STORAGE: '/t' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** A Gemini answer translating each paragraph as `ar:<text>`. */
const geminiEcho =
  (terms: { source: string; arabic: string }[] = []) =>
  async (_url: string, init: { body: string }) => {
    const { paragraphs } = JSON.parse(
      JSON.parse(init.body).contents[0].parts[0].text,
    );
    return response({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  paragraphs: paragraphs.map((p: string) => `ar:${p}`),
                  terms,
                }),
              },
            ],
          },
        },
      ],
    });
  };

beforeEach(() => {
  mockFetch.mockReset();
  MMKVStorage.clearAll();
  jest.mocked(NativeFile.readFile).mockReset();
  jest.mocked(NativeFile.readFile).mockRejectedValue(new Error('missing'));
  jest.mocked(NativeFile.writeFile).mockReset();
  jest.mocked(NativeFile.mkdir).mockReset();
});

describe('translateWithGemini', () => {
  it('sends only the glossary terms found in the text and returns new terms', async () => {
    mockFetch.mockImplementation(
      geminiEcho([
        { source: 'Lin Feng', arabic: 'لين فنغ' },
        { source: 'Qi', arabic: 'تشي' },
      ]),
    );
    const result = await translateWithGemini(
      ['Lin Feng gathered Qi.'],
      [
        { from: 'Qi', to: 'التشي' },
        { from: 'Nascent Soul', to: 'الروح الوليدة' },
      ],
      'key',
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(JSON.parse(body.contents[0].parts[0].text).glossary).toEqual([
      { term: 'Qi', arabic: 'التشي' },
    ]);
    expect(mockFetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key');
    expect(result.translated).toEqual(['ar:Lin Feng gathered Qi.']);
    // Qi was already in the glossary, so only the new name is learned.
    expect(result.terms).toEqual([{ source: 'Lin Feng', arabic: 'لين فنغ' }]);
  });

  it('switches to the newest Flash model when the saved one is gone', async () => {
    mockFetch.mockImplementation(async (url: string, init: any) => {
      if (url.endsWith('/models?pageSize=200')) {
        return response({
          models: [
            {
              name: 'models/gemini-9-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-9-flash-lite',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        });
      }
      if (url.includes('old-model')) {
        return response({ error: { message: 'not found' } }, 404);
      }
      return geminiEcho()(url, init);
    });
    const result = await translateWithGemini(['Hi'], [], 'key', 'old-model');
    expect(result.translated).toEqual(['ar:Hi']);
    expect(mockFetch.mock.calls[2][0]).toContain('models/gemini-9-flash:');
  });
});

describe('getChapterTranslation with Gemini', () => {
  const chapter = { pluginId: 'p', novelId: 1, chapterId: 2 };

  it('saves learned terms without changing the cache key', async () => {
    setMMKVObject(CHAPTER_GENERAL_SETTINGS, {
      translationEngine: 'gemini',
      geminiApiKey: 'key',
      translationGlossary: 'Qi = التشي',
    });
    mockFetch.mockImplementation(
      geminiEcho([{ source: 'Lin Feng', arabic: 'لين فنغ' }]),
    );
    const parts = await getChapterTranslation(
      chapter,
      '<p>Lin Feng</p>',
      'Qi = التشي',
    );
    expect(parts).toEqual([
      { tag: 'p', original: 'Lin Feng', text: 'ar:Lin Feng' },
    ]);
    expect(
      getMMKVObject<any>(CHAPTER_GENERAL_SETTINGS)?.translationLearnedGlossary,
    ).toBe('Lin Feng = لين فنغ');
    const savedPath = jest.mocked(NativeFile.writeFile).mock.calls[0][0];
    expect(savedPath).toMatch(/^\/t\/v3\/ar-gemini\/p\/1\/2-/);

    // A second chapter with the term already learned stays on the same key.
    jest.mocked(NativeFile.writeFile).mockClear();
    await getChapterTranslation(
      { ...chapter, chapterId: 3 },
      '<p>Lin Feng</p>',
      'Qi = التشي',
    );
    expect(jest.mocked(NativeFile.writeFile).mock.calls[0][0]).toBe(
      savedPath.replace('/2-', '/3-'),
    );
  });

  it('never learns a term written in Arabic', async () => {
    setMMKVObject(CHAPTER_GENERAL_SETTINGS, {
      translationEngine: 'gemini',
      geminiApiKey: 'key',
    });
    mockFetch.mockImplementation(
      geminiEcho([
        { source: 'الذي', arabic: 'ارثه المطلق' },
        { source: 'Lin Feng', arabic: 'لين فنغ' },
      ]),
    );
    await getChapterTranslation(chapter, '<p>Lin Feng</p>', '');
    expect(
      getMMKVObject<any>(CHAPTER_GENERAL_SETTINGS)?.translationLearnedGlossary,
    ).toBe('Lin Feng = لين فنغ');
  });

  it('ignores an Arabic line already saved in the learned terms', async () => {
    setMMKVObject(CHAPTER_GENERAL_SETTINGS, {
      translationEngine: 'gemini',
      geminiApiKey: 'key',
      translationLearnedGlossary: 'الذي = ارثه المطلق\nLin Feng = لين فنغ',
    });
    mockFetch.mockImplementation(async () =>
      response({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    paragraphs: ['لين فنغ الذي ضربه'],
                    terms: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const parts = await getChapterTranslation(
      chapter,
      '<p>Lin Feng who hit him</p>',
      '',
    );
    expect(parts[0]).toMatchObject({ text: 'لين فنغ الذي ضربه' });
  });

  it('falls back to Edge, with the learned terms, when Gemini fails', async () => {
    setMMKVObject(CHAPTER_GENERAL_SETTINGS, {
      translationEngine: 'gemini',
      geminiApiKey: 'bad',
      translationLearnedGlossary: 'Lin Feng = لين فنغ',
    });
    mockFetch.mockImplementation(async (url: string, init: any) => {
      if (url.includes('generativelanguage')) {
        return response({ error: { message: 'API key not valid' } }, 400);
      }
      return response(JSON.parse(init.body).map((t: string) => `ar:${t}`));
    });
    const parts = await getChapterTranslation(chapter, '<p>Lin Feng</p>', '');
    expect(parts[0]).toMatchObject({ text: 'ar:لين فنغ' });
    expect(MMKVStorage.getString(GEMINI_LAST_ERROR)).toBe(
      'Gemini: API key not valid',
    );
  });
});
