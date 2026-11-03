import { describe, it, expect } from 'vitest';
import {
  detectInstrumentalGaps,
  detectOutroStart,
  getCountdownState,
  INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
  isInOutro,
  LINE_LEAD_OUT_SECONDS,
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

describe('detectOutroStart', () => {
  const line = (id: number, start: number, end: number): LyricLine => ({
    id,
    text: `Line ${id}`,
    start_time: start,
    end_time: end,
    words: [],
  });

  it('keeps a line on the stage for 1.0s after it ends', () => {
    expect(LINE_LEAD_OUT_SECONDS).toBe(1.0);
  });

  it('has no outro for empty, missing or untimed lyrics', () => {
    expect(detectOutroStart([])).toBeNull();
    expect(detectOutroStart(undefined as unknown as LyricLine[])).toBeNull();
    expect(detectOutroStart([line(1, NaN, 4), line(2, 9, Infinity)])).toBeNull();
  });

  it('starts the outro when the last line has left the stage', () => {
    expect(detectOutroStart([line(1, 1, 4), line(2, 9, 12)])).toBe(13);
  });

  it('uses the latest end time for unsorted or overlapping lines', () => {
    expect(detectOutroStart([line(2, 10, 14), line(1, 1, 16)])).toBe(17);
  });

  it('skips lines with non-finite times', () => {
    expect(detectOutroStart([line(1, 1, 4), line(2, NaN, 30), line(3, 5, Infinity)])).toBe(5);
  });

  it('has no outro when every line is at 0/0, as untimed pasted lyrics are', () => {
    expect(detectOutroStart([line(1, 0, 0), line(2, 0, 0)])).toBeNull();
    expect(detectOutroStart([line(1, -3, -1)])).toBeNull();
  });

  it('returns the last end time with no lead-out', () => {
    expect(detectOutroStart([line(1, 1, 4), line(2, 9, 12)], 0)).toBe(12);
  });
});

describe('isInOutro', () => {
  it('starts strictly after the outro start and has no upper bound', () => {
    expect(isInOutro(13, 13)).toBe(false);
    expect(isInOutro(13.001, 13)).toBe(true);
    expect(isInOutro(9999, 13)).toBe(true);
  });

  it('is never in the outro without one or without a valid time', () => {
    expect(isInOutro(50, null)).toBe(false);
    expect(isInOutro(NaN, 13)).toBe(false);
  });
});
