/**
 * "Next lyric line" during the intro, before the first line starts, goes to line 1: the
 * "]" key, and the palette and media keys through lineStartAtOffset.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { lineStartAtOffset } from '../../utils/lineNavigation';
import type { LyricLine } from '../../types';

const lines: LyricLine[] = [10, 20, 30].map((start, i) => ({
  id: i + 1,
  text: `line ${i + 1}`,
  start_time: start,
  end_time: start + 5,
  words: [],
}));

function pressNextLineAt(time: number) {
  const onSeek = vi.fn();
  const { unmount } = renderHook(() =>
    useKeyboardShortcuts({ onSeek, lines, currentTime: time, duration: 60 })
  );
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
  unmount();
  return onSeek;
}

describe('next lyric line before the first line', () => {
  it('seeks to line 1 with the "]" key during the intro', () => {
    expect(pressNextLineAt(2)).toHaveBeenCalledWith(10);
  });

  it('still steps to the following line once a line is playing', () => {
    expect(pressNextLineAt(12)).toHaveBeenCalledWith(20);
    expect(pressNextLineAt(17)).toHaveBeenCalledWith(20);
  });

  it('gives line 1 as the next line, and as the current and previous one, during the intro', () => {
    expect(lineStartAtOffset(lines, 2, 1)).toBe(10);
    expect(lineStartAtOffset(lines, 2, 0)).toBe(10);
    expect(lineStartAtOffset(lines, 2, -1)).toBe(10);
    expect(lineStartAtOffset(lines, 12, 1)).toBe(20);
  });
});
