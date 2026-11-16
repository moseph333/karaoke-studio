/**
 * Singing the lyrics leave out: the parts of the stem's vocal regions (from the server's
 * sync report) that no line covers, worked out live as lines are edited. Mirrors
 * `uncovered_vocals` in backend/services/sync_confidence.py, with the thresholds both read
 * from backend/assets/shared/uncovered_vocals.json.
 */

import thresholds from '@shared/uncovered_vocals.json';
import type { LyricLine } from '../types';

export interface VocalSpan {
  start: number;
  end: number;
}

const round2 = (t: number) => Math.round(t * 100) / 100;

export function uncoveredVocals(
  regions: ReadonlyArray<readonly [number, number]> | undefined | null,
  lines: LyricLine[],
  minSeconds = thresholds.min_seconds,
  margin = thresholds.line_margin_seconds
): VocalSpan[] {
  if (!regions?.length) return [];
  const spans = lines
    .map((l) => [l.start_time - margin, l.end_time + margin] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: VocalSpan[] = [];
  for (const [start, end] of regions) {
    let cursor = start;
    for (const [a, b] of spans) {
      if (b <= cursor || a >= end) continue;
      if (a - cursor >= minSeconds) out.push({ start: round2(cursor), end: round2(a) });
      cursor = Math.max(cursor, b);
      if (cursor >= end) break;
    }
    if (end - cursor >= minSeconds) out.push({ start: round2(cursor), end: round2(end) });
  }
  return out;
}
