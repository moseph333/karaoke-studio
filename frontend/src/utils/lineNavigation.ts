/**
 * Lyric-line stepping shared by the command palette and media keys.
 */

import { LyricLine } from '../types';
import { findActiveLineIndex } from '../hooks/useKeyboardShortcuts';

/**
 * Start time of the line `offset` steps from the one playing at `time` (0 = current line,
 * -1 = previous, 1 = next), clamped to the song. Null when there are no lines.
 */
export function lineStartAtOffset(
  lines: ReadonlyArray<Pick<LyricLine, 'start_time' | 'end_time'>>,
  time: number,
  offset: number
): number | null {
  if (lines.length === 0) return null;
  // Before the first line nothing is playing yet: "next" is line 1, not line 2
  const active = time < lines[0].start_time ? -1 : findActiveLineIndex(lines, time);
  const target = Math.min(lines.length - 1, Math.max(0, active + offset));
  return lines[target].start_time;
}
