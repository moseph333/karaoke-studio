/**
 * Helpers for re-timing a single lyric line and showing how sure the aligner is about a line.
 */

import type { LyricLine } from '../types';
import { LOW_CONFIDENCE_THRESHOLD } from './timelineReview';

/** Confidence from this value up reads as solid. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(confidence?: number | null): ConfidenceLevel | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  return confidence >= LOW_CONFIDENCE_THRESHOLD ? 'medium' : 'low';
}

const METHOD_NAMES: Record<string, string> = {
  ctc: 'neural aligner',
  dsp: 'DSP aligner',
  lrc: 'lyrics file',
  fallback: 'estimate (no vocal evidence)',
};

/** "Sync confidence 86% (neural aligner)", or null for lines without a score. */
export function confidenceText(
  line: Pick<LyricLine, 'confidence' | 'align_method'>
): string | null {
  if (confidenceLevel(line.confidence) === null) return null;
  const pct = Math.round(Math.max(0, Math.min(1, line.confidence as number)) * 100);
  const method = line.align_method ? METHOD_NAMES[line.align_method] : undefined;
  return `Sync confidence ${pct}%${method ? ` (${method})` : ''}`;
}

const sameVoice = (a: LyricLine, b: LyricLine) => {
  const sa = a.singer ?? 'singer1';
  const sb = b.singer ?? 'singer1';
  return sa === 'both' || sb === 'both' || sa === sb;
};

/**
 * How far a line may move when it is re-aligned: from the end of the previous line to the
 * start of the next one sung by the same voice (duet parts may overlap each other).
 */
export function realignBounds(
  lines: LyricLine[],
  index: number
): { prev_end?: number; next_start?: number } {
  const line = lines[index];
  if (!line) return {};
  let prevEnd: number | undefined;
  for (let i = index - 1; i >= 0; i--) {
    if (sameVoice(lines[i], line)) {
      prevEnd = lines[i].end_time;
      break;
    }
  }
  let nextStart: number | undefined;
  for (let i = index + 1; i < lines.length; i++) {
    if (sameVoice(lines[i], line)) {
      nextStart = lines[i].start_time;
      break;
    }
  }
  if (prevEnd !== undefined && nextStart !== undefined && nextStart < prevEnd) {
    nextStart = undefined; // neighbours already overlap; let the server keep the line inside
  }
  return {
    ...(prevEnd !== undefined && prevEnd > 0 ? { prev_end: prevEnd } : {}),
    ...(nextStart !== undefined && nextStart > 0 ? { next_start: nextStart } : {}),
  };
}
