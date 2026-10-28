/**
 * Tap Cursor History Hook
 *
 * Manages live tap-to-sync state machine (mode, line/word cursor positions),
 * real-time hotkey isolation ('T' keyboard listener), monotonic tap transformations,
 * and 50-step undo/redo cursor history stacks synchronized with lyric snapshots.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LyricLine } from '../types';
import { applyLineTap, applyWordTap, TapSyncMode } from '../utils/tapSync';
import { isInputElement, isModalActive } from './useKeyboardShortcuts';

export interface TapCursorSnapshot {
  isActive: boolean;
  mode: TapSyncMode;
  targetIndex: number;
  targetWordIndex: number;
}

export interface UseTapCursorHistoryOptions {
  editableLines: LyricLine[];
  currentTime: number;
  /** Live playback clock; taps fall back to `currentTime` when omitted. */
  getCurrentTime?: () => number;
  duration: number;
  pushSnapshot: (lines: LyricLine[]) => void;
  setEditableLines: React.Dispatch<React.SetStateAction<LyricLine[]>>;
  setSelectedLineId: (id: number | null) => void;
  toast: { success: (msg: string) => void };
}

export function useTapCursorHistory({
  editableLines,
  currentTime,
  getCurrentTime,
  duration,
  pushSnapshot,
  setEditableLines,
  setSelectedLineId,
  toast,
}: UseTapCursorHistoryOptions) {
  const [isTapToSyncActive, setIsTapToSyncActive] = useState(false);
  const [tapSyncMode, setTapSyncMode] = useState<TapSyncMode>('line');
  const [tapTargetIndex, setTapTargetIndex] = useState(0);
  const [tapTargetWordIndex, setTapTargetWordIndex] = useState(0);

  const isTapToSyncActiveRef = useRef(isTapToSyncActive);
  isTapToSyncActiveRef.current = isTapToSyncActive;

  const tapSyncModeRef = useRef(tapSyncMode);
  tapSyncModeRef.current = tapSyncMode;

  const tapTargetIndexRef = useRef(tapTargetIndex);
  tapTargetIndexRef.current = tapTargetIndex;

  const tapTargetWordIndexRef = useRef(tapTargetWordIndex);
  tapTargetWordIndexRef.current = tapTargetWordIndex;

  // The `currentTime` prop only updates on media timeupdate events (~4 per second), so
  // read the live clock at the moment of the tap when one is available.
  const getCurrentTimeRef = useRef(getCurrentTime);
  getCurrentTimeRef.current = getCurrentTime;

  const tapCursorUndoStackRef = useRef<TapCursorSnapshot[]>([]);
  const tapCursorRedoStackRef = useRef<TapCursorSnapshot[]>([]);

  const handleSetTapSyncMode = useCallback((mode: TapSyncMode) => {
    setTapSyncMode(mode);
    setTapTargetWordIndex(0);
  }, []);

  const recordTapCursorSnapshot = useCallback(() => {
    tapCursorUndoStackRef.current.push({
      isActive: isTapToSyncActiveRef.current,
      mode: tapSyncModeRef.current,
      targetIndex: tapTargetIndexRef.current,
      targetWordIndex: tapTargetWordIndexRef.current,
    });
    if (tapCursorUndoStackRef.current.length > 50) {
      tapCursorUndoStackRef.current.shift();
    }
    tapCursorRedoStackRef.current = [];
  }, []);

  const restoreTapCursorSnapshot = useCallback((direction?: 'undo' | 'redo'): number | null => {
    if (direction === 'undo' && tapCursorUndoStackRef.current.length > 0) {
      const prevCursor = tapCursorUndoStackRef.current.pop()!;
      tapCursorRedoStackRef.current.push({
        isActive: isTapToSyncActiveRef.current,
        mode: tapSyncModeRef.current,
        targetIndex: tapTargetIndexRef.current,
        targetWordIndex: tapTargetWordIndexRef.current,
      });
      setIsTapToSyncActive(prevCursor.isActive);
      setTapSyncMode(prevCursor.mode);
      setTapTargetIndex(prevCursor.targetIndex);
      setTapTargetWordIndex(prevCursor.targetWordIndex);
      return prevCursor.targetIndex;
    }
    if (direction === 'redo' && tapCursorRedoStackRef.current.length > 0) {
      const nextCursor = tapCursorRedoStackRef.current.pop()!;
      tapCursorUndoStackRef.current.push({
        isActive: isTapToSyncActiveRef.current,
        mode: tapSyncModeRef.current,
        targetIndex: tapTargetIndexRef.current,
        targetWordIndex: tapTargetWordIndexRef.current,
      });
      setIsTapToSyncActive(nextCursor.isActive);
      setTapSyncMode(nextCursor.mode);
      setTapTargetIndex(nextCursor.targetIndex);
      setTapTargetWordIndex(nextCursor.targetWordIndex);
      return nextCursor.targetIndex;
    }
    return null;
  }, []);

  const clearTapCursorHistory = useCallback(() => {
    tapCursorUndoStackRef.current = [];
    tapCursorRedoStackRef.current = [];
  }, []);

  const handleTriggerTap = useCallback(() => {
    if (tapTargetIndex >= editableLines.length) {
      setIsTapToSyncActive(false);
      return;
    }

    pushSnapshot(editableLines);
    const currentTarget = editableLines[tapTargetIndex];
    const liveTime = getCurrentTimeRef.current?.();
    const tapTime =
      typeof liveTime === 'number' && Number.isFinite(liveTime) ? liveTime : currentTime;

    if (tapSyncMode === 'word') {
      const result = applyWordTap(
        editableLines,
        tapTargetIndex,
        tapTargetWordIndex,
        tapTime,
        duration
      );

      setEditableLines(result.updatedLines);

      if (result.isComplete) {
        setIsTapToSyncActive(false);
        setTapTargetIndex(0);
        setTapTargetWordIndex(0);
        setSelectedLineId(currentTarget?.id ?? null);
        toast.success('Tap sync complete! Review and Save.');
      } else {
        setTapTargetIndex(result.nextLineIndex);
        setTapTargetWordIndex(result.nextWordIndex);
        setSelectedLineId(result.updatedLines[result.nextLineIndex]?.id ?? null);
      }
    } else {
      const result = applyLineTap(editableLines, tapTargetIndex, tapTime, duration);

      setEditableLines(result.updatedLines);

      if (result.isComplete) {
        setIsTapToSyncActive(false);
        setTapTargetIndex(0);
        setTapTargetWordIndex(0);
        setSelectedLineId(currentTarget?.id ?? null);
        toast.success('Tap sync complete! Review and Save.');
      } else {
        setTapTargetIndex(result.nextLineIndex);
        setTapTargetWordIndex(0);
        setSelectedLineId(result.updatedLines[result.nextLineIndex]?.id ?? null);
      }
    }
  }, [
    tapTargetIndex,
    tapTargetWordIndex,
    tapSyncMode,
    editableLines,
    currentTime,
    duration,
    pushSnapshot,
    setEditableLines,
    setSelectedLineId,
    toast,
  ]);

  useEffect(() => {
    if (!isTapToSyncActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        isInputElement(e.target) ||
        (typeof document !== 'undefined' && isInputElement(document.activeElement)) ||
        isModalActive(e.target)
      ) {
        return;
      }
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) return;
        e.preventDefault();
        handleTriggerTap();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTapToSyncActive, handleTriggerTap]);

  return {
    isTapToSyncActive,
    setIsTapToSyncActive,
    tapSyncMode,
    setTapSyncMode: handleSetTapSyncMode,
    tapTargetIndex,
    setTapTargetIndex,
    tapTargetWordIndex,
    setTapTargetWordIndex,
    handleTriggerTap,
    recordTapCursorSnapshot,
    restoreTapCursorSnapshot,
    clearTapCursorHistory,
  };
}
