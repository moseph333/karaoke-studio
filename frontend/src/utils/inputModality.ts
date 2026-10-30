/**
 * Input Modality
 *
 * Whether the last input was the keyboard or a pointer. Focus that arrives by keyboard is
 * where the user is reading and working, so it must not be scrolled away (the timeline's
 * auto-scroll pauses for it); focus that follows a click can be.
 */

let lastInput: 'keyboard' | 'pointer' = 'pointer';

if (typeof document !== 'undefined') {
  // Capture phase: recorded before any handler moves focus in response
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) lastInput = 'keyboard';
    },
    true
  );
  for (const type of ['pointerdown', 'mousedown', 'touchstart'] as const) {
    document.addEventListener(
      type,
      () => {
        lastInput = 'pointer';
      },
      true
    );
  }
}

export function lastInputWasKeyboard(): boolean {
  return lastInput === 'keyboard';
}

/** Back to "pointer", as at page load (tests reset it between cases). */
export function resetInputModality(): void {
  lastInput = 'pointer';
}
