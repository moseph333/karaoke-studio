/**
 * Lyric Editor State Hook
 *
 * Manages mutable lyric lines, line/word nudging, inline text editing,
 * insertion, deletion, dirty state tracking, and persistence.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { LyricLine } from '../types';
import { useToast } from './useToast';
import {
  recalculateWordTimings,
  calculateLineInsertTimes,
  sanitizeTimestamp,
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
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLineId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLineId]);

  // Compute dirty state via deep JSON equality
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(editableLines) !== JSON.stringify(initialLines);
  }, [editableLines, initialLines]);

  // Synchronize when parent `lines` change, but ONLY if no active unsaved changes
  const prevLinesRef = useRef(lines);
  useEffect(() => {
    if (prevLinesRef.current !== lines) {
      prevLinesRef.current = lines;
      if (!hasUnsavedChanges) {
        setEditableLines(lines);
        setInitialLines(lines);
      }
    }
  }, [lines, hasUnsavedChanges]);

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  // Browser unload guard
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved lyric timing changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // Handle nudging an entire line by offset seconds
  const nudgeLine = (lineId: number, offset: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;

      const minStart = Math.min(l.start_time, ...l.words.map((w) => w.start_time));
      const effectiveOffset = offset < 0 ? Math.max(offset, -minStart) : offset;

      const newStart = sanitizeTimestamp(l.start_time + effectiveOffset);
      const newEnd = Math.max(newStart, sanitizeTimestamp(l.end_time + effectiveOffset));
      const newWords = l.words.map((w) => {
        const wStart = sanitizeTimestamp(w.start_time + effectiveOffset);
        const wEnd = Math.max(wStart, sanitizeTimestamp(w.end_time + effectiveOffset));
        return { ...w, start_time: wStart, end_time: wEnd };
      });

      return { ...l, start_time: newStart, end_time: newEnd, words: newWords };
    });
    setEditableLines(updated);
  };

  // Handle nudging a specific word boundary ('start_time' or 'end_time')
  const nudgeWordBoundary = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;

        const proposed = targetWord.start_time + delta;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, proposed))
        );
      } else {
        const minAllowed = targetWord.start_time;
        const proposed = targetWord.end_time + delta;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, proposed));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle nudging an entire word (both start and end)
  const nudgeWord = (lineId: number, wordIndex: number, delta: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      const dur = sanitizeTimestamp(targetWord.end_time - targetWord.start_time);
      const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
      const nextWordStart =
        wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;

      const proposedStart = targetWord.start_time + delta;
      const clampedStart = sanitizeTimestamp(
        Math.min(nextWordStart, Math.max(prevWordStart, proposedStart))
      );
      targetWord.start_time = clampedStart;
      targetWord.end_time = sanitizeTimestamp(clampedStart + dur);

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle editing a single word timing with monotonic clamping
  const updateWordTiming = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => {
    const safeValue = sanitizeTimestamp(value);
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, safeValue))
        );
      } else {
        const minAllowed = targetWord.start_time;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, safeValue));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Save changes with async guard
  const handleSave = async () => {
    if (!hasUnsavedChanges || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveLines(editableLines);
      setInitialLines(editableLines);
      toast.success('Lyric changes saved');
    } catch (err) {
      console.error('Failed to save lyric timings:', err);
      toast.error('Failed to save lyric timings');
    } finally {
      setIsSaving(false);
    }
  };

  // Discard changes and revert to initialLines
  const handleConfirmDiscard = () => {
    setEditableLines(initialLines);
    setEditingLineId(null);
    setEditingText('');
    setLineToDelete(null);
    setShowDiscardModal(false);
    toast.info('Lyric edits discarded');
  };

  const handleStartEditing = (line: LyricLine) => {
    setEditingLineId(line.id);
    setEditingText(line.text);
  };

  const handleCancelEditing = () => {
    setEditingLineId(null);
    setEditingText('');
  };

  const handleCommitEditing = (lineId: number, newText: string) => {
    const trimmed = newText.trim();
    const targetLine = editableLines.find((l) => l.id === lineId);
    if (!targetLine) {
      setEditingLineId(null);
      return;
    }

    if (trimmed && trimmed !== targetLine.text) {
      const updatedWords = recalculateWordTimings(
        trimmed,
        targetLine.start_time,
        targetLine.end_time
      );
      const updated = editableLines.map((l) => {
        if (l.id !== lineId) return l;
        return {
          ...l,
          text: trimmed,
          words: updatedWords,
        };
      });
      setEditableLines(updated);
    }
    setEditingLineId(null);
  };

  const handleInsertLineAbove = (index: number) => {
    const { start_time, end_time } = calculateLineInsertTimes(
      editableLines,
      index - 1,
      currentTime,
      duration
    );
    const initialText = 'New lyric line';
    const words = recalculateWordTimings(initialText, start_time, end_time);
    const newLine: LyricLine = {
      id: 0,
      text: initialText,
      start_time,
      end_time,
      words,
    };
    const newLines = [...editableLines];
    newLines.splice(index, 0, newLine);
    const reindexed = newLines.map((l, idx) => ({ ...l, id: idx + 1 }));
    setEditableLines(reindexed);
    setSelectedLineId(index + 1);
    handleStartEditing(reindexed[index]);
  };

  const handleInsertLineBelow = (index: number) => {
    const { start_time, end_time } = calculateLineInsertTimes(
      editableLines,
      index,
      currentTime,
      duration
    );
    const initialText = 'New lyric line';
    const words = recalculateWordTimings(initialText, start_time, end_time);
    const newLine: LyricLine = {
      id: 0,
      text: initialText,
      start_time,
      end_time,
      words,
    };
    const newLines = [...editableLines];
    newLines.splice(index + 1, 0, newLine);
    const reindexed = newLines.map((l, idx) => ({ ...l, id: idx + 1 }));
    setEditableLines(reindexed);
    setSelectedLineId(index + 2);
    handleStartEditing(reindexed[index + 1]);
  };

  const handleInsertLineAtEnd = () => {
    if (editableLines.length === 0) {
      const { start_time, end_time } = calculateLineInsertTimes([], 0, currentTime, duration);
      const initialText = 'New lyric line';
      const words = recalculateWordTimings(initialText, start_time, end_time);
      const newLine: LyricLine = {
        id: 1,
        text: initialText,
        start_time,
        end_time,
        words,
      };
      setEditableLines([newLine]);
      setSelectedLineId(1);
      handleStartEditing(newLine);
      return;
    }
    handleInsertLineBelow(editableLines.length - 1);
  };

  const handleConfirmDeleteLine = (lineId: number) => {
    const filtered = editableLines.filter((l) => l.id !== lineId);
    const reindexed = filtered.map((l, idx) => ({ ...l, id: idx + 1 }));
    setEditableLines(reindexed);
    if (selectedLineId === lineId) {
      setSelectedLineId(null);
    }
    if (editingLineId === lineId) {
      setEditingLineId(null);
    }
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
    nudgeLine,
    nudgeWordBoundary,
    nudgeWord,
    updateWordTiming,
    handleSave,
    handleConfirmDiscard,
    handleStartEditing,
    handleCancelEditing,
    handleCommitEditing,
    handleInsertLineAbove,
    handleInsertLineBelow,
    handleInsertLineAtEnd,
    handleConfirmDeleteLine,
  };
}
