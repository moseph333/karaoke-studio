/**
 * Scoring practice: readings are tallied while the song plays, a pass ends when a repeat goes
 * round or playback stops, and the best of a stretch (and of the whole song, across visits)
 * is kept beside the last.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MicReading } from '../../hooks/useMicPitch';
import { createPlaybackClock } from '../../hooks/usePlaybackClock';
import { usePracticeScore, type UsePracticeScoreOptions } from '../../hooks/usePracticeScore';
import { PRACTICE_SCORES_KEY } from '../../utils/practiceScoreStorage';
import { PRACTICE_LINES, PRACTICE_MELODY } from '../helpers/practiceFixtures';

function setup(overrides: Partial<UsePracticeScoreOptions> = {}) {
  const clock = createPlaybackClock();
  const listeners = new Set<(reading: MicReading) => void>();
  const initial: UsePracticeScoreOptions = {
    enabled: true,
    songId: 'practice-song',
    lines: PRACTICE_LINES,
    melody: PRACTICE_MELODY,
    semitones: 0,
    playbackRate: 1,
    isPlaying: true,
    clock,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    ...overrides,
  };
  const hook = renderHook((props: UsePracticeScoreOptions) => usePracticeScore(props), {
    initialProps: initial,
  });
  /** The song plays from `from` to `to` while `note` is sung (57 is the melody's A3). */
  const sing = (from: number, to: number, note: number | null) => {
    for (let time = from; time <= to; time += 0.033) {
      clock.setTime(time);
      listeners.forEach((listener) => listener({ midi: note, delay: 0 }));
    }
  };
  const endPass = () => act(() => hook.result.current.endPass());
  return { ...hook, initial, clock, listeners, sing, endPass };
}

// The fixture's lines: 1-3 from 10 s to 18.5 s, 4-8 from 26 s to 40.5 s, 9-13 from 43 s to 57.5 s

describe('usePracticeScore', () => {
  beforeEach(() => localStorage.clear());

  it('has no score before a pass ends', () => {
    const { result, sing } = setup();
    sing(9, 19, 57);
    expect(result.current.last).toBeNull();
    expect(result.current.best).toBeNull();
    expect(result.current.lineScores).toEqual({});
  });

  it('knows which lines can be scored', () => {
    expect(setup().result.current.scorable).toHaveLength(13);
    expect(setup({ melody: null }).result.current.scorable).toEqual([]);
  });

  it('scores a pass when a repeat goes round', () => {
    const { result, sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();

    expect(result.current.last).toMatchObject({ firstLine: 0, lastLine: 2, share: 1 });
    expect(Object.keys(result.current.lineScores)).toEqual(['0', '1', '2']);
    expect(result.current.best).toBe(1);
  });

  it('scores a pass when playback stops', () => {
    const { result, sing, rerender, initial } = setup();
    sing(25, 41, 57);
    rerender({ ...initial, isPlaying: false });
    expect(result.current.last).toMatchObject({ firstLine: 3, lastLine: 7, share: 1 });
  });

  it('starts each pass afresh', () => {
    const { result, sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();
    // The same part again, sung a third too high
    sing(9, 19, 61);
    endPass();
    expect(result.current.last!.share).toBe(0);
    // The better pass of the two is still the best
    expect(result.current.best).toBe(1);
  });

  it('keeps each line’s latest score across passes', () => {
    const { result, sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();
    sing(25, 41, null);
    endPass();
    expect(Object.keys(result.current.lineScores)).toHaveLength(8);
    expect(result.current.lineScores[0].matched).toBe(result.current.lineScores[0].voiced);
    expect(result.current.lineScores[3].matched).toBe(0);
  });

  it('keeps a best for each stretch of its own', () => {
    const { result, sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();
    sing(25, 41, null);
    endPass();
    // The second part's first pass is its own best, not the first part's
    expect(result.current.last!.firstLine).toBe(3);
    expect(result.current.best).toBe(0);
  });

  it('does not tally while the song is paused', () => {
    const { result, sing, endPass, rerender, initial } = setup({ isPlaying: false });
    sing(9, 19, 57);
    endPass();
    expect(result.current.last).toBeNull();
    rerender({ ...initial, isPlaying: true });
    sing(9, 19, 57);
    endPass();
    expect(result.current.last!.share).toBe(1);
  });

  it('keeps the last score when a pass went through no line', () => {
    const { result, sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();
    sing(20, 24, 57);
    endPass();
    expect(result.current.last).toMatchObject({ firstLine: 0, lastLine: 2 });
  });

  it('places a reading where it was sung, before it was read', () => {
    const { result, clock, listeners, endPass } = setup();
    // Read 0.3 s late: without the correction every note would land outside the line's start
    for (let time = 9; time <= 19.5; time += 0.033) {
      clock.setTime(time);
      const sungAt = time - 0.3;
      const note = sungAt >= 10 && sungAt < 18.5 ? 57 : null;
      listeners.forEach((listener) => listener({ midi: note, delay: 0.3 }));
    }
    endPass();
    expect(result.current.last!.share).toBeGreaterThan(0.95);
  });

  it('scores in the key the song plays in', () => {
    const { result, sing, endPass } = setup({ semitones: 2 });
    sing(9, 19, 59);
    endPass();
    expect(result.current.last!.share).toBe(1);
  });

  it('forgets its scores when the key changes: they were of another tune', () => {
    const { result, sing, endPass, rerender, initial } = setup();
    sing(9, 19, 57);
    endPass();
    rerender({ ...initial, semitones: 3 });
    expect(result.current.last).toBeNull();
    expect(result.current.lineScores).toEqual({});
  });

  it('forgets its scores for another song', () => {
    const { result, sing, endPass, rerender, initial } = setup();
    sing(9, 19, 57);
    endPass();
    rerender({ ...initial, songId: 'another' });
    expect(result.current.last).toBeNull();
  });

  it('remembers the best whole-song pass in this browser', () => {
    const first = setup();
    first.sing(9, 58, 57);
    first.endPass();
    expect(first.result.current.last).toMatchObject({ firstLine: 0, lastLine: 12, share: 1 });
    expect(JSON.parse(localStorage.getItem(PRACTICE_SCORES_KEY)!)).toEqual({
      'practice-song': 1,
    });
    first.unmount();

    // Another visit: the best is there before anything is sung
    const later = setup();
    expect(later.result.current.best).toBe(1);
    later.sing(9, 58, null);
    later.endPass();
    expect(later.result.current.last!.share).toBe(0);
    expect(later.result.current.best).toBe(1);
  });

  it('does not remember a part of the song as the whole song', () => {
    const { sing, endPass } = setup();
    sing(9, 19, 57);
    endPass();
    expect(localStorage.getItem(PRACTICE_SCORES_KEY)).toBeNull();
  });

  it('does not listen while there is nothing to score', () => {
    const { listeners, result, rerender, initial, sing, endPass } = setup({ enabled: false });
    expect(listeners.size).toBe(0);
    rerender({ ...initial, enabled: true });
    expect(listeners.size).toBe(1);
    sing(9, 19, 57);
    // The microphone goes mid-pass: what was tallied is dropped
    rerender({ ...initial, enabled: false });
    endPass();
    expect(result.current.last).toBeNull();
  });
});
