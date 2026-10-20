/**
 * Lyric Editor State Hook
 *
 * Manages mutable lyric lines, line/word nudging, inline text editing,
 * insertion, deletion, dirty state tracking, multi-step undo/redo history,
 * batch offset timestamp shifting, and live tap-to-sync mode.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LyricLine, WordTiming, SingerRole, BulkAssignOptions } from '../types';
import { useToast } from './useToast';
import { useLyricHistory } from './useLyricHistory';
import {
  recalculateWordTimings,
  calculateLineInsertTimes,
  sanitizeTimestamp,
  applyBatchOffset,
} from '../utils/lyrics';
import { useTapCursorHistory } from './useTapCursorHistory';

export interface UseLyricEditorStateOptions {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  onSaveLines: (updatedLines: LyricLine[]) => Promise<void | boolean> | void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function useLyricEditorState({
  lines,
  currentTime,
  duration,
  onSaveLines,
  onDirtyChange,
}: UseLyricEditorStateOptions) {
  const { toast } = useToast();
  const [editableLines, setEditableLines] = useState<LyricLine[]>(lines);
  const [initialLines, setInitialLines] = useState<LyricLine[]>(lines);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [lineToDelete, setLineToDelete] = useState<LyricLine | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const recordTapCursorSnapshotRef = useRef<() => void>(() => {});
  const restoreTapCursorSnapshotRef = useRef<(direction?: 'undo' | 'redo') => number | null>(
    () => null
  );

  const handleApplySnapshot = useCallback((restored: LyricLine[], direction?: 'undo' | 'redo') => {
    setEditableLines(restored);
    const restoredTargetIndex = restoreTapCursorSnapshotRef.current(direction);
    if (restoredTargetIndex !== null) {
      setSelectedLineId(restored[restoredTargetIndex]?.id ?? null);
    }
  }, []);

  // Multi-step Undo / Redo history stack hook
  const {
    canUndo,
    canRedo,
    pushSnapshot: pushRawSnapshot,
    handleUndo,
    handleRedo,
    clearHistory: clearRawHistory,
  } = useLyricHistory({
    currentLines: editableLines,
    onApplySnapshot: handleApplySnapshot,
  });

  const pushSnapshot = useCallback(
    (linesToSave: LyricLine[]) => {
      recordTapCursorSnapshotRef.current();
      pushRawSnapshot(linesToSave);
    },
    [pushRawSnapshot]
  );

  const {
    isTapToSyncActive,
    setIsTapToSyncActive,
    tapSyncMode,
    setTapSyncMode,
    tapTargetIndex,
    setTapTargetIndex,
    tapTargetWordIndex,
    setTapTargetWordIndex,
    handleTriggerTap,
    recordTapCursorSnapshot,
    restoreTapCursorSnapshot,
    clearTapCursorHistory,
  } = useTapCursorHistory({
    editableLines,
    currentTime,
    duration,
    pushSnapshot,
    setEditableLines,
    setSelectedLineId,
    toast,
  });

  recordTapCursorSnapshotRef.current = recordTapCursorSnapshot;
  restoreTapCursorSnapshotRef.current = restoreTapCursorSnapshot;

  const clearHistory = useCallback(() => {
    clearRawHistory();
    clearTapCursorHistory();
  }, [clearRawHistory, clearTapCursorHistory]);

  useEffect(() => {
    if (editingLineId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLineId]);

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(editableLines) !== JSON.stringify(initialLines),
    [editableLines, initialLines]
  );

  const prevLinesRef = useRef(lines);
  useEffect(() => {
    if (prevLinesRef.current !== lines) {
      prevLinesRef.current = lines;
      if (!hasUnsavedChanges) {
        setEditableLines(lines);
        setInitialLines(lines);
        clearHistory();
      }
    }
  }, [lines, hasUnsavedChanges, clearHistory]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved lyric timing changes. Are you sure you want to leave?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const clampWordBoundary = (
    words: WordTiming[],
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => {
    const targetWord = words[wordIndex];
    if (!targetWord) return;
    if (field === 'start_time') {
      const prevStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
      const nextStart = wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
      targetWord.start_time = sanitizeTimestamp(
        Math.min(targetWord.end_time, nextStart, Math.max(prevStart, value))
      );
    } else {
      targetWord.end_time = sanitizeTimestamp(Math.max(targetWord.start_time, value));
    }
  };

  const nudgeLine = (lineId: number, offset: number) => {
    pushSnapshot(editableLines);
    setEditableLines(
      editableLines.map((l) => {
        if (l.id !== lineId) return l;
        const minStart = Math.min(l.start_time, ...l.words.map((w) => w.start_time));
        const eff = offset < 0 ? Math.max(offset, -minStart) : offset;
        const start = sanitizeTimestamp(l.start_time + eff);
        const end = Math.max(start, sanitizeTimestamp(l.end_time + eff));
        const words = l.words.map((w) => ({
          ...w,
          start_time: sanitizeTimestamp(w.start_time + eff),
          end_time: Math.max(
            sanitizeTimestamp(w.start_time + eff),
            sanitizeTimestamp(w.end_time + eff)
          ),
        }));
        return { ...l, start_time: start, end_time: end, words };
      })
    );
  };

  const nudgeWordBoundary = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => {
    pushSnapshot(editableLines);
    setEditableLines(
      editableLines.map((l) => {
        if (l.id !== lineId) return l;
        const words = l.words.map((w) => ({ ...w }));
        clampWordBoundary(words, wordIndex, field, (words[wordIndex]?.[field] ?? 0) + delta);
        return {
          ...l,
          start_time: Math.min(...words.map((w) => w.start_time)),
          end_time: Math.max(...words.map((w) => w.end_time)),
          words,
        };
      })
    );
  };

  const nudgeWord = (lineId: number, wordIndex: number, delta: number) => {
    pushSnapshot(editableLines);
    setEditableLines(
      editableLines.map((l) => {
        if (l.id !== lineId) return l;
        const words = l.words.map((w) => ({ ...w }));
        const target = words[wordIndex];
        if (!target) return l;
        const dur = sanitizeTimestamp(target.end_time - target.start_time);
        const prevStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextStart = wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const clampedStart = sanitizeTimestamp(
          Math.min(nextStart, Math.max(prevStart, target.start_time + delta))
        );
        target.start_time = clampedStart;
        target.end_time = sanitizeTimestamp(clampedStart + dur);
        return {
          ...l,
          start_time: Math.min(...words.map((w) => w.start_time)),
          end_time: Math.max(...words.map((w) => w.end_time)),
          words,
        };
      })
    );
  };

  const updateWordTiming = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => {
    pushSnapshot(editableLines);
    setEditableLines(
      editableLines.map((l) => {
        if (l.id !== lineId) return l;
        const words = l.words.map((w) => ({ ...w }));
        clampWordBoundary(words, wordIndex, field, value);
        return {
          ...l,
          start_time: Math.min(...words.map((w) => w.start_time)),
          end_time: Math.max(...words.map((w) => w.end_time)),
          words,
        };
      })
    );
  };

  const handleApplyBatchOffset = (deltaSeconds: number, fromLineIndex: number = 0) => {
    pushSnapshot(editableLines);
    setEditableLines(applyBatchOffset(editableLines, deltaSeconds, fromLineIndex));
    toast.success('Batch offset applied');
  };

  const handleReplaceLyrics = (newLines: LyricLine[]) => {
    pushSnapshot(editableLines);
    setEditableLines(newLines);
    setSelectedLineId(newLines.length > 0 ? newLines[0].id : null);
    setTapTargetIndex(0);
    setTapTargetWordIndex(0);
  };

  const handleSave = async () => {
    if (!hasUnsavedChanges || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveLines(editableLines);
      setInitialLines(editableLines);
      clearHistory();
      toast.success('Lyric changes saved');
    } catch (err) {
      console.error('Failed to save lyric timings:', err);
      toast.error('Failed to save lyric timings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDiscard = () => {
    setEditableLines(initialLines);
    setEditingLineId(null);
    setEditingText('');
    setLineToDelete(null);
    setShowDiscardModal(false);
    clearHistory();
    toast.info('Lyric edits discarded');
  };

  const handleStartEditing = (line: LyricLine) => {
    setEditingLineId(line.id);
    setEditingText(line.text);
  };

  const handleCommitEditing = (lineId: number, newText: string) => {
    const trimmed = newText.trim();
    const target = editableLines.find((l) => l.id === lineId);
    if (!target) {
      setEditingLineId(null);
      return;
    }
    if (trimmed && trimmed !== target.text) {
      pushSnapshot(editableLines);
      setEditableLines(
        editableLines.map((l) =>
          l.id === lineId
            ? {
                ...l,
                text: trimmed,
                words: recalculateWordTimings(trimmed, target.start_time, target.end_time),
              }
            : l
        )
      );
    }
    setEditingLineId(null);
  };

  const insertLineHelper = (insertIdx: number, afterIdx: number) => {
    pushSnapshot(editableLines);
    const { start_time, end_time } = calculateLineInsertTimes(
      editableLines,
      afterIdx,
      currentTime,
      duration
    );
    const text = 'New lyric line';
    const newLine: LyricLine = {
      id: 0,
      text,
      start_time,
      end_time,
      words: recalculateWordTimings(text, start_time, end_time),
    };
    const newLines = [...editableLines];
    newLines.splice(insertIdx, 0, newLine);
    const reindexed = newLines.map((l, idx) => ({ ...l, id: idx + 1 }));
    setEditableLines(reindexed);
    setSelectedLineId(insertIdx + 1);
    handleStartEditing(reindexed[insertIdx]);
  };

  const handleConfirmDeleteLine = (lineId: number) => {
    pushSnapshot(editableLines);
    setEditableLines(
      editableLines.filter((l) => l.id !== lineId).map((l, idx) => ({ ...l, id: idx + 1 }))
    );
    if (selectedLineId === lineId) setSelectedLineId(null);
    if (editingLineId === lineId) setEditingLineId(null);
    setLineToDelete(null);
    toast.info('Lyric line deleted');
  };

  const handleCycleLineSinger = useCallback(
    (lineId: number) => {
      pushSnapshot(editableLines);
      setEditableLines((prev) =>
        prev.map((line) => {
          if (line.id !== lineId) return line;
          const current: SingerRole = line.singer ?? 'singer1';
          const next: SingerRole =
            current === 'singer1' ? 'singer2' : current === 'singer2' ? 'both' : 'singer1';
          return { ...line, singer: next };
        })
      );
    },
    [editableLines, pushSnapshot]
  );

  const handleSetLineSinger = useCallback(
    (lineId: number, singer: SingerRole) => {
      pushSnapshot(editableLines);
      setEditableLines((prev) =>
        prev.map((line) => (line.id === lineId ? { ...line, singer } : line))
      );
    },
    [editableLines, pushSnapshot]
  );

  const handleBulkAssignSinger = useCallback(
    (options: BulkAssignOptions) => {
      pushSnapshot(editableLines);
      const total = editableLines.length;
      if (total === 0) return;

      let updated: LyricLine[] = [];

      if (options.mode === 'range') {
        const start = Math.max(0, Math.min(total - 1, options.startLineIndex ?? 0));
        const end = Math.max(start, Math.min(total - 1, options.endLineIndex ?? total - 1));
        const targetSinger = options.singer ?? 'singer1';

        updated = editableLines.map((line, idx) => {
          if (idx >= start && idx <= end) {
            return { ...line, singer: targetSinger };
          }
          return line;
        });
      } else if (options.mode === 'alternating') {
        const pattern = options.pattern ?? '1x1';
        const s1 = options.startSinger ?? 'singer1';
        const s2: SingerRole = s1 === 'singer1' ? 'singer2' : 'singer1';

        updated = editableLines.map((line, idx) => {
          let assigned: SingerRole;
          if (pattern === '1x1') {
            assigned = idx % 2 === 0 ? s1 : s2;
          } else {
            const block = Math.floor(idx / 2);
            assigned = block % 2 === 0 ? s1 : s2;
          }
          return { ...line, singer: assigned };
        });
      } else if (options.mode === 'auto') {
        const threshold = options.pauseThreshold ?? 2.5;
        let currentSinger: SingerRole = options.startSinger ?? 'singer1';
        const otherSinger: SingerRole = currentSinger === 'singer1' ? 'singer2' : 'singer1';

        updated = editableLines.map((line, idx) => {
          if (idx === 0) {
            return { ...line, singer: currentSinger };
          }
          const prev = editableLines[idx - 1];
          const gap = line.start_time - prev.end_time;
          if (gap < -0.1) {
            return { ...line, singer: 'both' };
          }
          if (gap >= threshold) {
            currentSinger = currentSinger === 'singer1' ? otherSinger : 'singer1';
          }
          return { ...line, singer: currentSinger };
        });
      }

      setEditableLines(updated);
      toast.success('Duet parts assigned');
    },
    [editableLines, pushSnapshot, toast]
  );

  return {
    editableLines,
    selectedLineId,
    setSelectedLineId,
    isSaving,
    showDiscardModal,
    setShowDiscardModal,
    editingLineId,
    editingText,
    setEditingText,
    lineToDelete,
    setLineToDelete,
    editInputRef,
    hasUnsavedChanges,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    nudgeLine,
    nudgeWordBoundary,
    nudgeWord,
    updateWordTiming,
    handleApplyBatchOffset,
    handleReplaceLyrics,
    handleCycleLineSinger,
    handleSetLineSinger,
    handleBulkAssignSinger,
    isTapToSyncActive,
    setIsTapToSyncActive,
    tapSyncMode,
    setTapSyncMode,
    tapTargetIndex,
    setTapTargetIndex,
    tapTargetWordIndex,
    setTapTargetWordIndex,
    handleTriggerTap,
    handleSave,
    handleConfirmDiscard,
    handleStartEditing,
    handleCancelEditing: () => {
      setEditingLineId(null);
      setEditingText('');
    },
    handleCommitEditing,
    handleInsertLineAbove: (idx: number) => insertLineHelper(idx, idx - 1),
    handleInsertLineBelow: (idx: number) => insertLineHelper(idx + 1, idx),
    handleInsertLineAtEnd: () => insertLineHelper(editableLines.length, editableLines.length - 1),
    handleConfirmDeleteLine,
  };
}
