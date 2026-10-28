/**
 * Global Keyboard Shortcuts Hook
 *
 * Manages application-wide keyboard shortcuts (Space for play/pause, Left/Right arrows
 * for seeking, 'M' for mute/unmute, and '?' for toggling Help & Usage Guide).
 * Enforces strict input isolation (inputs, textareas, contenteditable, ARIA text controls)
 * and modal isolation (blocking transport shortcuts when dialogs are active).
 *
 * Milestone 3 Precision Shortcuts:
 * - Shift + ArrowLeft / Shift + ArrowRight: fine 1-second seeking (standard is 5s)
 * - Alt + ArrowLeft / Alt + ArrowRight: coarse 15-second seeking
 * - '[' and ']': jump to previous / next lyric line in the project
 * - 'R': replay current active line from its start time
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { LyricLine } from '../types';

export interface UseKeyboardShortcutsOptions {
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
  onToggleMute?: () => void;
  onToggleHelp?: () => void;
  onToggleVisualizer?: () => void;
  onToggleChordBar?: () => void;
  onNextLine?: () => void;
  onPrevLine?: () => void;
  onReplayLine?: () => void;
  lines?: LyricLine[];
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  currentTime?: number;
  duration?: number;
  enabled?: boolean;
  seekStep?: number;
  fineSeekStep?: number;
  coarseSeekStep?: number;
  precisionSeeking?: boolean;
}

/**
 * Returns true if the target element (or active document element) is an interactive input
 * or form control where keystrokes should be isolated from global media shortcuts.
 */
export function isInputElement(element?: EventTarget | null): boolean {
  const target =
    arguments.length === 0
      ? typeof document !== 'undefined'
        ? document.activeElement
        : null
      : element;

  if (!target || !(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (
    target.isContentEditable ||
    target.contentEditable === 'true' ||
    target.contentEditable === '' ||
    target.getAttribute('contenteditable') === 'true' ||
    target.getAttribute('contenteditable') === '' ||
    target.closest?.('[contenteditable="true"], [contenteditable=""]')
  ) {
    return true;
  }

  const role = target.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'slider') {
    return true;
  }

  if (
    target.closest?.(
      'input, textarea, select, [role="textbox"], [role="searchbox"], [role="spinbutton"], [role="slider"]'
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true if a modal dialog is currently open in the DOM or the target is inside one.
 */
export function isModalActive(element?: EventTarget | null): boolean {
  if (typeof document !== 'undefined') {
    const openDialog = document.querySelector(
      'dialog[open], dialog, [role="dialog"], [aria-modal="true"]'
    );
    if (openDialog) return true;
  }
  if (element && element instanceof HTMLElement) {
    if (element.closest?.('dialog, [role="dialog"], [aria-modal="true"]')) return true;
  }
  return false;
}

/**
 * Returns true if another modal dialog (other than the Help modal) is currently open in the DOM.
 */
export function isOtherModalActive(): boolean {
  if (typeof document === 'undefined') return false;
  const otherDialog = document.querySelector(
    '[role="dialog"]:not([data-modal="help"]), [aria-modal="true"]:not([data-modal="help"])'
  );
  return Boolean(otherDialog);
}

/**
 * Helper to locate active lyric line index by current playhead timestamp.
 */
export function findActiveLineIndex(
  lines: ReadonlyArray<Pick<LyricLine, 'start_time' | 'end_time'>>,
  time: number
): number {
  if (!lines || lines.length === 0) return -1;
  if (time < lines[0].start_time) return 0;
  if (time >= lines[lines.length - 1].start_time) return lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (time >= line.start_time && time <= line.end_time) {
      return i;
    }
    if (i < lines.length - 1 && time > line.end_time && time < lines[i + 1].start_time) {
      return i;
    }
  }
  return 0;
}

export function useKeyboardShortcuts({
  onTogglePlay,
  onSeek,
  onToggleMute,
  onToggleHelp,
  onToggleVisualizer,
  onToggleChordBar,
  onNextLine,
  onPrevLine,
  onReplayLine,
  lines,
  audioRef,
  currentTime = 0,
  duration = 0,
  enabled = true,
  seekStep = 5,
  fineSeekStep,
  coarseSeekStep,
  precisionSeeking,
}: UseKeyboardShortcutsOptions): void {
  const optionsRef = useRef({
    onTogglePlay,
    onSeek,
    onToggleMute,
    onToggleHelp,
    onToggleVisualizer,
    onToggleChordBar,
    onNextLine,
    onPrevLine,
    onReplayLine,
    lines,
    audioRef,
    currentTime,
    duration,
    seekStep,
    fineSeekStep,
    coarseSeekStep,
    precisionSeeking,
  });

  // Sync in the commit phase so a keypress right after a re-render never sees stale
  // handlers (e.g. a second Space press toggling play again instead of pausing).
  useLayoutEffect(() => {
    optionsRef.current = {
      onTogglePlay,
      onSeek,
      onToggleMute,
      onToggleHelp,
      onToggleVisualizer,
      onToggleChordBar,
      onNextLine,
      onPrevLine,
      onReplayLine,
      lines,
      audioRef,
      currentTime,
      duration,
      seekStep,
      fineSeekStep,
      coarseSeekStep,
      precisionSeeking,
    };
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isPrecisionActive = Boolean(
        optionsRef.current.precisionSeeking ||
        optionsRef.current.fineSeekStep !== undefined ||
        optionsRef.current.coarseSeekStep !== undefined
      );

      // 1. Ignore if Ctrl or Meta/Command is held (system hotkeys)
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      // If Alt is held:
      // When precision seeking is not active, Alt suppresses shortcuts across all keys.
      // When precision seeking is active, Alt is permitted solely for coarse seeking via ArrowLeft/ArrowRight.
      if (e.altKey && (!isPrecisionActive || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'))) {
        return;
      }

      // Feature: Help modal toggle shortcut '?' (Shift + /)
      if (e.key === '?') {
        const isTargetInput =
          isInputElement(e.target) ||
          (typeof document !== 'undefined' && isInputElement(document.activeElement));

        if (!isTargetInput && !isOtherModalActive() && !e.repeat) {
          e.preventDefault();
          optionsRef.current.onToggleHelp?.();
        }
        return;
      }

      // 2. Ignore if user is interacting with an input or an open modal
      if (
        isInputElement(e.target) ||
        (typeof document !== 'undefined' && isInputElement(document.activeElement)) ||
        isModalActive(e.target)
      ) {
        return;
      }

      const {
        onTogglePlay: playFn,
        onSeek: seekFn,
        onToggleMute: muteFn,
        audioRef: audio,
        currentTime: curTime,
        duration: totalDur,
        seekStep: step,
        fineSeekStep: fineStep = 1,
        coarseSeekStep: coarseStep = 15,
        lines: projectLines,
      } = optionsRef.current;

      const current =
        audio?.current && !isNaN(audio.current.currentTime) ? audio.current.currentTime : curTime;

      const maxDuration = Math.max(
        0,
        audio?.current && !isNaN(audio.current.duration) ? audio.current.duration : totalDur
      );

      // Feature 41.1: Spacebar toggle master play/pause
      if (e.code === 'Space' || e.key === ' ') {
        if (e.altKey) return;
        e.preventDefault();
        if (e.repeat) return;
        playFn?.();
        return;
      }

      // Feature 41.2 & UX-6: ArrowLeft seeking (Standard 5s, Shift 1s fine, Alt 15s coarse)
      if (e.key === 'ArrowLeft') {
        if (e.shiftKey && !isPrecisionActive) return;
        e.preventDefault();
        const stepSize = e.shiftKey ? fineStep : e.altKey ? coarseStep : step;
        const target = Math.max(0, current - stepSize);
        seekFn?.(target);
        return;
      }

      // Feature 41.3 & UX-6: ArrowRight seeking (Standard 5s, Shift 1s fine, Alt 15s coarse)
      if (e.key === 'ArrowRight') {
        if (e.shiftKey && !isPrecisionActive) return;
        e.preventDefault();
        const stepSize = e.shiftKey ? fineStep : e.altKey ? coarseStep : step;
        const target = Math.min(maxDuration, current + stepSize);
        seekFn?.(target);
        return;
      }

      // Feature 41.4: 'M' / 'm' toggle master mute/unmute
      if (e.key === 'm' || e.key === 'M') {
        if (e.altKey) return;
        e.preventDefault();
        if (e.repeat) return;
        muteFn?.();
        return;
      }

      // Feature R3: 'V' / 'v' toggle beat-reactive audio visualizer
      if (e.key === 'v' || e.key === 'V') {
        if (e.altKey || e.shiftKey) return;
        e.preventDefault();
        if (e.repeat) return;
        optionsRef.current.onToggleVisualizer?.();
        return;
      }

      // Feature F8 / R2: 'C' / 'c' toggle Live Chord Bar
      if (e.key === 'c' || e.key === 'C') {
        if (e.altKey || e.shiftKey) return;
        e.preventDefault();
        if (e.repeat) return;
        optionsRef.current.onToggleChordBar?.();
        return;
      }

      // UX-6: '[' jump to previous lyric line in project
      if (e.key === '[') {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (e.repeat) return;
        if (optionsRef.current.onPrevLine) {
          optionsRef.current.onPrevLine();
          return;
        }
        if (projectLines && projectLines.length > 0 && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          const targetIdx = Math.max(0, activeIdx - 1);
          seekFn(projectLines[targetIdx].start_time);
        }
        return;
      }

      // UX-6: ']' jump to next lyric line in project
      if (e.key === ']') {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (e.repeat) return;
        if (optionsRef.current.onNextLine) {
          optionsRef.current.onNextLine();
          return;
        }
        if (projectLines && projectLines.length > 0 && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          const targetIdx = Math.min(projectLines.length - 1, activeIdx + 1);
          seekFn(projectLines[targetIdx].start_time);
        }
        return;
      }

      // UX-6: 'R' / 'r' replay current active lyric line from start time
      if (e.key === 'r' || e.key === 'R') {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (e.repeat) return;
        if (optionsRef.current.onReplayLine) {
          optionsRef.current.onReplayLine();
          return;
        }
        if (projectLines && projectLines.length > 0 && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          if (activeIdx >= 0 && activeIdx < projectLines.length) {
            seekFn(projectLines[activeIdx].start_time);
          } else {
            seekFn(0);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
