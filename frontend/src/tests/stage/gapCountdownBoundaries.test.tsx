import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import {
  detectInstrumentalGaps,
  getCountdownState,
  INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
} from '../../utils/gapDetection';
import { LyricLine } from '../../types';

describe('Adversarial Gap Detection Stress Testing (Milestone 3 Challenge)', () => {
  describe('1. Exact Boundary Tests (3.99s vs 4.00s vs 4.01s)', () => {
    it('evaluates intro gap strictly at 4.00s threshold', () => {
      expect(INSTRUMENTAL_GAP_THRESHOLD_SECONDS).toBe(4.0);

      // 3.99s intro: below threshold -> 0 gaps
      const intro399: LyricLine[] = [
        { id: 1, text: 'Near intro', start_time: 3.99, end_time: 7.0, words: [] },
      ];
      expect(detectInstrumentalGaps(intro399)).toHaveLength(0);

      // 3.999999s intro: below threshold -> 0 gaps
      const intro3999: LyricLine[] = [
        { id: 1, text: 'Epsilon below', start_time: 3.999999, end_time: 7.0, words: [] },
      ];
      expect(detectInstrumentalGaps(intro3999)).toHaveLength(0);

      // 4.00s intro: exactly at threshold -> 1 gap
      const intro400: LyricLine[] = [
        { id: 1, text: 'Exact threshold', start_time: 4.0, end_time: 7.0, words: [] },
      ];
      const gaps400 = detectInstrumentalGaps(intro400);
      expect(gaps400).toHaveLength(1);
      expect(gaps400[0].startTime).toBe(0);
      expect(gaps400[0].endTime).toBe(4.0);
      expect(gaps400[0].duration).toBe(4.0);
      expect(gaps400[0].isIntro).toBe(true);

      // 4.01s intro: above threshold -> 1 gap
      const intro401: LyricLine[] = [
        { id: 1, text: 'Slightly above', start_time: 4.01, end_time: 7.0, words: [] },
      ];
      const gaps401 = detectInstrumentalGaps(intro401);
      expect(gaps401).toHaveLength(1);
      expect(gaps401[0].duration).toBeCloseTo(4.01, 2);
    });

    it('evaluates inter-line gap strictly at 4.00s threshold', () => {
      // Inter-line gap 3.99s: 8.99 - 5.00 = 3.99s -> 0 gaps
      const inter399: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 8.99, end_time: 12.0, words: [] },
      ];
      expect(detectInstrumentalGaps(inter399)).toHaveLength(0);

      // Inter-line gap 4.00s: 9.00 - 5.00 = 4.00s -> 1 gap
      const inter400: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 9.0, end_time: 12.0, words: [] },
      ];
      const gaps400 = detectInstrumentalGaps(inter400);
      expect(gaps400).toHaveLength(1);
      expect(gaps400[0].startTime).toBe(5.0);
      expect(gaps400[0].endTime).toBe(9.0);
      expect(gaps400[0].duration).toBe(4.0);
      expect(gaps400[0].isIntro).toBe(false);

      // Inter-line gap 4.01s: 9.01 - 5.00 = 4.01s -> 1 gap
      const inter401: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 9.01, end_time: 12.0, words: [] },
      ];
      const gaps401 = detectInstrumentalGaps(inter401);
      expect(gaps401).toHaveLength(1);
      expect(gaps401[0].duration).toBeCloseTo(4.01, 2);
    });
  });

  describe('2. Pathological Timings: 0 Duration, Overlaps, Negative Durations & Out-of-Order Lines', () => {
    it('handles exact zero duration gap between lines', () => {
      const zeroGap: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 5.0, end_time: 8.0, words: [] },
      ];
      expect(detectInstrumentalGaps(zeroGap)).toHaveLength(0);
    });

    it('discards negative duration gaps (overlapping lines)', () => {
      const overlapping: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 8.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 4.0, end_time: 9.0, words: [] },
        { id: 3, text: 'Line 3', start_time: 7.0, end_time: 11.0, words: [] },
      ];
      expect(detectInstrumentalGaps(overlapping)).toHaveLength(0);
    });

    it('correctly sorts out-of-order lines and detects genuine gaps in chronological order', () => {
      // Lines provided in reverse chronological order:
      // Line 3: 20.0 - 24.0
      // Line 1: 1.0 - 4.0
      // Line 2: 10.0 - 14.0
      // Expected chronological gaps:
      // - Intro: 0.0 to 1.0 (< 4.0s -> no gap)
      // - Gap 1: 4.0 to 10.0 (duration 6.0s -> gap!)
      // - Gap 2: 14.0 to 20.0 (duration 6.0s -> gap!)
      const outOfOrder: LyricLine[] = [
        { id: 3, text: 'Third', start_time: 20.0, end_time: 24.0, words: [] },
        { id: 1, text: 'First', start_time: 1.0, end_time: 4.0, words: [] },
        { id: 2, text: 'Second', start_time: 10.0, end_time: 14.0, words: [] },
      ];

      const gaps = detectInstrumentalGaps(outOfOrder);
      expect(gaps).toHaveLength(2);

      expect(gaps[0].startTime).toBe(4.0);
      expect(gaps[0].endTime).toBe(10.0);
      expect(gaps[0].duration).toBe(6.0);
      expect(gaps[0].nextLine.text).toBe('Second');

      expect(gaps[1].startTime).toBe(14.0);
      expect(gaps[1].endTime).toBe(20.0);
      expect(gaps[1].duration).toBe(6.0);
      expect(gaps[1].nextLine.text).toBe('Third');
    });

    it('safely filters out non-finite, NaN, Infinity, and null line objects', () => {
      const corruptedLines = [
        null as unknown as LyricLine,
        undefined as unknown as LyricLine,
        { id: 99, text: 'NaN line', start_time: NaN, end_time: 10.0, words: [] },
        { id: 98, text: 'Inf line', start_time: 2.0, end_time: Infinity, words: [] },
        { id: 1, text: 'Valid 1', start_time: 5.0, end_time: 8.0, words: [] },
        { id: 2, text: 'Valid 2', start_time: 16.0, end_time: 19.0, words: [] },
      ];

      const gaps = detectInstrumentalGaps(corruptedLines as LyricLine[]);
      expect(gaps).toHaveLength(2);
      // Gap 1: intro [0.0, 5.0]
      expect(gaps[0].isIntro).toBe(true);
      expect(gaps[0].endTime).toBe(5.0);
      // Gap 2: inter-line [8.0, 16.0]
      expect(gaps[1].isIntro).toBe(false);
      expect(gaps[1].startTime).toBe(8.0);
      expect(gaps[1].endTime).toBe(16.0);
    });
  });

  describe('3. Empty & Single Lyric Line Scenarios', () => {
    it('returns empty array on empty lyric list and getCountdownState returns hasGap: false', () => {
      const gaps = detectInstrumentalGaps([]);
      expect(gaps).toEqual([]);

      const state = getCountdownState(5.0, gaps);
      expect(state.hasGap).toBe(false);
      expect(state.gap).toBeNull();
      expect(state.remainingTime).toBe(0);
      expect(state.progress).toBe(0);
      expect(state.progressPct).toBe(0);
      expect(state.countdownSeconds).toBe(0);
      expect(state.isLeadIn).toBe(false);
    });

    it('single lyric line starting at 0.0s does not generate an intro gap', () => {
      const lineAtZero: LyricLine[] = [
        { id: 1, text: 'Singing starts immediately', start_time: 0.0, end_time: 4.0, words: [] },
      ];
      const gaps = detectInstrumentalGaps(lineAtZero);
      expect(gaps).toHaveLength(0);
    });

    it('single lyric line starting at 10.0s generates an intro gap of exactly 10.0s', () => {
      const lineAtTen: LyricLine[] = [
        { id: 1, text: 'Singing starts at 10s', start_time: 10.0, end_time: 14.0, words: [] },
      ];
      const gaps = detectInstrumentalGaps(lineAtTen);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].isIntro).toBe(true);
      expect(gaps[0].startTime).toBe(0.0);
      expect(gaps[0].endTime).toBe(10.0);
      expect(gaps[0].duration).toBe(10.0);

      // Verify countdown progress across this intro gap
      const stateMid = getCountdownState(5.0, gaps);
      expect(stateMid.hasGap).toBe(true);
      expect(stateMid.remainingTime).toBe(5.0);
      expect(stateMid.progress).toBe(0.5);
      expect(stateMid.progressPct).toBe(50);
      expect(stateMid.countdownSeconds).toBe(5);
      expect(stateMid.isLeadIn).toBe(false);

      const stateLeadIn = getCountdownState(8.5, gaps);
      expect(stateLeadIn.hasGap).toBe(true);
      expect(stateLeadIn.remainingTime).toBe(1.5);
      expect(stateLeadIn.countdownSeconds).toBe(2);
      expect(stateLeadIn.isLeadIn).toBe(true);
    });
  });

  describe('4. Rapid Playback Scrubbing & Seeking Across Gap Boundaries', () => {
    const gaps = [
      {
        startTime: 10.0,
        endTime: 20.0,
        duration: 10.0,
        isIntro: false,
        nextLineIndex: 1,
        nextLine: { id: 2, text: 'Post-bridge line', start_time: 20.0, end_time: 25.0, words: [] },
      },
    ];

    it('accurately resolves states across every micro-boundary of the gap', () => {
      // 1. Immediately before gap start (t = 9.999) -> inactive
      const beforeStart = getCountdownState(9.999, gaps);
      expect(beforeStart.hasGap).toBe(false);

      // 2. Exact gap start boundary (t = 10.000) -> active, progress 0
      const atStart = getCountdownState(10.0, gaps);
      expect(atStart.hasGap).toBe(true);
      expect(atStart.remainingTime).toBe(10.0);
      expect(atStart.progress).toBe(0.0);
      expect(atStart.progressPct).toBe(0.0);
      expect(atStart.countdownSeconds).toBe(10);
      expect(atStart.isLeadIn).toBe(false);

      // 3. Middle of gap (t = 15.000) -> active, progress 0.5
      const atMid = getCountdownState(15.0, gaps);
      expect(atMid.hasGap).toBe(true);
      expect(atMid.remainingTime).toBe(5.0);
      expect(atMid.progress).toBe(0.5);
      expect(atMid.progressPct).toBe(50.0);
      expect(atMid.countdownSeconds).toBe(5);
      expect(atMid.isLeadIn).toBe(false);

      // 4. Exact lead-in boundary (t = 17.000, 3s remaining) -> isLeadIn becomes true
      const atLeadIn = getCountdownState(17.0, gaps);
      expect(atLeadIn.hasGap).toBe(true);
      expect(atLeadIn.remainingTime).toBe(3.0);
      expect(atLeadIn.countdownSeconds).toBe(3);
      expect(atLeadIn.isLeadIn).toBe(true);

      // 5. Final fractional second (t = 19.990, 0.01s remaining) -> isLeadIn true, countdownSeconds = 1
      const nearEnd = getCountdownState(19.99, gaps);
      expect(nearEnd.hasGap).toBe(true);
      expect(nearEnd.remainingTime).toBeCloseTo(0.01, 2);
      expect(nearEnd.countdownSeconds).toBe(1);
      expect(nearEnd.isLeadIn).toBe(true);

      // 6. Exact gap end boundary (t = 20.000) -> deactivates immediately
      const atEnd = getCountdownState(20.0, gaps);
      expect(atEnd.hasGap).toBe(false);
      expect(atEnd.gap).toBeNull();

      // 7. After gap end (t = 20.001) -> inactive
      const afterEnd = getCountdownState(20.001, gaps);
      expect(afterEnd.hasGap).toBe(false);
    });

    it('survives random chaotic scrubbing without state leakage or NaN', () => {
      // Simulate extreme user scrubbing
      const chaoticTimes = [
        -10.0, 0.0, 9.999, 10.0, 10.001, 14.2, 19.999, 20.0, 20.0001, 50.0, 12.345, 17.0, 18.99,
        -0.001, 20.0, 10.0,
      ];

      for (const t of chaoticTimes) {
        const state = getCountdownState(t, gaps);
        expect(typeof state.hasGap).toBe('boolean');
        expect(Number.isFinite(state.remainingTime)).toBe(true);
        expect(Number.isFinite(state.progress)).toBe(true);
        expect(Number.isFinite(state.progressPct)).toBe(true);
        expect(Number.isFinite(state.countdownSeconds)).toBe(true);

        if (t >= 10.0 && t < 20.0) {
          expect(state.hasGap).toBe(true);
          expect(state.progress).toBeGreaterThanOrEqual(0);
          expect(state.progress).toBeLessThanOrEqual(1);
        } else {
          expect(state.hasGap).toBe(false);
        }
      }
    });
  });

  describe('5. Clean DOM Transition & No Ghost Frames in LyricDisplay', () => {
    const testLines: LyricLine[] = [
      {
        id: 1,
        text: 'First verse singing',
        start_time: 2.0,
        end_time: 5.0,
        words: [{ word: 'First', start_time: 2.0, end_time: 5.0 }],
      },
      {
        id: 2,
        text: 'Second verse after bridge',
        start_time: 12.0, // 7.0s gap from 5.0 to 12.0
        end_time: 16.0,
        singer: 'singer2',
        words: [{ word: 'Second', start_time: 12.0, end_time: 16.0 }],
      },
    ];

    it('renders countdown indicator before next line and cleans it up immediately at currentTime >= nextLine.start_time', () => {
      // At t = 11.90 (0.1s before line 2 starts at 12.0)
      const { rerender } = render(<LyricDisplay lines={testLines} currentTime={11.9} />);

      // Countdown indicator and progressbar MUST be present
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('gap-countdown-progressbar')).toBeInTheDocument();
      expect(screen.getByTestId('gap-countdown-time')).toHaveTextContent('Next vocals in 1s');
      // Active lyric line must NOT be present yet
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // Step forward to exact boundary: t = 12.00
      rerender(<LyricDisplay lines={testLines} currentTime={12.0} />);

      // Countdown indicator MUST be completely unmounted (0 ghost frames)
      expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('gap-countdown-progressbar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('gap-countdown-time')).not.toBeInTheDocument();

      // Active lyrics line MUST be mounted
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toBeInTheDocument();
      expect(screen.getAllByText('Second').length).toBeGreaterThanOrEqual(1);

      // Ensure no orphaned progressbar elements in the DOM
      expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
      expect(document.querySelectorAll('[data-testid="gap-countdown-indicator"]')).toHaveLength(0);
    });

    it('handles scrubbing back and forth across boundary without DOM corruption', () => {
      const { rerender } = render(<LyricDisplay lines={testLines} currentTime={8.0} />);

      // Inside gap: countdown active
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // Scrub forward past line start
      rerender(<LyricDisplay lines={testLines} currentTime={13.0} />);
      expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();

      // Scrub backward back into gap
      rerender(<LyricDisplay lines={testLines} currentTime={9.5} />);
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // Scrub forward to exact boundary 12.0
      rerender(<LyricDisplay lines={testLines} currentTime={12.0} />);
      expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    });

    it('renders cleanly on empty lines array without crashing or rendering phantom countdowns', () => {
      render(<LyricDisplay lines={[]} currentTime={10.0} />);
      expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
      expect(screen.getByText('-- End of song --')).toBeInTheDocument();
    });
  });
});
