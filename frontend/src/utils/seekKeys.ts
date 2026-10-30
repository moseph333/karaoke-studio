/**
 * Keyboard seeking on timeline sliders, matching the global shortcuts: ←/→ (and ↓/↑) move
 * 5 s, with Shift 1 s; Page Down / Page Up move 15 s; Home and End jump to the start and end.
 */

export const SEEK_STEP_SEC = 5;
export const FINE_SEEK_STEP_SEC = 1;
export const COARSE_SEEK_STEP_SEC = 15;

/** The time a seek key moves to, or null when the key does not seek. */
export function seekTargetForKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  current: number,
  duration: number
): number | null {
  const end = Math.max(0, duration);
  const clamp = (t: number) => Math.min(end, Math.max(0, t));
  const step = e.shiftKey ? FINE_SEEK_STEP_SEC : SEEK_STEP_SEC;
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(current - step);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(current + step);
    case 'PageDown':
      return clamp(current - COARSE_SEEK_STEP_SEC);
    case 'PageUp':
      return clamp(current + COARSE_SEEK_STEP_SEC);
    case 'Home':
      return 0;
    case 'End':
      return end;
    default:
      return null;
  }
}
