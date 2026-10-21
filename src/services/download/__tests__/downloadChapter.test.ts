import { downloadChapters } from '../downloadChapter';

const mockParseChapter = jest.fn();
const mockTranslation = jest.fn();
const mockSleep = jest.fn(() => Promise.resolve());

jest.mock('@database/queries/ChapterQueries', () => ({
  getChapter: (id: number) =>
    Promise.resolve({
      id,
      novelId: 1,
      name: `Chapter ${id}`,
      path: `c/${id}`,
      isDownloaded: false,
    }),
}));
jest.mock('@database/queries/NovelQueries', () => ({
  getNovelById: () => Promise.resolve({ id: 1, name: 'Novel', pluginId: 'p' }),
}));
jest.mock('@plugins/pluginManager', () => ({
  getPlugin: () => ({
    id: 'p',
    site: 'https://example.com',
    downloadConcurrency: 2,
    parseChapter: (path: string) => mockParseChapter(path),
  }),
}));
jest.mock('@plugins/helpers/fetch', () => ({ downloadFile: jest.fn() }));
jest.mock('@modules/native-file', () => ({
  __esModule: true,
  default: { mkdir: jest.fn(), writeFile: jest.fn() },
}));
jest.mock('@database/db', () => ({
  dbManager: {
    write: (fn: (tx: unknown) => Promise<void>) =>
      fn({
        update: () => ({ set: () => ({ where: () => ({ run: jest.fn() }) }) }),
      }),
  },
}));
jest.mock('@utils/sleep', () => ({ sleep: () => mockSleep() }));
jest.mock('@hooks/persisted/useSettings', () => ({
  getChapterDownloadCooldownMs: () => 1000,
}));
jest.mock('@services/translate/chapterTranslation', () => ({
  getTranslationSettings: () => ({ translateOnDownload: true, glossary: '' }),
  getChapterTranslation: () => mockTranslation(),
  isArabicText: () => false,
}));
jest.mock('@screens/reader/utils/sanitizeChapterText', () => ({
  sanitizeChapterText: (_p: string, _n: string, _c: string, html: string) =>
    html,
}));
jest.mock('@i18n/translations', () => ({ getString: (key: string) => key }));

const chapters = [1, 2, 3, 4, 5].map(id => ({
  chapterId: id,
  chapterName: `Chapter ${id}`,
}));

describe('downloadChapters', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps downloading while a slow chapter and the translations are still running', async () => {
    const order: number[] = [];
    let releaseSlow!: () => void;
    mockParseChapter.mockImplementation((path: string) => {
      const id = Number(path.split('/')[1]);
      if (id === 1) {
        return new Promise(resolve => {
          releaseSlow = () => {
            order.push(id);
            resolve('<p>one</p>');
          };
        });
      }
      order.push(id);
      if (id === 5) releaseSlow();
      return Promise.resolve(`<p>${id}</p>`);
    });
    let translationsDone = 0;
    mockTranslation.mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(() => {
            translationsDone++;
            resolve([]);
          }, 5),
        ),
    );
    const checkpoints: string[] = [];

    await downloadChapters({ novelName: 'Novel', chapters }, jest.fn(), {
      checkpoint: undefined,
      updateCheckpoint: (value: string) => {
        checkpoints.push(value);
        return Promise.resolve();
      },
    } as any);

    // Chapters 2-5 went through the second slot while chapter 1 was stuck.
    expect(order).toEqual([2, 3, 4, 5, 1]);
    expect(translationsDone).toBe(5);
    // API plugins downloading in parallel skip the per-chapter pause.
    expect(mockSleep).not.toHaveBeenCalled();
    // The checkpoint only moves past chapters that are all finished.
    expect(JSON.parse(checkpoints[0]).nextIndex).toBe(0);
    expect(JSON.parse(checkpoints[checkpoints.length - 1]).nextIndex).toBe(5);
  });
});
