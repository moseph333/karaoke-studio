/**
 * The song's melody as practice reads it: the note at a moment, the range to draw, and when
 * a sung note counts as in tune (by its name in any octave, within a semitone, and a little
 * early or late).
 */
import { describe, it, expect } from 'vitest';
import type { MelodyData } from '../../types';
import {
  IN_TUNE_SEMITONES,
  MIN_RANGE_SEMITONES,
  TIMING_ALLOWANCE_SEC,
  foldToward,
  inTune,
  melodyAt,
  melodyFrameAt,
  melodyRange,
  melodyTime,
  nearestMelodyNote,
  noteDistance,
} from '../../utils/melody';

const HOP = 0.032;
const START = 0.064;

/** A melody from (note, seconds) pieces, a note of null being a pause. */
function melody(...pieces: Array<[number | null, number]>): MelodyData {
  const midi: (number | null)[] = [];
  for (const [note, seconds] of pieces) {
    for (let n = 0; n < Math.round(seconds / HOP); n += 1) midi.push(note);
  }
  const sung = midi.filter((note): note is number => note !== null);
  return {
    project_id: 'song',
    version: 1,
    source: 'vocals',
    detected: sung.length > 0,
    start: START,
    hop: HOP,
    low: sung.length ? Math.min(...sung) : null,
    high: sung.length ? Math.max(...sung) : null,
    midi,
  };
}

// A3 for two seconds, a second's pause, then E4 for two seconds
const SONG = melody([57, 2], [null, 1], [64, 2]);

describe('the melody at a moment', () => {
  it('is the note being held', () => {
    expect(melodyAt(SONG, 1)).toBe(57);
    expect(melodyAt(SONG, 4)).toBe(64);
  });

  it('is nothing in a pause, before the song and after it', () => {
    expect(melodyAt(SONG, 2.5)).toBeNull();
    expect(melodyAt(SONG, -1)).toBeNull();
    expect(melodyAt(SONG, 60)).toBeNull();
  });

  it('moves with the key the song plays in', () => {
    expect(melodyAt(SONG, 1, 2)).toBe(59);
    expect(melodyAt(SONG, 1, -5)).toBe(52);
  });

  it('places frames by their middles', () => {
    expect(melodyFrameAt(SONG, START)).toBe(0);
    expect(melodyFrameAt(SONG, START + HOP * 10)).toBe(10);
    expect(melodyTime(SONG, 10)).toBeCloseTo(START + 0.32);
  });

  it('is safe for a melody with no frames', () => {
    const empty = melody();
    expect(melodyAt(empty, 1)).toBeNull();
    expect(inTune(empty, 1, 60)).toBeNull();
    expect(nearestMelodyNote(empty, 1)).toBeNull();
  });
});

describe('the range to draw', () => {
  it('holds the melody with a margin', () => {
    const range = melodyRange(melody([50, 1], [70, 1]));
    expect(range.low).toBe(48);
    expect(range.high).toBe(72);
  });

  it('is never a sliver, however few notes the song has', () => {
    const range = melodyRange(melody([60, 1], [62, 1]));
    expect(range.high - range.low).toBe(MIN_RANGE_SEMITONES);
    expect((range.low + range.high) / 2).toBe(61);
  });

  it('moves with the key', () => {
    const range = melodyRange(melody([50, 1], [70, 1]), 3);
    expect(range).toEqual({ low: 51, high: 75 });
  });

  it('has a default for a song without a melody', () => {
    expect(melodyRange(null).high).toBeGreaterThan(melodyRange(null).low);
    expect(melodyRange(melody([null, 2]))).toEqual(melodyRange(null));
  });
});

describe('octaves', () => {
  it('moves a note by octaves to sit beside another', () => {
    expect(foldToward(45, 57)).toBe(57);
    expect(foldToward(81, 57)).toBe(57);
    expect(foldToward(58.4, 69)).toBeCloseTo(70.4);
    expect(foldToward(57, 57)).toBe(57);
  });

  it('measures notes apart by name', () => {
    expect(noteDistance(45, 57)).toBe(0);
    expect(noteDistance(58, 57)).toBe(1);
    expect(noteDistance(51, 57)).toBe(6);
    expect(noteDistance(56.5, 69)).toBeCloseTo(0.5);
  });
});

describe('in tune', () => {
  it('is the melody’s note', () => {
    expect(inTune(SONG, 1, 57)).toBe(true);
  });

  it('counts the same note an octave below or above', () => {
    expect(inTune(SONG, 1, 45)).toBe(true);
    expect(inTune(SONG, 1, 69)).toBe(true);
    expect(inTune(SONG, 4, 52)).toBe(true);
  });

  it('allows a semitone either way, and no more', () => {
    expect(inTune(SONG, 1, 57 + IN_TUNE_SEMITONES)).toBe(true);
    expect(inTune(SONG, 1, 57 - IN_TUNE_SEMITONES)).toBe(true);
    expect(inTune(SONG, 1, 59)).toBe(false);
    expect(inTune(SONG, 1, 55)).toBe(false);
    expect(inTune(SONG, 1, 63)).toBe(false);
  });

  it('allows a note sung a little early or late', () => {
    // The melody moves to E4 at 3.06 s
    expect(inTune(SONG, 3.06 - 0.15, 64)).toBe(true);
    expect(inTune(SONG, 2.06 + 0.15, 57)).toBe(true);
  });

  it('does not allow a note sung far too early or too late', () => {
    expect(inTune(SONG, 3.06 - 0.4, 64)).toBeNull();
    expect(inTune(SONG, 2.06 - 0.5, 64)).toBe(false);
    expect(inTune(SONG, 3.06 + 0.4, 57)).toBe(false);
  });

  it('has nothing to match in a pause', () => {
    expect(inTune(SONG, 2.6, 57)).toBeNull();
    expect(inTune(SONG, 30, 57)).toBeNull();
  });

  it('follows the key the song plays in', () => {
    expect(inTune(SONG, 1, 59, { semitones: 2 })).toBe(true);
    expect(inTune(SONG, 1, 57, { semitones: 2 })).toBe(false);
    expect(inTune(SONG, 1, 54, { semitones: -3 })).toBe(true);
  });

  it('allows less of the song when the song is slowed down', () => {
    // 0.15 s of song before the change: inside the allowance at full speed, outside at half
    const time = 3.06 - 0.15;
    expect(TIMING_ALLOWANCE_SEC).toBe(0.2);
    expect(inTune(SONG, time, 64, { rate: 1 })).toBe(true);
    expect(inTune(SONG, time, 64, { rate: 0.5 })).toBeNull();
  });
});

describe('the melody’s note nearest a moment', () => {
  it('is the note being held', () => {
    expect(nearestMelodyNote(SONG, 1)).toBe(57);
  });

  it('reaches a little into a pause for the note on either side', () => {
    expect(nearestMelodyNote(SONG, 2.06 + 0.1)).toBe(57);
    expect(nearestMelodyNote(SONG, 3.06 - 0.1)).toBe(64);
    expect(nearestMelodyNote(SONG, 2.56)).toBeNull();
  });

  it('follows the key', () => {
    expect(nearestMelodyNote(SONG, 1, { semitones: 4 })).toBe(61);
  });
});
