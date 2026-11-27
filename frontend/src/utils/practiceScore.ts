/**
 * The score of a pass in practice: how much of the melody the singer sang in tune.
 *
 * The melody is a row of frames, each a note or a pause. While the song plays with the
 * microphone on, every note read from it is placed in the song and ticks off the melody
 * frames around it that hold the same note (by name, in any octave, within a semitone, a
 * little early or late: `utils/melody`). When the pass ends, each lyric line's score is the
 * share of its sung frames that were ticked off, and the pass's score is the same over all
 * the lines the playhead went through.
 *
 * A line counts only when the pass covered most of it: a pass that began halfway through a
 * line does not score that line. A line with almost nothing sung in it (a shout, a spoken
 * word) is not scored at all.
 */

import type { MelodyData } from '../types';
import { IN_TUNE_SEMITONES, TIMING_ALLOWANCE_SEC, noteDistance, type MatchOptions } from './melody';

/** A line with fewer sung frames than this (a quarter of a second) is not scored. */
export const MIN_SCORED_FRAMES = 8;
/** A line counts in a pass when the playhead went through this share of its sung frames. */
export const COVERED_SHARE = 0.8;
/** Frames either side of a reading that count as gone through (readings are 33 ms apart). */
const COVER_REACH_FRAMES = 2;

/** What a pass has ticked off so far, one entry per melody frame. */
export interface PassTally {
  /** The frame was sung in tune. */
  hit: Uint8Array;
  /** The playhead went through the frame while the microphone listened. */
  covered: Uint8Array;
}

export interface LineLike {
  start_time: number;
  end_time: number;
}

export interface LineScore {
  /** The line's index in the song's lines. */
  line: number;
  /** Melody frames in the line that hold a note. */
  voiced: number;
  /** How many of them were sung in tune. */
  matched: number;
}

export interface PassScore {
  /** The first and last line the pass scored. */
  firstLine: number;
  lastLine: number;
  voiced: number;
  matched: number;
  /** `matched / voiced`, 0 to 1. */
  share: number;
  lines: LineScore[];
}

export function newTally(melody: MelodyData): PassTally {
  return {
    hit: new Uint8Array(melody.midi.length),
    covered: new Uint8Array(melody.midi.length),
  };
}

const frameOf = (melody: MelodyData, time: number) => (time - melody.start) / melody.hop;

/**
 * Records a moment of a pass: the playhead was at `time` (song seconds) and the microphone
 * read `sung` there (a MIDI note number, or null for nothing clear).
 */
export function tallySung(
  tally: PassTally,
  melody: MelodyData,
  time: number,
  sung: number | null,
  { semitones = 0, rate = 1 }: MatchOptions = {}
): void {
  if (!(melody.hop > 0) || !Number.isFinite(time)) return;
  const frames = melody.midi.length;
  const at = Math.round(frameOf(melody, time));
  for (
    let frame = Math.max(0, at - COVER_REACH_FRAMES);
    frame <= Math.min(frames - 1, at + COVER_REACH_FRAMES);
    frame += 1
  ) {
    tally.covered[frame] = 1;
  }
  if (sung === null) return;
  const allowance = TIMING_ALLOWANCE_SEC * Math.max(0.1, rate);
  const first = Math.max(0, Math.ceil(frameOf(melody, time - allowance)));
  const last = Math.min(frames - 1, Math.floor(frameOf(melody, time + allowance)));
  for (let frame = first; frame <= last; frame += 1) {
    const note = melody.midi[frame];
    if (note !== null && noteDistance(sung, note + semitones) <= IN_TUNE_SEMITONES) {
      tally.hit[frame] = 1;
    }
  }
}

/** The frames of the melody inside a line, as [first, one past last]. */
function lineFrames(melody: MelodyData, line: LineLike): [number, number] {
  const first = Math.max(0, Math.ceil(frameOf(melody, line.start_time)));
  const end = Math.min(melody.midi.length, Math.floor(frameOf(melody, line.end_time)) + 1);
  return [first, Math.max(first, end)];
}

/** The lines of the song that can be scored at all: enough of the melody is sung in them. */
export function scorableLines(melody: MelodyData, lines: readonly LineLike[]): number[] {
  const out: number[] = [];
  lines.forEach((line, index) => {
    const [first, end] = lineFrames(melody, line);
    let voiced = 0;
    for (let frame = first; frame < end; frame += 1) if (melody.midi[frame] !== null) voiced += 1;
    if (voiced >= MIN_SCORED_FRAMES) out.push(index);
  });
  return out;
}

/**
 * The score of the pass tallied so far: the lines the playhead went through, and how much
 * of each was sung in tune. Null when the pass went through no line that can be scored.
 */
export function scorePass(
  tally: PassTally,
  melody: MelodyData,
  lines: readonly LineLike[]
): PassScore | null {
  const scored: LineScore[] = [];
  lines.forEach((line, index) => {
    const [first, end] = lineFrames(melody, line);
    let voiced = 0;
    let covered = 0;
    let matched = 0;
    for (let frame = first; frame < end; frame += 1) {
      if (melody.midi[frame] === null) continue;
      voiced += 1;
      covered += tally.covered[frame];
      matched += tally.hit[frame];
    }
    if (voiced < MIN_SCORED_FRAMES || covered < voiced * COVERED_SHARE) return;
    scored.push({ line: index, voiced, matched });
  });
  if (!scored.length) return null;
  const voiced = scored.reduce((sum, line) => sum + line.voiced, 0);
  const matched = scored.reduce((sum, line) => sum + line.matched, 0);
  return {
    firstLine: scored[0].line,
    lastLine: scored[scored.length - 1].line,
    voiced,
    matched,
    share: matched / voiced,
    lines: scored,
  };
}

/**
 * The share of a run of lines sung in tune, from each line's latest score; null until every
 * line of the run that can be scored has one.
 */
export function shareOfLines(
  latest: Readonly<Record<number, LineScore>>,
  scorable: readonly number[],
  firstLine: number,
  lastLine: number
): number | null {
  let voiced = 0;
  let matched = 0;
  let any = false;
  for (const index of scorable) {
    if (index < firstLine || index > lastLine) continue;
    const score = latest[index];
    if (!score) return null;
    any = true;
    voiced += score.voiced;
    matched += score.matched;
  }
  return any && voiced > 0 ? matched / voiced : null;
}

/** A share as a whole percent: 0.725 is 73. */
export const percent = (share: number) => Math.round(share * 100);
