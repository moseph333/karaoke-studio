/**
 * The repeat rule of practice: a stretch of the song plays again and again. Each pass starts a
 * little before the stretch's first line, so the singer hears the way in, and runs a moment
 * past its last line, so the last word is not cut off.
 */

/** Seconds of the song played before the stretch on each pass. */
export const LEAD_IN_SEC = 2;
/** Seconds played after the stretch's last line before going round again. */
export const TAIL_SEC = 0.6;
/** Playback this far past the turning point was a jump elsewhere, not the pass ending. */
export const WRAP_WINDOW_SEC = 2;
/** The turning point stays this far from the song's end, where playback would stop. */
const END_MARGIN_SEC = 0.3;

export interface LoopRange {
  /** Where the stretch's first line starts, in song seconds. */
  start: number;
  /** Where its last line ends. */
  end: number;
}

/** Where each pass starts: the lead-in before the stretch, never before the song. */
export function loopStart(range: LoopRange): number {
  return Math.max(0, range.start - LEAD_IN_SEC);
}

/** The moment a pass ends and playback goes back to `loopStart`. */
export function loopTurn(range: LoopRange, duration: number): number {
  const turn = range.end + TAIL_SEC;
  if (!Number.isFinite(duration) || duration <= 0) return turn;
  return Math.min(turn, Math.max(range.start, duration - END_MARGIN_SEC));
}

/** True while `time` is inside a pass: from its lead-in to its turning point. */
export function insideLoop(range: LoopRange, time: number, duration: number): boolean {
  return time >= loopStart(range) && time < loopTurn(range, duration);
}

/**
 * What playback at `time` asks of the loop: `{ seekTo }` when the pass has just ended, null
 * otherwise. A position far past the turning point is left alone: the listener went there.
 */
export function loopStep(
  range: LoopRange,
  time: number,
  duration: number
): { seekTo: number } | null {
  const turn = loopTurn(range, duration);
  if (time < turn || time >= turn + WRAP_WINDOW_SEC) return null;
  return { seekTo: loopStart(range) };
}
