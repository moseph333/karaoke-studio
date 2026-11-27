/** The repeat rule: where a pass starts, where it turns, and when playback is left alone. */
import { describe, it, expect } from 'vitest';
import {
  LEAD_IN_SEC,
  TAIL_SEC,
  WRAP_WINDOW_SEC,
  insideLoop,
  loopStart,
  loopStep,
  loopTurn,
} from '../../utils/practiceLoop';

const range = { start: 26, end: 40.5 };

describe('the repeat rule', () => {
  it('starts each pass a lead-in before the stretch, never before the song', () => {
    expect(loopStart(range)).toBe(26 - LEAD_IN_SEC);
    expect(loopStart({ start: 1, end: 5 })).toBe(0);
  });

  it('turns a moment after the last line', () => {
    expect(loopTurn(range, 64)).toBeCloseTo(40.5 + TAIL_SEC);
    expect(loopTurn(range, 0)).toBeCloseTo(40.5 + TAIL_SEC);
  });

  it('turns before the song ends, where playback would stop', () => {
    expect(loopTurn({ start: 50, end: 63.9 }, 64)).toBeCloseTo(63.7);
    expect(loopTurn({ start: 50, end: 63.9 }, 64)).toBeLessThan(64);
  });

  it('goes round when playback reaches the turn', () => {
    expect(loopStep(range, 41.0, 64)).toBeNull();
    expect(loopStep(range, 41.1, 64)).toEqual({ seekTo: 24 });
    expect(loopStep(range, 41.3, 64)).toEqual({ seekTo: 24 });
  });

  it('leaves playback alone far past the turn: the listener went there', () => {
    expect(loopStep(range, 41.1 + WRAP_WINDOW_SEC, 64)).toBeNull();
    expect(loopStep(range, 5, 64)).toBeNull();
  });

  it('knows when a position is inside a pass', () => {
    expect(insideLoop(range, 24, 64)).toBe(true);
    expect(insideLoop(range, 41, 64)).toBe(true);
    expect(insideLoop(range, 23.9, 64)).toBe(false);
    expect(insideLoop(range, 41.2, 64)).toBe(false);
  });
});
