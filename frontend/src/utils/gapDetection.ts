/**
 * Instrumental Gap Detection & Countdown Utilities (Requirement R3)
 *
 * Detects extended non-vocal intervals (intro and inter-line gaps >= 4.0s)
 * and computes deterministic countdown time and progress fractions.
 */

import { LyricLine } from '../types';

export const INSTRUMENTAL_GAP_THRESHOLD_SECONDS = 4.0;

export interface InstrumentalGap {
  startTime: number;
  endTime: number;
  duration: number;
  isIntro: boolean;
  nextLineIndex: number;
  nextLine: LyricLine;
}

export interface CountdownState {
  hasGap: boolean;
  gap: InstrumentalGap | null;
  remainingTime: number; // Seconds remaining until nextLine.start_time
  progress: number; // 0.0 to 1.0
  progressPct: number; // 0.0 to 100.0
  countdownSeconds: number; // Ceil of remainingTime
  isLeadIn: boolean; // true when remainingTime <= 3.0
}

/**
 * Identifies all non-vocal intervals >= thresholdSeconds (default 4.0s):
 * 1. Intro gap: [0.0, lines[0].start_time] if >= 4.0s
 * 2. Inter-line gaps: [lines[i].end_time, lines[i+1].start_time] if >= 4.0s
 *
 * Handles unsorted lines, negative gaps/overlaps, and empty lyrics safely.
 */
export function detectInstrumentalGaps(
  lines: LyricLine[],
  thresholdSeconds: number = INSTRUMENTAL_GAP_THRESHOLD_SECONDS
): InstrumentalGap[] {
  if (!lines || lines.length === 0) return [];

  // Sort lines defensibly by start_time
  const sorted = [...lines]
    .filter((l) => l && Number.isFinite(l.start_time) && Number.isFinite(l.end_time))
    .sort((a, b) => a.start_time - b.start_time);

  if (sorted.length === 0) return [];

  const gaps: InstrumentalGap[] = [];

  // 1. Intro gap check
  const firstLine = sorted[0];
  const firstStart = Math.max(0, firstLine.start_time);
  if (firstStart >= thresholdSeconds) {
    gaps.push({
      startTime: 0,
      endTime: firstStart,
      duration: firstStart,
      isIntro: true,
      nextLineIndex: 0,
      nextLine: firstLine,
    });
  }

  // 2. Inter-line gaps check
  for (let i = 0; i < sorted.length - 1; i++) {
    const curEnd = Math.max(0, sorted[i].end_time);
    const nextStart = Math.max(0, sorted[i + 1].start_time);
    const gapDuration = nextStart - curEnd;

    // Discard negative gaps (overlaps) or intervals below threshold
    if (gapDuration >= thresholdSeconds) {
      gaps.push({
        startTime: curEnd,
        endTime: nextStart,
        duration: gapDuration,
        isIntro: false,
        nextLineIndex: i + 1,
        nextLine: sorted[i + 1],
      });
    }
  }

  return gaps;
}

/**
 * Calculates countdown time and normalized progress for the current playback time.
 * Returns hasGap: false as soon as currentTime >= gap.endTime.
 */
export function getCountdownState(currentTime: number, gaps: InstrumentalGap[]): CountdownState {
  if (!gaps || gaps.length === 0 || !Number.isFinite(currentTime) || currentTime < 0) {
    return {
      hasGap: false,
      gap: null,
      remainingTime: 0,
      progress: 0,
      progressPct: 0,
      countdownSeconds: 0,
      isLeadIn: false,
    };
  }

  // Active gap strictly requires: startTime <= currentTime < endTime
  const activeGap = gaps.find((g) => currentTime >= g.startTime && currentTime < g.endTime);

  if (!activeGap || activeGap.duration <= 0) {
    return {
      hasGap: false,
      gap: null,
      remainingTime: 0,
      progress: 0,
      progressPct: 0,
      countdownSeconds: 0,
      isLeadIn: false,
    };
  }

  const elapsed = Math.max(0, currentTime - activeGap.startTime);
  const remainingTime = Math.max(0, activeGap.endTime - currentTime);
  const progress = Math.min(1.0, Math.max(0.0, elapsed / activeGap.duration));
  const progressPct = progress * 100;
  const countdownSeconds = Math.ceil(remainingTime);
  const isLeadIn = remainingTime <= 3.0 && remainingTime > 0;

  return {
    hasGap: true,
    gap: activeGap,
    remainingTime,
    progress,
    progressPct,
    countdownSeconds,
    isLeadIn,
  };
}
