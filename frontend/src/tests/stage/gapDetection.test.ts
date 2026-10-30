import { describe, it, expect } from 'vitest';
import {
  detectInstrumentalGaps,
  getCountdownState,
  INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
} from '../../utils/gapDetection';
import { LyricLine } from '../../types';

describe('detectInstrumentalGaps', () => {
  it('exports INSTRUMENTAL_GAP_THRESHOLD_SECONDS constant as 4.0', () => {
    expect(INSTRUMENTAL_GAP_THRESHOLD_SECONDS).toBe(4.0);
  });

  it('returns empty array for empty or undefined lines', () => {
    expect(detectInstrumentalGaps([])).toEqual([]);
    expect(detectInstrumentalGaps(undefined as unknown as LyricLine[])).toEqual([]);
  });

  it('detects intro gap >= 4.0s', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'First line', start_time: 5.5, end_time: 8.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      startTime: 0,
      endTime: 5.5,
      duration: 5.5,
      isIntro: true,
      nextLineIndex: 0,
    });
  });

  it('ignores intro gap < 4.0s', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'First line', start_time: 3.9, end_time: 7.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(0);
  });

  it('detects inter-line gap >= 4.0s (instrumental bridge)', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'Line 1', start_time: 1.0, end_time: 4.0, words: [] },
      { id: 2, text: 'Line 2', start_time: 9.0, end_time: 12.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      startTime: 4.0,
      endTime: 9.0,
      duration: 5.0,
      isIntro: false,
      nextLineIndex: 1,
    });
  });

  it('ignores inter-line gap < 4.0s', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'Line 1', start_time: 1.0, end_time: 4.0, words: [] },
      { id: 2, text: 'Line 2', start_time: 7.5, end_time: 10.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(0);
  });

  it('ignores negative gaps and overlapping lines', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'Line 1', start_time: 1.0, end_time: 6.0, words: [] },
      { id: 2, text: 'Line 2', start_time: 4.0, end_time: 8.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(0);
  });

  it('handles unsorted lines defensibly', () => {
    const lines: LyricLine[] = [
      { id: 2, text: 'Second line', start_time: 10.0, end_time: 14.0, words: [] },
      { id: 1, text: 'First line', start_time: 1.0, end_time: 4.0, words: [] },
    ];
    const gaps = detectInstrumentalGaps(lines);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startTime).toBe(4.0);
    expect(gaps[0].endTime).toBe(10.0);
  });

  it('respects custom threshold parameter', () => {
    const lines: LyricLine[] = [
      { id: 1, text: 'First line', start_time: 2.5, end_time: 5.0, words: [] },
    ];
    expect(detectInstrumentalGaps(lines, 2.0)).toHaveLength(1);
    expect(detectInstrumentalGaps(lines, 3.0)).toHaveLength(0);
  });
});

describe('getCountdownState', () => {
  const gaps = [
    {
      startTime: 0,
      endTime: 10.0,
      duration: 10.0,
      isIntro: true,
      nextLineIndex: 0,
      nextLine: { id: 1, text: 'Intro ends', start_time: 10.0, end_time: 13.0, words: [] },
    },
    {
      startTime: 15.0,
      endTime: 25.0,
      duration: 10.0,
      isIntro: false,
      nextLineIndex: 1,
      nextLine: { id: 2, text: 'Bridge ends', start_time: 25.0, end_time: 30.0, words: [] },
    },
  ];

  it('returns valid countdown state during intro', () => {
    const state = getCountdownState(2.5, gaps);
    expect(state.hasGap).toBe(true);
    expect(state.remainingTime).toBe(7.5);
    expect(state.progress).toBeCloseTo(0.25, 2);
    expect(state.progressPct).toBeCloseTo(25, 1);
    expect(state.countdownSeconds).toBe(8);
    expect(state.isLeadIn).toBe(false);
  });

  it('activates isLeadIn during final 3 seconds of a gap', () => {
    const state = getCountdownState(8.5, gaps);
    expect(state.hasGap).toBe(true);
    expect(state.remainingTime).toBe(1.5);
    expect(state.countdownSeconds).toBe(2);
    expect(state.isLeadIn).toBe(true);
  });

  it('deactivates immediately when currentTime reaches gap endTime', () => {
    const state = getCountdownState(10.0, gaps);
    expect(state.hasGap).toBe(false);
    expect(state.gap).toBeNull();
  });

  it('handles bridge gaps properly', () => {
    const state = getCountdownState(18.0, gaps);
    expect(state.hasGap).toBe(true);
    expect(state.gap?.isIntro).toBe(false);
    expect(state.remainingTime).toBe(7.0);
    expect(state.progress).toBeCloseTo(0.3, 2);
  });

  it('returns inactive state for negative or NaN currentTime', () => {
    expect(getCountdownState(-1, gaps).hasGap).toBe(false);
    expect(getCountdownState(NaN, gaps).hasGap).toBe(false);
  });

  it('returns inactive state when currentTime is between gaps', () => {
    expect(getCountdownState(12.0, gaps).hasGap).toBe(false);
  });
});
