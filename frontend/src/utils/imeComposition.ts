/**
 * Keys pressed while an input method (Japanese, Chinese, Korean…) is composing text.
 */

import type React from 'react';

/**
 * True for a keydown that belongs to the input method: Enter picks a candidate, Escape
 * cancels the composition and the arrows move through candidates, so the field's own
 * shortcuts must not act on it. Safari reports the Enter that confirms a composition after
 * `compositionend`, with `isComposing` false, but still with key code 229.
 */
export function isImeKeyEvent(e: React.KeyboardEvent | KeyboardEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e;
  return native.isComposing || native.keyCode === 229;
}
