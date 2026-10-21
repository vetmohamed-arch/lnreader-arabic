import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChapterInfo } from '@database/types';

export const useChapterSelection = (
  chapters: ChapterInfo[],
  getAllChapterIds: () => Promise<number[]>,
) => {
  const [selectedIds, setSelectedIdsState] = useState<number[]>([]);
  const selectionVersion = useRef(0);
  const setSelectedIds = useCallback<Dispatch<SetStateAction<number[]>>>(
    value => {
      selectionVersion.current += 1;
      setSelectedIdsState(value);
    },
    [],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedChapters = useMemo(
    () => chapters.filter(chapter => selectedIdSet.has(chapter.id)),
    [chapters, selectedIdSet],
  );
  const clearSelection = useCallback(
    () => setSelectedIds([]),
    [setSelectedIds],
  );
  const selectAll = useCallback(async () => {
    const requestVersion = ++selectionVersion.current;
    const chapterIds = await getAllChapterIds();
    if (selectionVersion.current === requestVersion) {
      setSelectedIdsState(chapterIds);
    }
  }, [getAllChapterIds]);
  // Fills the gap between the first and last selected chapters, so picking
  // two chapters selects everything from one to the other.
  const selectRange = useCallback(async () => {
    const requestVersion = ++selectionVersion.current;
    const chapterIds = await getAllChapterIds();
    if (selectionVersion.current !== requestVersion) {
      return;
    }
    setSelectedIdsState(current => {
      const picked = new Set(current);
      const indexes = chapterIds
        .map((id, index) => (picked.has(id) ? index : -1))
        .filter(index => index >= 0);
      if (indexes.length < 2) {
        return current;
      }
      const range = chapterIds.slice(
        Math.min(...indexes),
        Math.max(...indexes) + 1,
      );
      return Array.from(new Set([...current, ...range]));
    });
  }, [getAllChapterIds]);

  return {
    selectedIds,
    selectedChapters,
    setSelectedIds,
    clearSelection,
    selectAll,
    selectRange,
  };
};
