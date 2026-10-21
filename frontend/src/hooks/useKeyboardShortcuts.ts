/**
 * Global Keyboard Shortcuts Hook
 *
 * Manages application-wide keyboard shortcuts (Space for play/pause, Left/Right arrows
 * for seeking, 'M' for mute/unmute, and '?' for toggling Help & Usage Guide).
 * Enforces strict input isolation (inputs, textareas, contenteditable, ARIA text controls)
 * and modal isolation (blocking transport shortcuts when dialogs are active).
 */

import { useEffect, useRef } from 'react';

export interface UseKeyboardShortcutsOptions {
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
  onToggleMute?: () => void;
  onToggleHelp?: () => void;
  onToggleVisualizer?: () => void;
  onToggleChordBar?: () => void;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  currentTime?: number;
  duration?: number;
  enabled?: boolean;
  seekStep?: number;
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

export function useKeyboardShortcuts({
  onTogglePlay,
  onSeek,
  onToggleMute,
  onToggleHelp,
  onToggleVisualizer,
  onToggleChordBar,
  audioRef,
  currentTime = 0,
  duration = 0,
  enabled = true,
  seekStep = 5,
}: UseKeyboardShortcutsOptions): void {
  const optionsRef = useRef({
    onTogglePlay,
    onSeek,
    onToggleMute,
    onToggleHelp,
    onToggleVisualizer,
    onToggleChordBar,
    audioRef,
    currentTime,
    duration,
    seekStep,
  });

  useEffect(() => {
    optionsRef.current = {
      onTogglePlay,
      onSeek,
      onToggleMute,
      onToggleHelp,
      onToggleVisualizer,
      onToggleChordBar,
      audioRef,
      currentTime,
      duration,
      seekStep,
    };
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Ignore if any modifier key (Ctrl, Meta/Command, Alt) is held
      if (e.ctrlKey || e.metaKey || e.altKey) {
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
      } = optionsRef.current;

      const current =
        audio?.current && !isNaN(audio.current.currentTime) ? audio.current.currentTime : curTime;

      const maxDuration = Math.max(
        0,
        audio?.current && !isNaN(audio.current.duration) ? audio.current.duration : totalDur
      );

      // Feature 41.1: Spacebar toggle master play/pause
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        playFn?.();
        return;
      }

      // Feature 41.2: ArrowLeft seek backward by 5 seconds
      if (e.key === 'ArrowLeft') {
        if (e.shiftKey) return;
        e.preventDefault();
        const target = Math.max(0, current - step);
        seekFn?.(target);
        return;
      }

      // Feature 41.3: ArrowRight seek forward by 5 seconds
      if (e.key === 'ArrowRight') {
        if (e.shiftKey) return;
        e.preventDefault();
        const target = Math.min(maxDuration, current + step);
        seekFn?.(target);
        return;
      }

      // Feature 41.4: 'M' / 'm' toggle master mute/unmute
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (e.repeat) return;
        muteFn?.();
        return;
      }

      // Feature R3: 'V' / 'v' toggle beat-reactive audio visualizer
      if (e.key === 'v' || e.key === 'V') {
        if (e.shiftKey) return;
        e.preventDefault();
        if (e.repeat) return;
        optionsRef.current.onToggleVisualizer?.();
        return;
      }

      // Feature F8 / R2: 'C' / 'c' toggle Live Chord Bar
      if (e.key === 'c' || e.key === 'C') {
        if (e.shiftKey) return;
        e.preventDefault();
        if (e.repeat) return;
        optionsRef.current.onToggleChordBar?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
