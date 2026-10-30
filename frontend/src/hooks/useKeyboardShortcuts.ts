/**
 * Global Keyboard Shortcuts Hook
 *
 * Manages application-wide keyboard shortcuts (Space for play/pause, Left/Right arrows
 * for seeking, 'M' for mute/unmute, and '?' for toggling Help & Usage Guide).
 * Enforces strict input isolation (inputs, textareas, contenteditable, ARIA text controls)
 * and modal isolation (blocking transport shortcuts when dialogs are active).
 *
 * Precision shortcuts:
 * - Shift + ArrowLeft / Shift + ArrowRight: fine 1-second seeking (standard is 5s)
 * - Alt + ArrowLeft / Alt + ArrowRight: coarse 15-second seeking
 * - '[' and ']': jump to previous / next lyric line in the project
 * - 'R': replay current active line from its start time
 *
 * Keys a focused widget already handled (arrows in a tab list, Space on a preset card) are
 * left alone, and a key is only claimed when its action is available.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { LyricLine } from '../types';
import { characterShortcutsEnabled } from '../utils/shortcutPrefs';

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
  /** Live playback position (preferred over `audioRef` and `currentTime`). */
  getCurrentTime?: () => number;
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

// Controls that the browser presses on Space. Links are not among them: Space on a link
// scrolls the page, so it stays play/pause there.
const SPACE_ACTIVATED_SELECTOR = [
  'button',
  'summary',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
].join(', ');

function isSpaceActivated(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(SPACE_ACTIVATED_SELECTOR);
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
  getCurrentTime,
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
    getCurrentTime,
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
      getCurrentTime,
      currentTime,
      duration,
      seekStep,
      fineSeekStep,
      coarseSeekStep,
      precisionSeeking,
    };
  });

  // The element under the last pointer press. A control the user just clicked keeps Space
  // as play/pause (click a lyric line, then press Space to play from it); a control reached
  // with the keyboard is pressed by Space, as everywhere else on the web.
  const pointerPressedRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (e: Event) => {
      pointerPressedRef.current = e.target;
    };

    const wasPointerPressed = (target: EventTarget | null) => {
      const pressed = pointerPressedRef.current;
      return target instanceof Node && pressed instanceof Node && target.contains(pressed);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') pointerPressedRef.current = null;

      // A focused widget handled this key itself (arrows in tabs or radio groups, Space on a
      // preset card); acting on it too would also seek or toggle playback
      if (e.defaultPrevented) return;

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

      // '?' (Shift + /) toggles the Help dialog
      if (e.key === '?') {
        const isTargetInput =
          isInputElement(e.target) ||
          (typeof document !== 'undefined' && isInputElement(document.activeElement));
        const toggleHelp = optionsRef.current.onToggleHelp;

        if (
          !isTargetInput &&
          !isOtherModalActive() &&
          !e.repeat &&
          toggleHelp &&
          characterShortcutsEnabled()
        ) {
          e.preventDefault();
          toggleHelp();
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
        getCurrentTime: readTime,
        currentTime: curTime,
        duration: totalDur,
        seekStep: step,
        fineSeekStep: fineStep = 1,
        coarseSeekStep: coarseStep = 15,
        lines: projectLines,
      } = optionsRef.current;

      const current = readTime
        ? readTime()
        : audio?.current && !isNaN(audio.current.currentTime)
          ? audio.current.currentTime
          : curTime;

      const maxDuration = Math.max(
        0,
        audio?.current && !isNaN(audio.current.duration) ? audio.current.duration : totalDur
      );

      // Each branch below claims its key (preventDefault) only when its action is available,
      // so Space and the arrows still scroll and press buttons in the library and while a
      // song processes

      // Space: play / pause
      if (e.code === 'Space' || e.key === ' ') {
        if (e.altKey || !playFn) return;
        if (isSpaceActivated(e.target) && !wasPointerPressed(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        playFn();
        return;
      }

      // ←/→: seek 5 s, Shift 1 s (fine), Alt 15 s (coarse)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if ((e.shiftKey && !isPrecisionActive) || !seekFn) return;
        e.preventDefault();
        const stepSize = e.shiftKey ? fineStep : e.altKey ? coarseStep : step;
        seekFn(
          e.key === 'ArrowLeft'
            ? Math.max(0, current - stepSize)
            : Math.min(maxDuration, current + stepSize)
        );
        return;
      }

      // The rest are single-character shortcuts, which can be turned off
      if (!characterShortcutsEnabled()) return;

      // M: mute / unmute
      if (e.key === 'm' || e.key === 'M') {
        if (e.altKey || !muteFn) return;
        e.preventDefault();
        if (e.repeat) return;
        muteFn();
        return;
      }

      // V: beat visualizer
      if (e.key === 'v' || e.key === 'V') {
        const toggleVisualizer = optionsRef.current.onToggleVisualizer;
        if (e.altKey || e.shiftKey || !toggleVisualizer) return;
        e.preventDefault();
        if (e.repeat) return;
        toggleVisualizer();
        return;
      }

      // C: chord bar
      if (e.key === 'c' || e.key === 'C') {
        const toggleChordBar = optionsRef.current.onToggleChordBar;
        if (e.altKey || e.shiftKey || !toggleChordBar) return;
        e.preventDefault();
        if (e.repeat) return;
        toggleChordBar();
        return;
      }

      const canStepLines = Boolean(projectLines && projectLines.length > 0 && seekFn);

      // [: previous lyric line
      if (e.key === '[') {
        const { onPrevLine } = optionsRef.current;
        if (e.altKey || !(onPrevLine || canStepLines)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (onPrevLine) {
          onPrevLine();
        } else if (projectLines && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          seekFn(projectLines[Math.max(0, activeIdx - 1)].start_time);
        }
        return;
      }

      // ]: next lyric line
      if (e.key === ']') {
        const { onNextLine } = optionsRef.current;
        if (e.altKey || !(onNextLine || canStepLines)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (onNextLine) {
          onNextLine();
        } else if (projectLines && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          seekFn(projectLines[Math.min(projectLines.length - 1, activeIdx + 1)].start_time);
        }
        return;
      }

      // R: replay the current lyric line from its start
      if (e.key === 'r' || e.key === 'R') {
        const { onReplayLine } = optionsRef.current;
        if (e.altKey || !(onReplayLine || canStepLines)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (onReplayLine) {
          onReplayLine();
        } else if (projectLines && seekFn) {
          const activeIdx = findActiveLineIndex(projectLines, current);
          seekFn(
            activeIdx >= 0 && activeIdx < projectLines.length
              ? projectLines[activeIdx].start_time
              : 0
          );
        }
        return;
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
