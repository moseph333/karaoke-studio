/**
 * Hand edits versus aligner metadata
 *
 * The aligner gives each line a confidence score and an `align_method`. Once someone changes
 * a line's text or timing by hand, that score no longer describes it: the line becomes
 * `align_method: "manual"` without a confidence. A line edited back to exactly how it was
 * saved gets its saved metadata back. Lines are matched by content, not id, because inserting
 * or deleting a line renumbers the ones after it.
 *
 * Whole-song re-alignments keep the word timing of lines timed by hand, but not of lines
 * whose words the editor only spread evenly (line-by-line tap-to-sync, new lines, retyped
 * text): there only the line's start and end were set by hand, so the aligner places the
 * words.
 */

import type { LyricLine } from '../types';
import { wordSpreadWeight } from './lyrics';

/** Moving a line rounds each word boundary again, to the millisecond. */
const SPREAD_TOLERANCE = 0.002;

export function lineContentKey(line: LyricLine): string {
  const words = (line.words ?? []).map((w) => `${w.word}\u0001${w.start_time}\u0001${w.end_time}`);
  return `${line.text}\u0002${line.start_time}\u0002${line.end_time}\u0002${words.join('\u0003')}`;
}

function asManual(line: LyricLine): LyricLine {
  if (line.align_method === 'manual' && line.confidence === undefined) return line;
  const manual: LyricLine = { ...line, align_method: 'manual' };
  delete manual.confidence;
  return manual;
}

function asSaved(line: LyricLine, saved: LyricLine): LyricLine {
  if (line.id === saved.id && line.singer === saved.singer) return saved;
  return { ...saved, id: line.id, singer: line.singer };
}

/**
 * Whether a line's words are only the even spread the editor gives them
 * (recalculateWordTimings): back to back from the line's start to its end, each lasting in
 * proportion to its wordSpreadWeight, also after the whole line was moved. A one-word line
 * whose word fills the line counts too. The backend applies the same rule
 * (lyric_sync.words_spread_evenly).
 */
export function wordsSpreadEvenly(line: LyricLine): boolean {
  const words = line.words ?? [];
  const { start_time: start, end_time: end } = line;
  if (words.length === 0 || !(end > start)) return false;
  const weights = words.map((w) => wordSpreadWeight(w.word ?? ''));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const near = (a: number, b: number) => Math.abs(a - b) <= SPREAD_TOLERANCE + 1e-9;
  let cumulative = 0;
  let previousEnd = start;
  return words.every((word, i) => {
    cumulative += weights[i];
    const spread =
      near(word.start_time, previousEnd) &&
      near(word.end_time, start + ((end - start) * cumulative) / total);
    previousEnd = word.end_time;
    return spread;
  });
}

/**
 * How many lines have word timing set by hand: the lines a whole-song re-alignment with
 * `keep_manual` leaves as they are. Manual lines without words, or whose words are only the
 * editor's even spread (wordsSpreadEvenly), are timed again.
 */
export function countHandTimedLines(lines: LyricLine[]): number {
  return lines.filter(
    (line) =>
      line.align_method === 'manual' && (line.words ?? []).length > 0 && !wordsSpreadEvenly(line)
  ).length;
}

/**
 * `next` with every line changed by this edit (compared with `prev`) marked as a hand edit,
 * or restored to its `saved` version when the edit put it back as it was.
 */
export function markManualEdits(
  prev: LyricLine[],
  next: LyricLine[],
  saved: LyricLine[] = []
): LyricLine[] {
  if (next === prev) return next;
  const before = new Set(prev.map(lineContentKey));
  const savedByKey = new Map(saved.map((line) => [lineContentKey(line), line]));
  let changed = false;
  const result = next.map((line) => {
    const key = lineContentKey(line);
    if (before.has(key)) return line;
    const original = savedByKey.get(key);
    const marked = original ? asSaved(line, original) : asManual(line);
    if (marked !== line) changed = true;
    return marked;
  });
  return changed ? result : next;
}
