/**
 * Whether single-key shortcuts (M, V, C, F, T, R, [, ], ?) are on. Speech input and some
 * keyboards type those characters by accident, so WCAG 2.1.4 asks for a way to turn them
 * off. Space, the arrow keys and Ctrl/⌘ shortcuts are not affected.
 */

const STORAGE_KEY = 'karaoke_char_shortcuts_v1';

// Used when localStorage is unavailable (e.g. sandboxed iframes)
let memoryEnabled = true;

export function characterShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return memoryEnabled;
  }
}

export function setCharacterShortcutsEnabled(enabled: boolean): void {
  memoryEnabled = enabled;
  try {
    if (enabled) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, 'off');
    }
  } catch {
    // Keep the in-memory value
  }
}
