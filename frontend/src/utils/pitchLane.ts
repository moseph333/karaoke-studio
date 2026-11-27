/**
 * Where things go in practice's pitch lane, as plain sums: the song's melody running past a
 * "now" line from right to left, and the notes sung into the microphone trailing behind it.
 * `components/practice/PracticePitchLane` draws what these return.
 *
 * Time runs left to right (a few seconds already sung on the left, the seconds coming on the
 * right) and pitch bottom to top.
 */

import type { MelodyData } from '../types';
import { foldToward, melodyTime } from './melody';

/** Song seconds shown to the left of the now line. */
export const LANE_BEHIND_SEC = 3;
/** Song seconds shown to its right. */
export const LANE_AHEAD_SEC = 5;
/** Sung notes further apart in time than this are not joined by a line. */
export const TRAIL_BREAK_SEC = 0.2;
/** A step this large between two frames of the melody is a new note, not a slide. */
const NEW_NOTE_SEMITONES = 1.5;

export interface LaneView {
  /** The drawing's size, in its own units. */
  width: number;
  height: number;
  /** The notes at the bottom and the top edge. */
  low: number;
  high: number;
}

/** A note sung into the microphone, placed in the song. */
export interface SungPoint {
  /** When it was sung, in song seconds. */
  time: number;
  /** The note, already moved to the octave it is drawn in. */
  note: number;
  /** It matched the melody. */
  hit: boolean;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Where the now line stands. */
export function laneNowX(view: LaneView): number {
  return (LANE_BEHIND_SEC / (LANE_BEHIND_SEC + LANE_AHEAD_SEC)) * view.width;
}

/** A song time's place across the lane, with the playhead at `now`. */
export function laneX(view: LaneView, now: number, time: number): number {
  return ((time - now + LANE_BEHIND_SEC) / (LANE_BEHIND_SEC + LANE_AHEAD_SEC)) * view.width;
}

/** A note's height in the lane, kept inside it. */
export function laneY(view: LaneView, note: number): number {
  const span = view.high - view.low;
  const share = span > 0 ? (note - view.low) / span : 0.5;
  return (1 - Math.min(1, Math.max(0, share))) * view.height;
}

/** The octave a sung note is drawn in: the one nearest `target` (the melody's note then, or
 *  the middle of the lane when the melody is silent). */
export function sungNoteInView(view: LaneView, sung: number, target: number | null): number {
  return foldToward(sung, target ?? (view.low + view.high) / 2);
}

/**
 * The melody's line for the stretch of song in view, as an SVG path: one stroke per note,
 * lifted between notes and across pauses. Empty when nothing sung is in view.
 */
export function melodyPath(
  melody: MelodyData | null,
  semitones: number,
  now: number,
  view: LaneView
): string {
  if (!melody || !(melody.hop > 0)) return '';
  const first = Math.max(0, Math.floor((now - LANE_BEHIND_SEC - melody.start) / melody.hop));
  const last = Math.min(
    melody.midi.length - 1,
    Math.ceil((now + LANE_AHEAD_SEC - melody.start) / melody.hop)
  );
  let path = '';
  let previous: number | null = null;
  for (let frame = first; frame <= last; frame += 1) {
    const note = melody.midi[frame];
    if (note === null || note === undefined) {
      previous = null;
      continue;
    }
    const x = round1(laneX(view, now, melodyTime(melody, frame)));
    const y = round1(laneY(view, note + semitones));
    const joined = previous !== null && Math.abs(note - previous) <= NEW_NOTE_SEMITONES;
    path += `${joined ? 'L' : 'M'}${x} ${y}`;
    previous = note;
  }
  return path;
}

/**
 * The sung notes in view as two SVG paths: `sung` is every note, `hit` only the stretches
 * that matched the melody (drawn over the first, lit).
 */
export function trailPaths(
  points: readonly SungPoint[],
  now: number,
  view: LaneView
): { sung: string; hit: string } {
  let sung = '';
  let hit = '';
  let previous: SungPoint | null = null;
  let previousAt = '';
  for (const point of points) {
    if (point.time < now - LANE_BEHIND_SEC) continue;
    const at = `${round1(laneX(view, now, point.time))} ${round1(laneY(view, point.note))}`;
    const joined =
      previous !== null &&
      point.time - previous.time <= TRAIL_BREAK_SEC &&
      point.time >= previous.time &&
      Math.abs(point.note - previous.note) <= 6;
    sung += `${joined ? 'L' : 'M'}${at}`;
    if (point.hit) {
      // A lone hit is a dot: a line to itself
      hit += joined && previous?.hit ? `M${previousAt}L${at}` : `M${at}L${at}`;
    }
    previous = point;
    previousAt = at;
  }
  return { sung, hit };
}

/** The points still in view at `now` (or about to be, for a song that jumped back). */
export function pointsInView(points: readonly SungPoint[], now: number): SungPoint[] {
  return points.filter(
    (point) => point.time >= now - LANE_BEHIND_SEC - 0.5 && point.time <= now + 0.5
  );
}
