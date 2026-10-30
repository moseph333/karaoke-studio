/**
 * Timeline review checks
 *
 * Flags lyric lines whose timing is likely to look wrong on stage so the editor can
 * offer a "Needs review" filter: low alignment confidence, missing word timings,
 * words too short to see, and lines that run into the next line of the same voice.
 */

import thresholds from '@shared/confidence_thresholds.json';
import { normalizeSingerRole } from '../components/stage/singers';
import { LyricLine } from '../types';

export type LineIssueKind = 'low_confidence' | 'no_words' | 'short_words' | 'overlap';

export interface LineIssue {
  kind: LineIssueKind;
  message: string;
}

/** Lines aligned below this confidence (0–1) are flagged for review, as in the backend's
 * sync report. */
export const LOW_CONFIDENCE_THRESHOLD = thresholds.low;
/** Words shorter than this (seconds) flash by too quickly to read. */
export const MIN_VISIBLE_WORD_SECONDS = 0.02;
/** Overlap (seconds) tolerated between consecutive lines of the same voice. */
export const OVERLAP_TOLERANCE_SECONDS = 0.05;

/** Whether two lines are sung by the same single voice ("s2" and "partner" are one voice). */
const sameVoice = (a: LyricLine, b: LyricLine): boolean => {
  const sa = normalizeSingerRole(a.singer);
  return sa === normalizeSingerRole(b.singer) && sa !== 'both';
};

export function getLineIssues(line: LyricLine, next?: LyricLine | null): LineIssue[] {
  const issues: LineIssue[] = [];
  const confidence = line.confidence;
  if (
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    issues.push({
      kind: 'low_confidence',
      message: `Low sync confidence (${Math.round(Math.max(0, confidence) * 100)}%)`,
    });
  }

  const words = line.words ?? [];
  if (words.length === 0) {
    if (line.text.trim()) issues.push({ kind: 'no_words', message: 'No word timings' });
  } else {
    const short = words.filter((w) => w.end_time - w.start_time < MIN_VISIBLE_WORD_SECONDS).length;
    if (short > 0) {
      issues.push({
        kind: 'short_words',
        message: `${short} word${short === 1 ? '' : 's'} too short to see`,
      });
    }
  }

  if (next && sameVoice(line, next)) {
    const overlap = line.end_time - next.start_time;
    if (overlap > OVERLAP_TOLERANCE_SECONDS) {
      issues.push({
        kind: 'overlap',
        message: `Overlaps the next line by ${overlap.toFixed(2)}s`,
      });
    }
  }
  return issues;
}

/** Issues for every flagged line, keyed by line id. Lines without issues are omitted. */
export function collectLineIssues(lines: LyricLine[]): Map<number, LineIssue[]> {
  const result = new Map<number, LineIssue[]>();
  lines.forEach((line, idx) => {
    const issues = getLineIssues(line, lines[idx + 1] ?? null);
    if (issues.length > 0) result.set(line.id, issues);
  });
  return result;
}
