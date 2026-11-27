/**
 * The score of a practice pass: the share of each line's melody that was sung in tune, with
 * the same allowances as the pitch lane (any octave, a semitone, a little early or late),
 * counting only lines the pass really went through.
 */
import { describe, it, expect } from 'vitest';
import type { MelodyData } from '../../types';
import {
  COVERED_SHARE,
  MIN_SCORED_FRAMES,
  newTally,
  percent,
  scorableLines,
  scorePass,
  shareOfLines,
  tallySung,
  type LineScore,
} from '../../utils/practiceScore';

const HOP = 0.032;

/** A melody from (note, seconds) pieces starting at 0 s; a note of null is a pause. */
function melody(...pieces: Array<[number | null, number]>): MelodyData {
  const midi: (number | null)[] = [];
  for (const [note, seconds] of pieces) {
    for (let n = 0; n < Math.round(seconds / HOP); n += 1) midi.push(note);
  }
  return {
    project_id: 'song',
    version: 1,
    source: 'vocals',
    detected: true,
    start: 0,
    hop: HOP,
    low: 57,
    high: 64,
    midi,
  };
}

// Line 1 holds A3 from 1 s to 3 s; line 2 holds E4 from 5 s to 7 s
const SONG = melody([null, 1], [57, 2], [null, 2], [64, 2], [null, 1]);
const LINES = [
  { start_time: 1, end_time: 3 },
  { start_time: 5, end_time: 7 },
];

/** Sings `note` (or whatever `noteAt` says) from `from` to `to`, a reading every 33 ms. */
function sing(
  tally: ReturnType<typeof newTally>,
  from: number,
  to: number,
  note: number | null | ((time: number) => number | null),
  options: { semitones?: number; rate?: number; song?: MelodyData } = {}
) {
  for (let time = from; time <= to; time += 0.033) {
    const sung = typeof note === 'function' ? note(time) : note;
    tallySung(tally, options.song ?? SONG, time, sung, options);
  }
}

describe('scoring a pass', () => {
  it('is full marks for the melody sung right through', () => {
    const tally = newTally(SONG);
    sing(tally, 0.5, 7.5, (time) => (time < 4 ? 57 : 64));
    const score = scorePass(tally, SONG, LINES)!;
    expect(score.share).toBe(1);
    expect(score.firstLine).toBe(0);
    expect(score.lastLine).toBe(1);
    expect(score.lines.map((line) => line.matched === line.voiced)).toEqual([true, true]);
  });

  it('is nothing for a pass sung in silence', () => {
    const tally = newTally(SONG);
    sing(tally, 0.5, 7.5, null);
    expect(scorePass(tally, SONG, LINES)!.share).toBe(0);
  });

  it('scores each line by itself', () => {
    const tally = newTally(SONG);
    // The first line right, the second a third too high
    sing(tally, 0.5, 7.5, (time) => (time < 4 ? 57 : 68));
    const score = scorePass(tally, SONG, LINES)!;
    expect(score.lines[0].matched).toBe(score.lines[0].voiced);
    expect(score.lines[1].matched).toBe(0);
    expect(score.share).toBeCloseTo(0.5, 1);
  });

  it('counts the same note an octave below', () => {
    const tally = newTally(SONG);
    sing(tally, 0.5, 3.5, 45);
    expect(scorePass(tally, SONG, LINES)!.share).toBe(1);
  });

  it('counts a note a semitone off, and not one two semitones off', () => {
    const near = newTally(SONG);
    sing(near, 0.5, 3.5, 58);
    expect(scorePass(near, SONG, LINES)!.share).toBe(1);

    const far = newTally(SONG);
    sing(far, 0.5, 3.5, 59);
    expect(scorePass(far, SONG, LINES)!.share).toBe(0);
  });

  it('forgives a line started a little late, and not one started far too late', () => {
    const late = newTally(SONG);
    // The singer comes in 0.15 s after the line starts
    sing(late, 0.5, 3.5, (time) => (time >= 1.15 ? 57 : null));
    expect(scorePass(late, SONG, LINES)!.share).toBe(1);

    const tooLate = newTally(SONG);
    sing(tooLate, 0.5, 3.5, (time) => (time >= 1.6 ? 57 : null));
    const share = scorePass(tooLate, SONG, LINES)!.share;
    // 0.4 s of a two-second line missed
    expect(share).toBeGreaterThan(0.75);
    expect(share).toBeLessThan(0.85);
  });

  it('gives no credit for the right note sung in a pause', () => {
    const tally = newTally(SONG);
    sing(tally, 0.5, 3.5, (time) => (time > 3.5 || time < 0.6 ? 57 : null));
    expect(scorePass(tally, SONG, LINES)!.share).toBeLessThan(0.15);
  });

  it('scores against the key the song plays in', () => {
    const inKey = newTally(SONG);
    sing(inKey, 0.5, 3.5, 60, { semitones: 3 });
    expect(scorePass(inKey, SONG, LINES)!.share).toBe(1);

    const oldKey = newTally(SONG);
    sing(oldKey, 0.5, 3.5, 57, { semitones: 3 });
    expect(scorePass(oldKey, SONG, LINES)!.share).toBe(0);
  });

  it('forgives less of a slowed song for the same lateness', () => {
    // 0.15 s of song late: inside the allowance at full speed, half outside it at half speed
    const late = (time: number) => (time >= 1.15 ? 57 : null);
    const full = newTally(SONG);
    sing(full, 0.5, 3.5, late, { rate: 1 });
    const slow = newTally(SONG);
    sing(slow, 0.5, 3.5, late, { rate: 0.5 });
    expect(scorePass(full, SONG, LINES)!.share).toBe(1);
    expect(scorePass(slow, SONG, LINES)!.share).toBeLessThan(1);
  });
});

describe('which lines a pass counts', () => {
  it('counts only the lines the playhead went through', () => {
    const tally = newTally(SONG);
    sing(tally, 4.5, 7.5, 64);
    const score = scorePass(tally, SONG, LINES)!;
    expect(score.lines.map((line) => line.line)).toEqual([1]);
    expect(score.firstLine).toBe(1);
    expect(score.share).toBe(1);
  });

  it('leaves out a line the pass began halfway through', () => {
    const tally = newTally(SONG);
    // From the middle of line 1 on
    sing(tally, 2.2, 7.5, (time) => (time < 4 ? 57 : 64));
    expect(COVERED_SHARE).toBe(0.8);
    expect(scorePass(tally, SONG, LINES)!.lines.map((line) => line.line)).toEqual([1]);
  });

  it('has no score for a pass that went through no line', () => {
    const tally = newTally(SONG);
    sing(tally, 3.2, 4.5, 57);
    expect(scorePass(tally, SONG, LINES)).toBeNull();
    expect(scorePass(newTally(SONG), SONG, LINES)).toBeNull();
  });

  it('does not score a line with almost nothing sung in it', () => {
    // A shout: five frames of pitch in a two-second line
    const shout = melody([null, 1], [57, HOP * 5], [null, 2], [64, 2]);
    const lines = [
      { start_time: 1, end_time: 3 },
      { start_time: 3.16, end_time: 5.16 },
    ];
    expect(MIN_SCORED_FRAMES).toBe(8);
    expect(scorableLines(shout, lines)).toEqual([1]);

    const tally = newTally(shout);
    sing(tally, 0.5, 5.5, null, { song: shout });
    expect(scorePass(tally, shout, lines)!.lines.map((line) => line.line)).toEqual([1]);
  });

  it('lists the lines that can be scored', () => {
    expect(scorableLines(SONG, LINES)).toEqual([0, 1]);
    expect(scorableLines(SONG, [{ start_time: 3.2, end_time: 4.8 }])).toEqual([]);
  });

  it('is safe at the edges of the song and with odd times', () => {
    const tally = newTally(SONG);
    tallySung(tally, SONG, -5, 57);
    tallySung(tally, SONG, 500, 57);
    tallySung(tally, SONG, Number.NaN, 57);
    expect([...tally.hit].some(Boolean)).toBe(false);
    expect(scorePass(tally, SONG, [{ start_time: 90, end_time: 95 }])).toBeNull();
  });
});

describe('the share of a part', () => {
  const scores: Record<number, LineScore> = {
    0: { line: 0, voiced: 60, matched: 60 },
    1: { line: 1, voiced: 40, matched: 10 },
  };

  it('weighs each line by how much is sung in it', () => {
    expect(shareOfLines(scores, [0, 1], 0, 1)).toBeCloseTo(0.7);
    expect(shareOfLines(scores, [0, 1], 0, 0)).toBe(1);
  });

  it('waits until every line of the part that can be scored has a score', () => {
    expect(shareOfLines(scores, [0, 1, 2], 0, 2)).toBeNull();
    // Line 2 cannot be scored at all: the part is complete without it
    expect(shareOfLines(scores, [0, 1], 0, 2)).toBeCloseTo(0.7);
  });

  it('is nothing for a part with no line that can be scored', () => {
    expect(shareOfLines(scores, [0, 1], 5, 9)).toBeNull();
    expect(shareOfLines({}, [], 0, 3)).toBeNull();
  });

  it('is shown as a whole percent', () => {
    expect(percent(0.725)).toBe(73);
    expect(percent(1)).toBe(100);
    expect(percent(0)).toBe(0);
  });
});
