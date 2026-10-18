/**
 * Lyric Editor State Hook
 *
 * Manages mutable lyric lines, line/word nudging, inline text editing,
 * insertion, deletion, dirty state tracking, multi-step undo/redo history,
 * batch offset timestamp shifting, and live tap-to-sync mode.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LyricLine, WordTiming } from '../types';
import { useToast } from './useToast';
import { useLyricHistory } from './useLyricHistory';
import {
  recalculateWordTimings,
  calculateLineInsertTimes,
  sanitizeTimestamp,
  applyBatchOffset,
} from '../utils/lyrics';

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
  const [isTapToSyncActive, setIsTapToSyncActive] = useState(false);
  const [tapTargetIndex, setTapTargetIndex] = useState(0);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Multi-step Undo / Redo history stack hook
  const { canUndo, canRedo, pushSnapshot, handleUndo, handleRedo, clearHistory } = useLyricHistory({
    currentLines: editableLines,
    onApplySnapshot: (restored) => setEditableLines(restored),
  });

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
  };

  const handleTriggerTap = useCallback(() => {
    if (tapTargetIndex >= editableLines.length) {
      setIsTapToSyncActive(false);
      return;
    }

    pushSnapshot(editableLines);
    const tapTime = sanitizeTimestamp(currentTime);
    const currentTarget = editableLines[tapTargetIndex];

    const updated = editableLines.map((line, idx) => {
      if (idx === tapTargetIndex - 1 && line.end_time > tapTime) {
        const safeStart = Math.min(line.start_time, tapTime);
        return {
          ...line,
          start_time: safeStart,
          end_time: tapTime,
          words: recalculateWordTimings(line.text, safeStart, tapTime),
        };
      }
      if (idx === tapTargetIndex) {
        let proposedEnd =
          line.end_time > tapTime ? line.end_time : sanitizeTimestamp(tapTime + 3.0);
        if (duration > tapTime + 0.5 && proposedEnd > duration) {
          proposedEnd = sanitizeTimestamp(duration);
        }
        if (proposedEnd <= tapTime) {
          proposedEnd = sanitizeTimestamp(tapTime + 0.5);
        }
        return {
          ...line,
          start_time: tapTime,
          end_time: proposedEnd,
          words: recalculateWordTimings(line.text, tapTime, proposedEnd),
        };
      }
      return line;
    });

    setEditableLines(updated);

    const nextIndex = tapTargetIndex + 1;
    if (nextIndex >= editableLines.length) {
      setIsTapToSyncActive(false);
      setTapTargetIndex(0);
      setSelectedLineId(currentTarget.id);
      toast.success('Tap sync complete! Review and Save.');
    } else {
      setTapTargetIndex(nextIndex);
      setSelectedLineId(editableLines[nextIndex]?.id ?? null);
    }
  }, [tapTargetIndex, editableLines, currentTime, duration, pushSnapshot, toast]);

  useEffect(() => {
    if (!isTapToSyncActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName.toLowerCase() === 'input' ||
          target.tagName.toLowerCase() === 'textarea' ||
          target.isContentEditable ||
          target.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleTriggerTap();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTapToSyncActive, handleTriggerTap]);

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
    isTapToSyncActive,
    setIsTapToSyncActive,
    tapTargetIndex,
    setTapTargetIndex,
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
