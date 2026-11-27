/**
 * The song's melody as practice uses it: the note the singer holds at a moment, the range to
 * draw it in, and whether a note sung into the microphone matches it.
 *
 * The server sends the melody in the song's original key (`GET /api/project/{id}/melody`);
 * the key the song plays in is added here. A sung note matches by its name, not its octave:
 * a low voice singing a high song an octave down is in tune.
 */

import type { MelodyData } from '../types';

/** Within this many semitones of the melody's note is in tune. */
export const IN_TUNE_SEMITONES = 1;
/** A sung note may come this much before or after the melody's, in seconds of real time: the
 *  microphone and the speakers each add a delay, and nobody lands every note on the beat. */
export const TIMING_ALLOWANCE_SEC = 0.2;
/** The fewest semitones the pitch display spans, so a song on three notes is not a zigzag. */
export const MIN_RANGE_SEMITONES = 12;
const RANGE_MARGIN_SEMITONES = 2;
/** The span drawn when the song has no melody: a comfortable octave and a half around A3. */
const DEFAULT_RANGE = { low: 48, high: 66 };

/** The frame of the melody nearest to `time` (song seconds), or -1 outside it. */
export function melodyFrameAt(melody: MelodyData, time: number): number {
  if (!(melody.hop > 0) || !melody.midi.length) return -1;
  const frame = Math.round((time - melody.start) / melody.hop);
  return frame >= 0 && frame < melody.midi.length ? frame : -1;
}

/** The note the singer holds at `time`, in the key the song plays in; null in a pause. */
export function melodyAt(melody: MelodyData, time: number, semitones = 0): number | null {
  const frame = melodyFrameAt(melody, time);
  const note = frame < 0 ? null : melody.midi[frame];
  return note === null || note === undefined ? null : note + semitones;
}

/** When a frame is sung, in song seconds. */
export function melodyTime(melody: MelodyData, frame: number): number {
  return melody.start + frame * melody.hop;
}

/** The range of notes to draw, in the key the song plays in. */
export function melodyRange(
  melody: MelodyData | null,
  semitones = 0
): { low: number; high: number } {
  if (!melody || melody.low === null || melody.high === null) return DEFAULT_RANGE;
  let low = melody.low + semitones - RANGE_MARGIN_SEMITONES;
  let high = melody.high + semitones + RANGE_MARGIN_SEMITONES;
  const short = MIN_RANGE_SEMITONES - (high - low);
  if (short > 0) {
    low -= short / 2;
    high += short / 2;
  }
  return { low, high };
}

/** `note` moved by whole octaves to sit as near `target` as it can. */
export function foldToward(note: number, target: number): number {
  return note - 12 * Math.round((note - target) / 12);
}

/** How far apart two notes are by name, whatever their octaves: 0 to 6 semitones. */
export function noteDistance(a: number, b: number): number {
  return Math.abs(foldToward(a, b) - b);
}

export interface MatchOptions {
  /** The key the song plays in, in semitones from the original. */
  semitones?: number;
  /** The song's speed: a real-time delay covers less of a slowed song. */
  rate?: number;
}

/**
 * Whether a note sung at `time` (song seconds) matches the melody: true when the melody
 * holds that note, by name, within the timing allowance; false when it holds only others;
 * null when the melody is silent around then (nothing to match).
 */
export function inTune(
  melody: MelodyData,
  time: number,
  sung: number,
  { semitones = 0, rate = 1 }: MatchOptions = {}
): boolean | null {
  if (!(melody.hop > 0)) return null;
  const allowance = TIMING_ALLOWANCE_SEC * Math.max(0.1, rate);
  const first = Math.max(0, Math.ceil((time - allowance - melody.start) / melody.hop));
  const last = Math.min(
    melody.midi.length - 1,
    Math.floor((time + allowance - melody.start) / melody.hop)
  );
  let heard = false;
  for (let frame = first; frame <= last; frame += 1) {
    const note = melody.midi[frame];
    if (note === null) continue;
    heard = true;
    if (noteDistance(sung, note + semitones) <= IN_TUNE_SEMITONES) return true;
  }
  return heard ? false : null;
}

/** The melody's note nearest in time to `time`, within the timing allowance; null if none. */
export function nearestMelodyNote(
  melody: MelodyData,
  time: number,
  { semitones = 0, rate = 1 }: MatchOptions = {}
): number | null {
  const at = melodyFrameAt(melody, time);
  const reach = Math.ceil((TIMING_ALLOWANCE_SEC * Math.max(0.1, rate)) / melody.hop);
  const centre = at < 0 ? Math.round((time - melody.start) / melody.hop) : at;
  for (let step = 0; step <= reach; step += 1) {
    for (const frame of step === 0 ? [centre] : [centre - step, centre + step]) {
      const note = melody.midi[frame];
      if (note !== null && note !== undefined) return note + semitones;
    }
  }
  return null;
}
