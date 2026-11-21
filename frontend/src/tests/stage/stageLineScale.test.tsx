/**
 * Stage lyric size
 *
 * The lyric size setting scales the line being sung. The next line follows at three quarters
 * of that, but never drops below 0.7em, so it stays readable at the smallest setting.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
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

function sizesAt(scale: number) {
  render(<LyricDisplay lines={lines} currentTime={2.0} isPlaying fontSizeScale={scale} />);
  return {
    active: screen.getByTestId('active-lyrics-line').style.fontSize,
    next: screen.getByTestId('upcoming-lyrics-line').style.fontSize,
  };
}

describe('stage lyric size', () => {
  it('keeps the next line at 0.7em when the lyric size is tiny', () => {
    expect(sizesAt(0.1)).toEqual({ active: '0.1em', next: '0.7em' });
  });

  it('keeps the next line at 0.7em when the lyric size is zero', () => {
    expect(sizesAt(0)).toEqual({ active: '0em', next: '0.7em' });
  });

  it('scales the next line to three quarters of a large lyric size', () => {
    expect(sizesAt(3.5)).toEqual({ active: '3.5em', next: '2.625em' });
  });
});
