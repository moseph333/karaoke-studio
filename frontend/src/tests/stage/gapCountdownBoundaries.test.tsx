import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { STAGE_TIMING } from '../../theme/stageLooks';
import { planTimeline } from '../../utils/stageTimeline';
import { LyricLine } from '../../types';

/** The lines (by index) the stage counts in, which are the lines that follow a gap. */
const countedIn = (lines: readonly unknown[]) =>
  planTimeline(lines, null).count_ins.map(([index]) => index);

describe('Adversarial Gap Detection Stress Testing (Milestone 3 Challenge)', () => {
  describe('1. Exact Boundary Tests (3.99s vs 4.00s vs 4.01s)', () => {
    it('evaluates intro gap strictly at 4.00s threshold', () => {
      expect(STAGE_TIMING.gap_threshold).toBe(4.0);

      // 3.99s intro: below threshold -> no count-in
      const intro399: LyricLine[] = [
        { id: 1, text: 'Near intro', start_time: 3.99, end_time: 7.0, words: [] },
      ];
      expect(countedIn(intro399)).toEqual([]);

      // 3.999999s intro: below threshold -> no count-in
      const intro3999: LyricLine[] = [
        { id: 1, text: 'Epsilon below', start_time: 3.999999, end_time: 7.0, words: [] },
      ];
      expect(countedIn(intro3999)).toEqual([]);

      // 4.00s intro: exactly at threshold -> counted in over its last 3 s, after a break
      // marker that has the first second
      const intro400: LyricLine[] = [
        { id: 1, text: 'Exact threshold', start_time: 4.0, end_time: 7.0, words: [] },
      ];
      const plan400 = planTimeline(intro400, null);
      expect(plan400.lines[0].gap).toBe(true);
      expect(plan400.count_ins).toEqual([[0, 1.0, 4.0]]);
      expect(plan400.breaks).toEqual([[0, 1.0, 4.0]]);

      // 4.01s intro: above threshold -> counted in
      const intro401: LyricLine[] = [
        { id: 1, text: 'Slightly above', start_time: 4.01, end_time: 7.0, words: [] },
      ];
      expect(planTimeline(intro401, null).count_ins).toEqual([[0, 1.01, 4.01]]);
    });

    it('evaluates inter-line gap strictly at 4.00s threshold', () => {
      // Inter-line gap 3.99s: 8.99 - 5.00 = 3.99s -> no count-in
      const inter399: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 8.99, end_time: 12.0, words: [] },
      ];
      expect(countedIn(inter399)).toEqual([]);

      // Inter-line gap 4.00s: 9.00 - 5.00 = 4.00s -> the second line is counted in; the
      // break is too short for a marker (it would show from 6.5 s to 6.0 s)
      const inter400: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 9.0, end_time: 12.0, words: [] },
      ];
      const plan400 = planTimeline(inter400, null);
      expect(plan400.lines.map((line) => line.gap)).toEqual([false, true]);
      expect(plan400.count_ins).toEqual([[1, 6.0, 9.0]]);
      expect(plan400.breaks).toEqual([]);

      // Inter-line gap 4.01s: 9.01 - 5.00 = 4.01s -> counted in
      const inter401: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 9.01, end_time: 12.0, words: [] },
      ];
      expect(planTimeline(inter401, null).count_ins).toEqual([[1, 6.01, 9.01]]);
    });
  });

  describe('2. Pathological Timings: 0 Duration, Overlaps & Corrupted Lines', () => {
    it('handles exact zero duration gap between lines', () => {
      const zeroGap: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 5.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 5.0, end_time: 8.0, words: [] },
      ];
      expect(countedIn(zeroGap)).toEqual([]);
      expect(planTimeline(zeroGap, null).breaks).toEqual([]);
    });

    it('discards negative duration gaps (overlapping lines)', () => {
      const overlapping: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 8.0, words: [] },
        { id: 2, text: 'Line 2', start_time: 4.0, end_time: 9.0, words: [] },
        { id: 3, text: 'Line 3', start_time: 7.0, end_time: 11.0, words: [] },
      ];
      expect(countedIn(overlapping)).toEqual([]);
      expect(planTimeline(overlapping, null).breaks).toEqual([]);
    });

    it('survives non-finite, NaN, Infinity, and null line objects', () => {
      const corruptedLines = [
        null as unknown as LyricLine,
        undefined as unknown as LyricLine,
        { id: 99, text: 'NaN line', start_time: NaN, end_time: 10.0, words: [] },
        { id: 98, text: 'Inf line', start_time: 2.0, end_time: Infinity, words: [] },
        { id: 1, text: 'Valid 1', start_time: 5.0, end_time: 8.0, words: [] },
        { id: 2, text: 'Valid 2', start_time: 16.0, end_time: 19.0, words: [] },
      ];

      const plan = planTimeline(corruptedLines, 30);
      // Entries that are not lines are skipped; the others keep their place in the list
      expect(plan.lines.map((line) => line.index)).toEqual([2, 3, 4, 5]);
      // A start that is not a time counts as 0 s and an end that is not one as 4 s later
      expect(plan.lines[0]).toMatchObject({ start: 0, end: 10 });
      expect(plan.lines[1]).toMatchObject({ start: 2, end: 6 });
      for (const line of plan.lines) {
        for (const time of [line.show, line.hide, line.advance, line.leave]) {
          expect(Number.isFinite(time)).toBe(true);
        }
      }
      // The one real gap: 10 s (the end of the "NaN line") to 16 s
      expect(plan.count_ins).toEqual([[5, 13.0, 16.0]]);
      expect(plan.breaks).toEqual([[11.5, 13.0, 16.0]]);
    });
  });

  describe('3. Empty & Single Lyric Line Scenarios', () => {
    it('plans no count-in or break marker for an empty lyric list', () => {
      const plan = planTimeline([], 30);
      expect(plan.lines).toEqual([]);
      expect(plan.count_ins).toEqual([]);
      expect(plan.breaks).toEqual([]);
      expect(plan.title).toBeNull();
      expect(plan.end_card).toBeNull();
    });

    it('single lyric line starting at 0.0s does not generate an intro gap', () => {
      const lineAtZero: LyricLine[] = [
        { id: 1, text: 'Singing starts immediately', start_time: 0.0, end_time: 4.0, words: [] },
      ];
      const plan = planTimeline(lineAtZero, null);
      expect(plan.lines[0].gap).toBe(false);
      expect(plan.count_ins).toEqual([]);
      expect(plan.breaks).toEqual([]);
    });
  });

  describe('4. Rapid Playback Scrubbing & Seeking Across Gap Boundaries', () => {
    // A 10 s gap from 10 s to 20 s: the break marker shows from 1.5 s into it until the
    // count-in takes over for the last 3 s
    const bridgeLines: LyricLine[] = [
      {
        id: 1,
        text: 'Pre-bridge line',
        start_time: 6.0,
        end_time: 10.0,
        words: [{ word: 'Pre-bridge', start_time: 6.0, end_time: 10.0 }],
      },
      {
        id: 2,
        text: 'Post-bridge line',
        start_time: 20.0,
        end_time: 25.0,
        words: [{ word: 'Post-bridge', start_time: 20.0, end_time: 25.0 }],
      },
    ];

    const cuesAt = (time: number, rerender: (ui: React.ReactElement) => void) => {
      rerender(<LyricDisplay lines={bridgeLines} currentTime={time} />);
      return {
        marker: screen.queryByTestId('stage-break-marker')?.textContent ?? null,
        countIn: screen.queryByTestId('stage-count-in')?.textContent ?? null,
      };
    };

    it('accurately resolves states across every micro-boundary of the gap', () => {
      const { rerender } = render(<LyricDisplay lines={bridgeLines} currentTime={0} />);

      // 1. Before the marker comes on (1.5 s after the line before ends) -> nothing
      expect(cuesAt(11.499, rerender)).toEqual({ marker: null, countIn: null });

      // 2. Exact marker start (t = 11.500, 8.5 s left) -> the whole seconds left, rounded up
      expect(cuesAt(11.5, rerender)).toEqual({ marker: '9', countIn: null });

      // 3. Middle of the gap (t = 15.000) -> exactly 5 s left
      expect(cuesAt(15.0, rerender)).toEqual({ marker: '5', countIn: null });

      // 4. Just before the count-in (t = 16.999) -> the marker's last numeral
      expect(cuesAt(16.999, rerender)).toEqual({ marker: '4', countIn: null });

      // 5. Exact count-in boundary (t = 17.000, 3 s left) -> the count-in takes over
      expect(cuesAt(17.0, rerender)).toEqual({ marker: null, countIn: '3' });
      expect(cuesAt(18.0, rerender)).toEqual({ marker: null, countIn: '2' });

      // 6. Final fractional second (t = 19.990) -> still counting
      expect(cuesAt(19.99, rerender)).toEqual({ marker: null, countIn: '1' });

      // 7. Exact gap end boundary (t = 20.000) -> gone immediately
      expect(cuesAt(20.0, rerender)).toEqual({ marker: null, countIn: null });
      expect(cuesAt(20.001, rerender)).toEqual({ marker: null, countIn: null });
    });

    it('survives random chaotic scrubbing without state leakage or NaN', () => {
      // Simulate extreme user scrubbing
      const chaoticTimes = [
        -10.0,
        0.0,
        9.999,
        10.0,
        11.5,
        14.2,
        19.999,
        20.0,
        20.0001,
        50.0,
        12.345,
        17.0,
        18.99,
        -0.001,
        20.0,
        11.499,
        NaN,
        16.5,
      ];
      const { rerender } = render(<LyricDisplay lines={bridgeLines} currentTime={0} />);

      for (const t of chaoticTimes) {
        const { marker, countIn } = cuesAt(t, rerender);
        if (t >= 11.5 && t < 17.0) {
          expect(marker).toBe(String(Math.ceil(20 - t)));
          expect(countIn).toBeNull();
        } else if (t >= 17.0 && t < 20.0) {
          expect(marker).toBeNull();
          expect(countIn).toBe(String(Math.ceil(20 - t)));
        } else {
          expect({ marker, countIn }).toEqual({ marker: null, countIn: null });
        }
        expect(screen.getAllByTestId('stage-frame')).toHaveLength(1);
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

      // The count-in MUST be on its last numeral
      expect(screen.getByTestId('stage-count-in')).toHaveTextContent(/^1$/);
      expect(screen.getByTestId('stage-count-in')).toHaveAttribute('data-line', '1');
      // The line it counts in is already at the reading place, with nothing sung yet
      expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '1');
      expect(screen.getByTestId('word-sung-0')).toHaveStyle({ width: '0.00%' });

      // Step forward to exact boundary: t = 12.00
      rerender(<LyricDisplay lines={testLines} currentTime={12.0} />);

      // Count-in MUST be completely unmounted (0 ghost frames)
      expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();

      // Active lyrics line MUST be mounted
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Jump playback to word Second at 12.00 seconds' })
      ).toBeInTheDocument();

      // Ensure no orphaned cue rows in the DOM
      expect(document.querySelectorAll('[data-role="countin"], [data-role="break"]')).toHaveLength(
        0
      );
    });

    it('handles scrubbing back and forth across boundary without DOM corruption', () => {
      const { rerender } = render(<LyricDisplay lines={testLines} currentTime={8.0} />);

      // Inside gap: the break marker counts the seconds to the vocals
      expect(screen.getByTestId('stage-break-marker')).toHaveTextContent(/^4$/);
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // Scrub forward past line start
      rerender(<LyricDisplay lines={testLines} currentTime={13.0} />);
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();

      // Scrub backward back into gap: the count-in, before the line takes the reading place
      rerender(<LyricDisplay lines={testLines} currentTime={9.5} />);
      expect(screen.getByTestId('stage-count-in')).toHaveTextContent(/^3$/);
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // Scrub forward to exact boundary 12.0
      rerender(<LyricDisplay lines={testLines} currentTime={12.0} />);
      expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    });

    it('renders cleanly on empty lines array without crashing or rendering phantom countdowns', () => {
      render(<LyricDisplay lines={[]} currentTime={10.0} />);
      expect(screen.getByTestId('stage-frame')).toBeInTheDocument();
      expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-line')).not.toBeInTheDocument();
    });
  });
});
