/**
 * The active word at a line change: a finished line keeps its last word lit for half a
 * second in a pause, but hands over as soon as the next line starts.
 */
import { describe, it, expect } from 'vitest';
import { getActiveWordLocation } from '../../utils/lyrics';
import type { LyricLine } from '../../types';

const line = (id: number, start: number, end: number): LyricLine => ({
  id,
  text: 'a b',
  start_time: start,
  end_time: end,
  words: [
    { word: 'a', start_time: start, end_time: (start + end) / 2 },
    { word: 'b', start_time: (start + end) / 2, end_time: end },
  ],
});

describe('active word across a line change', () => {
  it('moves to the next line as soon as it starts', () => {
    const backToBack = [line(1, 1, 3), line(2, 3.1, 5)];
    expect(getActiveWordLocation(backToBack, 3.2)).toMatchObject({ lineId: 2, wordIndex: 0 });
    expect(getActiveWordLocation(backToBack, 3.05)).toMatchObject({ lineId: 1, wordIndex: 1 });
  });

  it('keeps the last word lit briefly when a pause follows', () => {
    const withPause = [line(1, 1, 3), line(2, 8, 10)];
    expect(getActiveWordLocation(withPause, 3.4)).toMatchObject({ lineId: 1, wordIndex: 1 });
    expect(getActiveWordLocation(withPause, 3.6)).toBeNull();
  });

  it('keeps a line that is still being sung over one that starts during it', () => {
    const overlapping = [line(1, 1, 4), line(2, 3, 6)];
    expect(getActiveWordLocation(overlapping, 3.5)).toMatchObject({ lineId: 1, wordIndex: 1 });
    expect(getActiveWordLocation(overlapping, 4.2)).toMatchObject({ lineId: 2, wordIndex: 0 });
  });
});
