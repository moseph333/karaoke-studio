import { useEffect, useRef } from 'react';

export interface UseKeyboardShortcutsOptions {
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
  onToggleMute?: () => void;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  currentTime?: number;
  duration?: number;
  enabled?: boolean;
  seekStep?: number;
}

/**
 * Returns true if the target element is an interactive input or form control
 * where keystrokes should be isolated from global media shortcuts.
 */
export function isInputElement(element: EventTarget | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;

  const tagName = element.tagName.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (
    element.isContentEditable ||
    element.contentEditable === 'true' ||
    element.contentEditable === '' ||
    element.getAttribute('contenteditable') === 'true' ||
    element.getAttribute('contenteditable') === '' ||
    element.closest?.('[contenteditable="true"], [contenteditable=""]')
  ) {
    return true;
  }

  const role = element.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'slider') {
    return true;
  }

  if (element.closest?.('input, textarea, select, [role="textbox"], [role="searchbox"]')) {
    return true;
  }

  return false;
}

/**
 * Returns true if a modal dialog is currently open in the DOM or the target is inside one.
 */
export function isModalActive(element: EventTarget | null): boolean {
  if (typeof document !== 'undefined') {
    const openDialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
    if (openDialog) return true;
  }
  if (element && element instanceof HTMLElement) {
    if (element.closest?.('[role="dialog"], [aria-modal="true"]')) return true;
  }
  return false;
}

export function useKeyboardShortcuts({
  onTogglePlay,
  onSeek,
  onToggleMute,
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

      // 2. Ignore if user is interacting with an input or an open modal
      if (isInputElement(e.target) || isModalActive(e.target)) {
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
