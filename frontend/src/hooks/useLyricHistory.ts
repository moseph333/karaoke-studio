/**
 * Lyric History Stack Hook
 *
 * Implements a bounded 50-step Undo / Redo history stack for lyric timeline edits,
 * global keyboard shortcuts (Ctrl+Z / Ctrl+Y), and input field isolation.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { LyricLine } from '../types';
import {
  isUndoRoutedElsewhere,
  noteUndo,
  noteUndoableEdit,
  registerUndoScope,
} from '../utils/undoRouter';

export interface UseLyricHistoryOptions {
  maxHistory?: number;
  currentLines?: LyricLine[];
  onApplySnapshot?: (lines: LyricLine[], direction?: 'undo' | 'redo') => void;
}

const cloneLines = (lines: LyricLine[]): LyricLine[] => {
  return lines.map((l) => ({
    ...l,
    words: l.words ? l.words.map((w) => ({ ...w })) : [],
  }));
};

const isInputElement = (el: EventTarget | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true'
  );
};

export function useLyricHistory({
  maxHistory = 50,
  currentLines,
  onApplySnapshot,
}: UseLyricHistoryOptions = {}) {
  const [undoStack, setUndoStack] = useState<LyricLine[][]>([]);
  const [redoStack, setRedoStack] = useState<LyricLine[][]>([]);

  const undoStackRef = useRef<LyricLine[][]>([]);
  const redoStackRef = useRef<LyricLine[][]>([]);
  const currentLinesRef = useRef<LyricLine[] | undefined>(currentLines);
  const onApplySnapshotRef = useRef<
    ((lines: LyricLine[], direction?: 'undo' | 'redo') => void) | undefined
  >(onApplySnapshot);

  useEffect(() => {
    currentLinesRef.current = currentLines;
  }, [currentLines]);

  useEffect(() => {
    onApplySnapshotRef.current = onApplySnapshot;
  }, [onApplySnapshot]);

  const pushSnapshot = useCallback(
    (lines: LyricLine[]) => {
      const snapshot = cloneLines(lines);
      undoStackRef.current.push(snapshot);
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      setUndoStack([...undoStackRef.current]);
      setRedoStack([]);
      noteUndoableEdit('lyrics');
    },
    [maxHistory]
  );

  const undo = useCallback((linesToSave?: LyricLine[]): LyricLine[] | null => {
    if (undoStackRef.current.length === 0) return null;
    const targetLines = linesToSave ?? currentLinesRef.current;
    if (!targetLines) return null;

    const previous = undoStackRef.current.pop()!;
    redoStackRef.current.push(cloneLines(targetLines));
    setUndoStack([...undoStackRef.current]);
    setRedoStack([...redoStackRef.current]);
    noteUndo('lyrics');
    return cloneLines(previous);
  }, []);

  const redo = useCallback(
    (linesToSave?: LyricLine[]): LyricLine[] | null => {
      if (redoStackRef.current.length === 0) return null;
      const targetLines = linesToSave ?? currentLinesRef.current;
      if (!targetLines) return null;

      const next = redoStackRef.current.pop()!;
      undoStackRef.current.push(cloneLines(targetLines));
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }
      setUndoStack([...undoStackRef.current]);
      setRedoStack([...redoStackRef.current]);
      noteUndoableEdit('lyrics');
      return cloneLines(next);
    },
    [maxHistory]
  );

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    if (!currentLinesRef.current || !onApplySnapshotRef.current) return;
    const prev = undo(currentLinesRef.current);
    if (prev) {
      onApplySnapshotRef.current(prev, 'undo');
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    if (!currentLinesRef.current || !onApplySnapshotRef.current) return;
    const next = redo(currentLinesRef.current);
    if (next) {
      onApplySnapshotRef.current(next, 'redo');
    }
  }, [redo]);

  useEffect(
    () =>
      registerUndoScope('lyrics', {
        canUndo: () => undoStackRef.current.length > 0,
        canRedo: () => redoStackRef.current.length > 0,
      }),
    []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputElement(e.target)) return;

      const isMac =
        typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      // Undo: Ctrl+Z / Cmd+Z without Shift
      if (key === 'z' && !e.shiftKey) {
        if (isUndoRoutedElsewhere('lyrics', 'undo', e)) return;
        e.preventDefault();
        handleUndo();
      }
      // Redo: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (isUndoRoutedElsewhere('lyrics', 'redo', e)) return;
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    pushSnapshot,
    undo,
    redo,
    clearHistory,
    handleUndo,
    handleRedo,
  };
}
