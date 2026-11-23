/**
 * Stage lyric size
 *
 * The lyric size setting scales the line being sung, and the line waiting under it by as much.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { getStageLook } from '../../theme/stageLooks';
import { LyricLine } from '../../types';

const lines: LyricLine[] = [
  {
    id: 1,
    start_time: 1.0,
    end_time: 4.5,
    text: 'City lights are humming low',
    singer: 'singer1',
    words: [
      { word: 'City', start_time: 1.0, end_time: 1.6 },
      { word: 'lights', start_time: 1.7, end_time: 2.8 },
      { word: 'are', start_time: 2.9, end_time: 3.4 },
      { word: 'humming', start_time: 3.5, end_time: 3.9 },
      { word: 'low', start_time: 4.0, end_time: 4.5 },
    ],
  },
  {
    id: 2,
    start_time: 5.5,
    end_time: 9.0,
    text: 'Every window glowing like a sign',
    singer: 'singer1',
    words: [
      { word: 'Every', start_time: 5.5, end_time: 6.2 },
      { word: 'window', start_time: 6.3, end_time: 7.0 },
      { word: 'glowing', start_time: 7.1, end_time: 7.8 },
      { word: 'like', start_time: 7.9, end_time: 8.2 },
      { word: 'a', start_time: 8.3, end_time: 8.4 },
      { word: 'sign', start_time: 8.5, end_time: 9.0 },
    ],
  },
];

/** The em sizes (in u) of the line being sung and of the line waiting under it. */
function sizesAt(scale: number) {
  // Cinema keeps one size for its lines, so only the setting changes them
  const { unmount } = render(
    <LyricDisplay
      lines={lines}
      currentTime={2.0}
      isPlaying
      fontSizeScale={scale}
      selectedTheme={getStageLook('cinema')}
    />
  );
  const sizeOf = (row: HTMLElement) => Number(row.style.getPropertyValue('--size'));
  const sizes = {
    active: sizeOf(screen.getByTestId('active-lyrics-line')),
    next: sizeOf(screen.getByTestId('stage-line')),
  };
  unmount();
  return sizes;
}

describe('stage lyric size', () => {
  it('scales the line being sung and the next line with the lyric size', () => {
    const standard = sizesAt(1);
    expect(standard.active).toBeGreaterThan(standard.next);
    expect(standard.next).toBeGreaterThan(0);

    for (const scale of [0.5, 2]) {
      const sizes = sizesAt(scale);
      expect(sizes.active).toBeCloseTo(standard.active * scale, 5);
      expect(sizes.next).toBeCloseTo(standard.next * scale, 5);
    }
  });
});
