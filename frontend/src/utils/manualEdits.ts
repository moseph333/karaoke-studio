/**
 * Hand edits versus aligner metadata
 *
 * The aligner gives each line a confidence score and an `align_method`. Once someone changes
 * a line's text or timing by hand, that score no longer describes it: the line becomes
 * `align_method: "manual"` without a confidence. A line edited back to exactly how it was
 * saved gets its saved metadata back. Lines are matched by content, not id, because inserting
 * or deleting a line renumbers the ones after it.
 */

import type { LyricLine } from '../types';

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
