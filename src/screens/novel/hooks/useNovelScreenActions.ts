import { useCallback, useMemo } from 'react';
import { Share } from 'react-native';
import isNumber from 'lodash-es/isNumber';

import {
  getAllUndownloadedAndUnreadChapters,
  getAllUndownloadedChapters,
  getChaptersByIds,
  getNovelChaptersInOrder,
} from '@database/queries/ChapterQueries';
import { ChapterInfo, NovelInfo } from '@database/types';
import { useDownload } from '@hooks/persisted';
import { resolveUrl } from '@services/plugin/fetch';
import { MaterialDesignIconName } from '@type/icon';

import { useNovelActions } from '../NovelContext';

type SelectionAction = {
  icon: MaterialDesignIconName;
  onPress: () => void;
};

interface UseNovelScreenActionsOptions {
  chapters: ChapterInfo[];
  clearSelection: () => void;
  novel?: NovelInfo;
  selectedIds: number[];
  selectedChapters: ChapterInfo[];
}

export const useNovelScreenActions = ({
  chapters,
  clearSelection,
  novel,
  selectedIds,
  selectedChapters,
}: UseNovelScreenActionsOptions) => {
  const {
    bookmarkChapters,
    deleteChapters,
    markChaptersRead,
    markChaptersUnreadAndResetProgress,
    markPreviouschaptersRead,
    markPreviousChaptersUnread,
  } = useNovelActions();
  const { downloadChapters } = useDownload();

  const downloadAvailableChapters = useCallback(
    async (amount: number | 'all' | 'unread') => {
      if (!novel) {
        return;
      }

      let availableChapters = chapters;
      if (amount === 'all') {
        availableChapters = await getAllUndownloadedChapters(novel.id);
      } else if (amount === 'unread') {
        availableChapters = await getAllUndownloadedAndUnreadChapters(novel.id);
      } else if (isNumber(amount)) {
        availableChapters = availableChapters
          .filter(chapter => !chapter.isDownloaded)
          .slice(0, amount);
      }

      if (availableChapters.length > 0) {
        downloadChapters(novel, availableChapters);
      }
    },
    [chapters, downloadChapters, novel],
  );

  /** Downloads the selected chapter together with every chapter after or before it. */
  const downloadFromSelected = useCallback(
    async (direction: 'after' | 'before') => {
      if (!novel || selectedIds.length !== 1) {
        return;
      }
      const ordered = await getNovelChaptersInOrder(novel.id);
      const index = ordered.findIndex(chapter => chapter.id === selectedIds[0]);
      if (index < 0) {
        return;
      }
      const range =
        direction === 'after'
          ? ordered.slice(index)
          : ordered.slice(0, index + 1);
      const toDownload = range.filter(chapter => !chapter.isDownloaded);
      clearSelection();
      if (toDownload.length > 0) {
        downloadChapters(novel, toDownload);
      }
    },
    [clearSelection, downloadChapters, novel, selectedIds],
  );

  /**
   * Downloads chapters `from` to `to` (inclusive, to the end when `to` is
   * missing). Chapters are matched by the number the source gives them, or by
   * their place in the list when it gives none.
   */
  const downloadChapterRange = useCallback(
    async (from: number, to?: number) => {
      if (!novel) {
        return;
      }
      const [low, high] =
        to !== undefined && to < from ? [to, from] : [from, to ?? Infinity];
      const ordered = await getNovelChaptersInOrder(novel.id);
      const toDownload = ordered.filter((chapter, index) => {
        const number = chapter.chapterNumber ?? index + 1;
        return number >= low && number <= high && !chapter.isDownloaded;
      });
      if (toDownload.length > 0) {
        downloadChapters(novel, toDownload);
      }
    },
    [downloadChapters, novel],
  );

  const deleteDownloadedChapters = useCallback(() => {
    deleteChapters(
      chapters
        .filter(chapter => chapter.isDownloaded)
        .map(chapter => chapter.id),
    );
  }, [chapters, deleteChapters]);

  const shareNovel = useCallback(() => {
    if (novel) {
      void Share.share({
        message: resolveUrl(novel.pluginId, novel.path, true),
      });
    }
  }, [novel]);

  const selectionActions = useMemo(() => {
    const actions: SelectionAction[] = [];
    const finish = (action: () => void) => () => {
      action();
      clearSelection();
    };

    const hasUnloadedSelection = selectedIds.length > selectedChapters.length;

    if (
      !novel?.isLocal &&
      (hasUnloadedSelection ||
        selectedChapters.some(chapter => !chapter.isDownloaded))
    ) {
      actions.push({
        icon: 'download-outline',
        onPress: finish(() => {
          if (novel) {
            void getChaptersByIds(selectedIds).then(chaptersToDownload => {
              const availableChapters = chaptersToDownload.filter(
                chapter => !chapter.isDownloaded,
              );
              if (availableChapters.length > 0) {
                downloadChapters(novel, availableChapters);
              }
            });
          }
        }),
      });
    }

    if (
      !novel?.isLocal &&
      (hasUnloadedSelection ||
        selectedChapters.some(chapter => chapter.isDownloaded))
    ) {
      actions.push({
        icon: 'trash-can-outline',
        onPress: finish(() => {
          void getChaptersByIds(selectedIds).then(selectedChapterRows => {
            const downloadedChapterIds = selectedChapterRows
              .filter(chapter => chapter.isDownloaded)
              .map(chapter => chapter.id);
            if (downloadedChapterIds.length > 0) {
              deleteChapters(downloadedChapterIds);
            }
          });
        }),
      });
    }

    actions.push({
      icon: 'bookmark-outline',
      onPress: finish(() => bookmarkChapters(selectedIds)),
    });

    if (
      hasUnloadedSelection ||
      selectedChapters.some(chapter => chapter.unread)
    ) {
      actions.push({
        icon: 'check',
        onPress: finish(() => markChaptersRead(selectedIds)),
      });
    }

    if (
      hasUnloadedSelection ||
      selectedChapters.some(chapter => !chapter.unread)
    ) {
      actions.push({
        icon: 'check-outline',
        onPress: finish(() => {
          void markChaptersUnreadAndResetProgress(selectedIds);
        }),
      });
    }

    if (selectedChapters.length === 1) {
      const selectedChapter = selectedChapters[0];
      actions.push({
        icon: selectedChapter.unread ? 'playlist-check' : 'playlist-remove',
        onPress: finish(() => {
          if (selectedChapter.unread) {
            markPreviouschaptersRead(selectedChapter.id);
          } else {
            markPreviousChaptersUnread(selectedChapter.id);
          }
        }),
      });
    }

    return actions;
  }, [
    bookmarkChapters,
    clearSelection,
    deleteChapters,
    downloadChapters,
    markChaptersRead,
    markChaptersUnreadAndResetProgress,
    markPreviousChaptersUnread,
    markPreviouschaptersRead,
    novel,
    selectedIds,
    selectedChapters,
  ]);

  return {
    deleteDownloadedChapters,
    downloadAvailableChapters,
    downloadChapterRange,
    downloadChapters,
    downloadFromSelected,
    selectionActions,
    shareNovel,
  };
};
