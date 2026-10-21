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
  isArabicText,
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
    const text = sanitizeChapterText(
      novel.pluginId,
      novel.name,
      chapter.name,
      html,
    );
    if (isArabicText(text)) return;
    await getChapterTranslation(
      { pluginId: novel.pluginId, novelId: novel.id, chapterId: chapter.id },
      text,
      glossary,
    );
  } catch {}
};

/**
 * Downloads one chapter. Returns the translation work for it, if any, so the
 * caller can run it without holding up the next download.
 */
const downloadChapter = async (
  chapterId: number,
  cooldown: boolean,
): Promise<(() => Promise<void>) | undefined> => {
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

    if (cooldown) {
      await sleep(getChapterDownloadCooldownMs());
    }
    return () => translateDownloadedChapter(savedHtml, novel, chapter);
  } else {
    throw new Error(getString('downloadScreen.chapterEmptyOrScrapeError'));
  }
};

const MAX_DOWNLOAD_CONCURRENCY = 5;
/** Chapters translated at once while downloading; more trips Edge's limits. */
const TRANSLATE_CONCURRENCY = 2;

const getDownloadConcurrency = async (chapterId: number) => {
  const chapter = await getChapter(chapterId);
  const novel = chapter ? await getNovelById(chapter.novelId) : undefined;
  const requested = novel ? getPlugin(novel.pluginId)?.downloadConcurrency : 1;
  return typeof requested === 'number' && requested >= 1
    ? Math.min(Math.floor(requested), MAX_DOWNLOAD_CONCURRENCY)
    : 1;
};

/** Runs queued jobs a few at a time; `drain` waits for all of them. */
const createQueue = (limit: number) => {
  const waiting: (() => Promise<void>)[] = [];
  const idle: (() => void)[] = [];
  let running = 0;
  const next = () => {
    while (running < limit && waiting.length) {
      const job = waiting.shift()!;
      running++;
      job()
        .catch(() => {})
        .finally(() => {
          running--;
          next();
        });
    }
    if (!running && !waiting.length) {
      idle.splice(0).forEach(resolve => resolve());
    }
  };
  return {
    push: (job: () => Promise<void>) => {
      waiting.push(job);
      next();
    },
    get pending() {
      return running + waiting.length;
    },
    drain: () =>
      running || waiting.length
        ? new Promise<void>(resolve => idle.push(resolve))
        : Promise.resolve(),
  };
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
  // Plugins that ask for parallel downloads talk to an API, not pages, so
  // they skip the pause meant to spare scraped sites.
  const cooldown = concurrency === 1;
  const translations = createQueue(TRANSLATE_CONCURRENCY);

  // Each slot takes the next chapter as soon as its last one is done, so one
  // slow chapter no longer holds up the others.
  const done = new Set<number>();
  let nextIndex = checkpoint.nextIndex;
  let finishedUpTo = checkpoint.nextIndex;
  let completed = checkpoint.nextIndex;

  const worker = async () => {
    while (nextIndex < chapters.length) {
      const index = nextIndex++;
      const chapter = chapters[index];
      setMeta(meta => ({
        ...meta,
        isRunning: true,
        progress: completed / chapters.length,
        progressText: `${completed + 1}/${chapters.length} · ${
          chapter.chapterName
        }`,
      }));
      try {
        const translate = await downloadChapter(chapter.chapterId, cooldown);
        if (translate) translations.push(translate);
      } catch (error) {
        failures.push(
          `${chapter.chapterName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      completed++;
      done.add(index);
      while (done.has(finishedUpTo)) {
        done.delete(finishedUpTo);
        finishedUpTo++;
      }
      await context.updateCheckpoint(
        JSON.stringify({ nextIndex: finishedUpTo, failures }),
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (translations.pending) {
    setMeta(meta => ({
      ...meta,
      isRunning: true,
      progress: 1,
      progressText: getString('downloadScreen.translating'),
    }));
    await translations.drain();
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
