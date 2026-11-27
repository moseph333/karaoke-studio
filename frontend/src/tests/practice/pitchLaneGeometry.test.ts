/**
 * Where things go in the pitch lane: time across, pitch up, the melody as one stroke per
 * note, and the sung notes as a trail with its matching stretches picked out.
 */
import { describe, it, expect } from 'vitest';
import type { MelodyData } from '../../types';
import {
  LANE_AHEAD_SEC,
  LANE_BEHIND_SEC,
  laneNowX,
  laneX,
  laneY,
  melodyPath,
  pointsInView,
  sungNoteInView,
  trailPaths,
  type LaneView,
  type SungPoint,
} from '../../utils/pitchLane';

const VIEW: LaneView = { width: 800, height: 100, low: 50, high: 70 };

function melody(...pieces: Array<[number | null, number]>): MelodyData {
  const midi: (number | null)[] = [];
  for (const [note, frames] of pieces) for (let n = 0; n < frames; n += 1) midi.push(note);
  return {
    project_id: 'song',
    version: 1,
    source: 'vocals',
    detected: true,
    start: 0,
    hop: 0.1,
    low: 50,
    high: 70,
    midi,
  };
}

/** The points of a path, as [command, x, y]. */
const points = (path: string) =>
  [...path.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);

describe('the lane’s axes', () => {
  it('puts now three eighths of the way across', () => {
    expect(LANE_BEHIND_SEC + LANE_AHEAD_SEC).toBe(8);
    expect(laneNowX(VIEW)).toBe(300);
    expect(laneX(VIEW, 20, 20)).toBe(300);
  });

  it('runs time left to right', () => {
    expect(laneX(VIEW, 20, 17)).toBe(0);
    expect(laneX(VIEW, 20, 25)).toBe(800);
    expect(laneX(VIEW, 20, 21)).toBe(400);
  });

  it('runs pitch bottom to top and stays inside the lane', () => {
    expect(laneY(VIEW, 50)).toBe(100);
    expect(laneY(VIEW, 70)).toBe(0);
    expect(laneY(VIEW, 60)).toBe(50);
    expect(laneY(VIEW, 90)).toBe(0);
    expect(laneY(VIEW, 10)).toBe(100);
  });

  it('draws a sung note in the octave of the melody’s note', () => {
    expect(sungNoteInView(VIEW, 45, 57)).toBe(57);
    expect(sungNoteInView(VIEW, 70.5, 57)).toBeCloseTo(58.5);
    // No melody then: the octave nearest the middle of the lane
    expect(sungNoteInView(VIEW, 33, null)).toBe(57);
  });
});

describe('the melody’s line', () => {
  it('is one stroke for a held note', () => {
    // A note from 0 s to 2 s, seen with the playhead at 1 s
    const path = points(melodyPath(melody([60, 20]), 0, 1, VIEW));
    expect(path[0][0]).toBe('M');
    expect(path.slice(1).every(([command]) => command === 'L')).toBe(true);
    expect(path.every(([, , y]) => y === 50)).toBe(true);
    // Its first frame, a second before now
    expect(path[0][1]).toBe(laneX(VIEW, 1, 0));
  });

  it('lifts the pen across a pause and between two notes', () => {
    const path = points(melodyPath(melody([60, 5], [null, 5], [60, 5], [65, 5]), 0, 1, VIEW));
    expect(path.filter(([command]) => command === 'M')).toHaveLength(3);
    expect(path[path.length - 1][2]).toBe(laneY(VIEW, 65));
  });

  it('slides along a note that bends', () => {
    const bend = melody([60, 3], [60.5, 3], [61, 3]);
    expect(points(melodyPath(bend, 0, 0.5, VIEW)).filter(([c]) => c === 'M')).toHaveLength(1);
  });

  it('draws only the stretch of song in view', () => {
    const long = melody([60, 600]);
    const path = points(melodyPath(long, 0, 30, VIEW));
    // Eight seconds at ten frames a second, give or take the edges
    expect(path.length).toBeGreaterThan(75);
    expect(path.length).toBeLessThan(85);
    expect(path[0][1]).toBeGreaterThanOrEqual(-10);
    expect(path[path.length - 1][1]).toBeLessThanOrEqual(810);
  });

  it('moves with the key the song plays in', () => {
    const path = points(melodyPath(melody([60, 20]), 5, 1, VIEW));
    expect(path[0][2]).toBe(laneY(VIEW, 65));
  });

  it('is empty without a melody, or with nothing sung in view', () => {
    expect(melodyPath(null, 0, 1, VIEW)).toBe('');
    expect(melodyPath(melody([null, 50]), 0, 1, VIEW)).toBe('');
    expect(melodyPath(melody([60, 10]), 0, 100, VIEW)).toBe('');
  });
});

describe('the sung trail', () => {
  const sung = (time: number, note: number, hit = false): SungPoint => ({ time, note, hit });

  it('joins notes sung one after the other', () => {
    const { sung: path } = trailPaths([sung(9.9, 60), sung(9.93, 60), sung(9.96, 61)], 10, VIEW);
    expect(points(path).map(([command]) => command)).toEqual(['M', 'L', 'L']);
  });

  it('breaks where the singer stopped, and at a leap', () => {
    const { sung: path } = trailPaths(
      [sung(8, 60), sung(8.03, 60), sung(9, 60), sung(9.03, 60), sung(9.06, 68)],
      10,
      VIEW
    );
    expect(points(path).map(([command]) => command)).toEqual(['M', 'L', 'M', 'L', 'M']);
  });

  it('picks out the stretches that matched', () => {
    const { sung: all, hit } = trailPaths(
      [sung(9.8, 60), sung(9.83, 60, true), sung(9.86, 60, true), sung(9.89, 62)],
      10,
      VIEW
    );
    expect(points(all)).toHaveLength(4);
    // A dot for the first matching note, then a stroke to the second
    expect(points(hit).map(([command]) => command)).toEqual(['M', 'L', 'M', 'L']);
    expect(points(hit)[3][1]).toBe(Math.round(laneX(VIEW, 10, 9.86) * 10) / 10);
  });

  it('leaves out what has gone off the left edge', () => {
    const { sung: path } = trailPaths([sung(2, 60), sung(9.9, 60)], 10, VIEW);
    expect(points(path)).toHaveLength(1);
  });

  it('is empty when nothing was sung', () => {
    expect(trailPaths([], 10, VIEW)).toEqual({ sung: '', hit: '' });
  });

  it('forgets notes out of view, and notes from after a jump back', () => {
    const kept = pointsInView([sung(5, 60), sung(9, 60), sung(10.2, 60), sung(14, 60)], 10);
    expect(kept.map((point) => point.time)).toEqual([9, 10.2]);
  });
});
