import * as cheerio from 'cheerio';
import { NOVEL_STORAGE } from '@utils/Storages';
import { Plugin } from '@plugins/types';
import { downloadFile } from '@plugins/helpers/fetch';
import { getPlugin } from '@plugins/pluginManager';
import { getString } from '@i18n/translations';
import { getChapter } from '@database/queries/ChapterQueries';
import { sleep } from '@utils/sleep';
import { getChapterDownloadCooldownMs } from '@hooks/persisted/useSettings';
import { getNovelById } from '@database/queries/NovelQueries';
import { dbManager } from '@database/db';
import { chapterSchema } from '@database/schema';
import type {
  BackgroundTaskExecutionContext,
  TaskProgressUpdater,
} from '@services/backgroundTasks/contracts';
import NativeFile from '@modules/native-file';
import { eq } from 'drizzle-orm';
import { parseDownloadCheckpoint } from './downloadCheckpoint';
import {
  getChapterTranslation,
  getTranslationSettings,
} from '@services/translate/chapterTranslation';
import { sanitizeChapterText } from '@screens/reader/utils/sanitizeChapterText';

const createChapterFolder = async (
  path: string,
  data: {
    pluginId: string;
    novelId: number;
    chapterId: number;
  },
): Promise<string> => {
  const { pluginId, novelId, chapterId } = data;
  const chapterFolder = `${path}/${pluginId}/${novelId}/${chapterId}`;
  await NativeFile.mkdir(chapterFolder);
  const nomediaPath = chapterFolder + '/.nomedia';
  await NativeFile.writeFile(nomediaPath, ',');
  return chapterFolder;
};

const downloadFiles = async (
  html: string,
  plugin: Plugin,
  novelId: number,
  chapterId: number,
): Promise<string> => {
  const folder = await createChapterFolder(NOVEL_STORAGE, {
    pluginId: plugin.id,
    novelId,
    chapterId,
  });
  const loadedCheerio = cheerio.load(html);
  const imgs = loadedCheerio('img').toArray();
  for (let i = 0; i < imgs.length; i++) {
    const elem = loadedCheerio(imgs[i]);
    const url = elem.attr('src');
    if (url) {
      const fileurl = `${folder}/${i}.b64.png`;
      elem.attr('src', 'file://' + fileurl);
      try {
        const absoluteURL = new URL(url, plugin.site).href;
        await downloadFile(absoluteURL, fileurl, plugin.imageRequestInit);
      } catch (e) {
        elem.attr('alt', String(e));
      }
    }
  }
  const savedHtml = loadedCheerio.html();
  await NativeFile.writeFile(folder + '/index.html', savedHtml);
  return savedHtml;
};

/**
 * Translates a freshly downloaded chapter so it opens in Arabic offline. The
 * reader sanitizes before translating, so this does too. A failure is left for
 * the reader to retry when the chapter is opened.
 */
const translateDownloadedChapter = async (
  html: string,
  novel: { id: number; name: string; pluginId: string },
  chapter: { id: number; name: string },
) => {
  const { translateOnDownload, glossary } = getTranslationSettings();
  if (!translateOnDownload) return;
  try {
    await getChapterTranslation(
      { pluginId: novel.pluginId, novelId: novel.id, chapterId: chapter.id },
      sanitizeChapterText(novel.pluginId, novel.name, chapter.name, html),
      glossary,
    );
  } catch {}
};

const downloadChapter = async (chapterId: number) => {
  const chapter = await getChapter(chapterId);
  if (!chapter) {
    throw new Error('Chapter not found with id: ' + chapterId);
  }
  if (chapter.isDownloaded) {
    return;
  }
  const novel = await getNovelById(chapter.novelId);
  if (!novel) {
    throw new Error('Novel not found for chapter: ' + chapter.name);
  }
  const plugin = getPlugin(novel.pluginId);
  if (!plugin) {
    throw new Error(getString('downloadScreen.pluginNotFound'));
  }
  const chapterText = await plugin.parseChapter(chapter.path);
  if (chapterText && chapterText.length) {
    const savedHtml = await downloadFiles(
      chapterText,
      plugin,
      novel.id,
      chapter.id,
    );

    await dbManager.write(async tx => {
      tx.update(chapterSchema)
        .set({ isDownloaded: true })
        .where(eq(chapterSchema.id, chapter.id))
        .run();
    });

    await translateDownloadedChapter(savedHtml, novel, chapter);

    await sleep(getChapterDownloadCooldownMs());
  } else {
    throw new Error(getString('downloadScreen.chapterEmptyOrScrapeError'));
  }
};

const MAX_DOWNLOAD_CONCURRENCY = 5;

const getDownloadConcurrency = async (chapterId: number) => {
  const chapter = await getChapter(chapterId);
  const novel = chapter ? await getNovelById(chapter.novelId) : undefined;
  const requested = novel ? getPlugin(novel.pluginId)?.downloadConcurrency : 1;
  return typeof requested === 'number' && requested >= 1
    ? Math.min(Math.floor(requested), MAX_DOWNLOAD_CONCURRENCY)
    : 1;
};

export const downloadChapters = async (
  {
    chapters,
  }: {
    novelName: string;
    chapters: { chapterId: number; chapterName: string }[];
  },
  setMeta: TaskProgressUpdater,
  context: BackgroundTaskExecutionContext,
) => {
  if (!chapters.length) return;

  const checkpoint = parseDownloadCheckpoint(
    context.checkpoint,
    chapters.length,
  );
  const failures = [...checkpoint.failures];
  const concurrency = await getDownloadConcurrency(chapters[0].chapterId);

  for (
    let index = checkpoint.nextIndex;
    index < chapters.length;
    index += concurrency
  ) {
    const batch = chapters.slice(index, index + concurrency);
    setMeta(meta => ({
      ...meta,
      isRunning: true,
      progress: index / chapters.length,
      progressText: `${index + 1}/${chapters.length} · ${batch[0].chapterName}`,
    }));

    const results = await Promise.all(
      batch.map(chapter =>
        downloadChapter(chapter.chapterId).then(
          () => undefined,
          (error: unknown) =>
            `${chapter.chapterName}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        ),
      ),
    );
    results.forEach(failure => failure && failures.push(failure));

    await context.updateCheckpoint(
      JSON.stringify({ nextIndex: index + batch.length, failures }),
    );
  }

  setMeta(meta => ({
    ...meta,
    progress: 1,
    isRunning: false,
  }));

  if (failures.length) {
    throw new Error(
      `${failures.length} of ${
        chapters.length
      } chapters failed: ${failures.join('; ')}`,
    );
  }
};
