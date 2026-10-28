/**
 * Marks focus moves made by code (dialog auto-focus, focus restore on close) so focus-driven
 * UI such as tooltips can skip them. Keyboard and pointer focus are unaffected.
 */

let quietTarget: Element | null = null;

/** Focuses an element without triggering focus-only affordances like tooltips. */
export function focusQuietly(el: HTMLElement | null | undefined, options?: FocusOptions): void {
  if (!el) return;
  quietTarget = el;
  try {
    el.focus(options);
  } finally {
    quietTarget = null;
  }
}

/** True while `target` is receiving focus from {@link focusQuietly}. */
export function isQuietFocus(target: EventTarget | null): boolean {
  return target !== null && target === quietTarget;
}
