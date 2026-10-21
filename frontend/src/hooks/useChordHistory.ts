/**
 * Harmonic Chord History & Editing State Hook
 *
 * Implements a bounded 50-step Undo / Redo history stack for chord progression edits,
 * dirty tracking, global keyboard shortcuts (Ctrl+Z / Ctrl+Y / Cmd+Z / Cmd+Shift+Z),
 * and persistence to POST /api/project/${projectId}/chords.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChordSegment } from '../types';
import { apiFetch } from '../api';

const DEFAULT_EMPTY_CHORDS: ChordSegment[] = [];

export interface UseChordHistoryOptions {
  projectId?: string;
  initialChords?: ChordSegment[];
  currentChords?: ChordSegment[];
  maxHistory?: number;
  enabled?: boolean;
  onApplySnapshot?: (chords: ChordSegment[], direction?: 'undo' | 'redo') => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onSaveSuccess?: (savedChords: ChordSegment[]) => void;
}

const cloneChords = (chords: ChordSegment[]): ChordSegment[] => {
  return chords.map((c) => ({ ...c }));
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

export function useChordHistory({
  projectId,
  initialChords = DEFAULT_EMPTY_CHORDS,
  currentChords,
  maxHistory = 50,
  enabled = true,
  onApplySnapshot,
  onDirtyChange,
  onSaveSuccess,
}: UseChordHistoryOptions = {}) {
  const [undoStack, setUndoStack] = useState<ChordSegment[][]>([]);
  const [redoStack, setRedoStack] = useState<ChordSegment[][]>([]);
  const [baselineChords, setBaselineChords] = useState<ChordSegment[]>(initialChords);
  const [isSaving, setIsSaving] = useState(false);

  const undoStackRef = useRef<ChordSegment[][]>([]);
  const redoStackRef = useRef<ChordSegment[][]>([]);
  const currentChordsRef = useRef<ChordSegment[] | undefined>(currentChords);
  const onApplySnapshotRef = useRef<
    ((chords: ChordSegment[], direction?: 'undo' | 'redo') => void) | undefined
  >(onApplySnapshot);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSaveSuccessRef = useRef(onSaveSuccess);

  useEffect(() => {
    currentChordsRef.current = currentChords;
  }, [currentChords]);

  useEffect(() => {
    onApplySnapshotRef.current = onApplySnapshot;
  }, [onApplySnapshot]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    onSaveSuccessRef.current = onSaveSuccess;
  }, [onSaveSuccess]);

  // Sync baseline when initialChords change (preserves undo/redo stack across saves)
  const prevProjectIdRef = useRef(projectId);
  const prevInitialRef = useRef(initialChords);
  useEffect(() => {
    const projectChanged = prevProjectIdRef.current !== projectId;
    if (projectChanged) {
      prevProjectIdRef.current = projectId;
      prevInitialRef.current = initialChords;
      setBaselineChords(initialChords);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoStack([]);
      setRedoStack([]);
      return;
    }

    if (prevInitialRef.current !== initialChords) {
      if (prevInitialRef.current.length === 0 && initialChords.length === 0) {
        prevInitialRef.current = initialChords;
        return;
      }
      prevInitialRef.current = initialChords;
      setBaselineChords(initialChords);
    }
  }, [projectId, initialChords]);

  const isDirty = useMemo(() => {
    const active = currentChords ?? [];
    return JSON.stringify(active) !== JSON.stringify(baselineChords);
  }, [currentChords, baselineChords]);

  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty);
  }, [isDirty]);

  const updateBaseline = useCallback((chords: ChordSegment[]) => {
    setBaselineChords(cloneChords(chords));
  }, []);

  const pushSnapshot = useCallback(
    (chords: ChordSegment[]) => {
      const snapshot = cloneChords(chords);
      undoStackRef.current.push(snapshot);
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      setUndoStack([...undoStackRef.current]);
      setRedoStack([]);
    },
    [maxHistory]
  );

  const undo = useCallback((chordsToSave?: ChordSegment[]): ChordSegment[] | null => {
    if (undoStackRef.current.length === 0) return null;
    const targetChords = chordsToSave ?? currentChordsRef.current;
    if (!targetChords) return null;

    const previous = undoStackRef.current.pop()!;
    redoStackRef.current.push(cloneChords(targetChords));
    setUndoStack([...undoStackRef.current]);
    setRedoStack([...redoStackRef.current]);
    return cloneChords(previous);
  }, []);

  const redo = useCallback(
    (chordsToSave?: ChordSegment[]): ChordSegment[] | null => {
      if (redoStackRef.current.length === 0) return null;
      const targetChords = chordsToSave ?? currentChordsRef.current;
      if (!targetChords) return null;

      const next = redoStackRef.current.pop()!;
      undoStackRef.current.push(cloneChords(targetChords));
      if (undoStackRef.current.length > maxHistory) {
        undoStackRef.current.shift();
      }
      setUndoStack([...undoStackRef.current]);
      setRedoStack([...redoStackRef.current]);
      return cloneChords(next);
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
    if (!currentChordsRef.current || !onApplySnapshotRef.current) return;
    const prev = undo(currentChordsRef.current);
    if (prev) {
      onApplySnapshotRef.current(prev, 'undo');
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    if (!currentChordsRef.current || !onApplySnapshotRef.current) return;
    const next = redo(currentChordsRef.current);
    if (next) {
      onApplySnapshotRef.current(next, 'redo');
    }
  }, [redo]);

  const saveChords = useCallback(
    async (chordsToSave?: ChordSegment[]): Promise<boolean> => {
      const target = chordsToSave ?? currentChordsRef.current;
      if (!projectId || !target || isSaving) return false;

      // Validate intervals
      for (let i = 0; i < target.length; i++) {
        const c = target[i];
        if (c.start >= c.end) {
          throw new Error(
            `Invalid chord interval for ${c.chord}: start must be strictly less than end.`
          );
        }
        if (i < target.length - 1 && c.end > target[i + 1].start) {
          throw new Error(
            `Overlapping chords: "${c.chord}" (end ${c.end}) overlaps "${target[i + 1].chord}" (start ${target[i + 1].start}).`
          );
        }
      }

      setIsSaving(true);
      try {
        const res = await apiFetch(`/api/project/${projectId}/chords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chords: target }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Server returned HTTP ${res.status}`);
        }

        updateBaseline(target);
        onSaveSuccessRef.current?.(target);
        return true;
      } finally {
        setIsSaving(false);
      }
    },
    [projectId, isSaving, updateBaseline]
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputElement(e.target)) return;

      const isMac =
        typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      // Undo: Ctrl+Z / Cmd+Z without Shift
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Redo: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleUndo, handleRedo]);

  return {
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    isDirty,
    isSaving,
    pushSnapshot,
    undo,
    redo,
    clearHistory,
    handleUndo,
    handleRedo,
    saveChords,
    setBaselineChords,
    updateBaseline,
  };
}
