/**
 * Tap-to-Sync Engine
 *
 * Implements pure functional transformations for both line-by-line and
 * word-by-word tap-to-sync modes, preserving monotonic non-overlapping
 * boundaries, parent line constraints, and cross-line advancement.
 */

import { LyricLine, WordTiming } from '../types';
import { sanitizeTimestamp, recalculateWordTimings } from './lyrics';

export type TapSyncMode = 'line' | 'word';

export interface TapWordResult {
  updatedLines: LyricLine[];
  nextLineIndex: number;
  nextWordIndex: number;
  isComplete: boolean;
}

export interface TapLineResult {
  updatedLines: LyricLine[];
  nextLineIndex: number;
  isComplete: boolean;
}

/**
 * Line-level tap sync transformation
 */
export function applyLineTap(
  lines: LyricLine[],
  targetIndex: number,
  currentTime: number,
  duration: number
): TapLineResult {
  if (targetIndex >= lines.length) {
    return {
      updatedLines: lines,
      nextLineIndex: 0,
      isComplete: true,
    };
  }

  const rawTapTime = sanitizeTimestamp(currentTime);
  const prevLine = targetIndex > 0 ? lines[targetIndex - 1] : null;
  const effectiveTap = prevLine ? Math.max(rawTapTime, prevLine.start_time) : rawTapTime;

  const updatedLines = lines.map((line, idx) => {
    if (idx === targetIndex - 1 && line.end_time > effectiveTap) {
      const recalculated = recalculateWordTimings(line.text, line.start_time, effectiveTap);
      const clampedWords = recalculated.map((w) => ({
        ...w,
        start_time: Math.min(effectiveTap, w.start_time),
        end_time: Math.min(effectiveTap, Math.max(w.start_time, w.end_time)),
      }));
      return {
        ...line,
        end_time: effectiveTap,
        words: clampedWords,
      };
    }
    if (idx === targetIndex) {
      let proposedEnd =
        line.end_time > effectiveTap ? line.end_time : sanitizeTimestamp(effectiveTap + 3.0);
      if (duration > effectiveTap + 0.5 && proposedEnd > duration) {
        proposedEnd = sanitizeTimestamp(duration);
      }
      if (proposedEnd <= effectiveTap) {
        proposedEnd = sanitizeTimestamp(effectiveTap + 0.5);
      }
      return {
        ...line,
        start_time: effectiveTap,
        end_time: proposedEnd,
        words: recalculateWordTimings(line.text, effectiveTap, proposedEnd),
      };
    }
    return line;
  });

  const nextIndex = targetIndex + 1;
  const isComplete = nextIndex >= lines.length;

  return {
    updatedLines,
    nextLineIndex: isComplete ? 0 : nextIndex,
    isComplete,
  };
}

/**
 * Word-level tap sync transformation
 */
export function applyWordTap(
  lines: LyricLine[],
  targetLineIndex: number,
  targetWordIndex: number,
  currentTime: number,
  duration: number
): TapWordResult {
  if (targetLineIndex >= lines.length) {
    return {
      updatedLines: lines,
      nextLineIndex: 0,
      nextWordIndex: 0,
      isComplete: true,
    };
  }

  // Deep copy lines and words for pure immutability
  const updatedLines: LyricLine[] = lines.map((l) => ({
    ...l,
    words: (l.words && l.words.length > 0
      ? l.words
      : recalculateWordTimings(l.text, l.start_time, l.end_time)
    ).map((w) => ({ ...w })),
  }));

  const currentLine = updatedLines[targetLineIndex];
  if (!currentLine || currentLine.words.length === 0) {
    const nextLine = targetLineIndex + 1;
    const isComplete = nextLine >= updatedLines.length;
    return {
      updatedLines,
      nextLineIndex: isComplete ? 0 : nextLine,
      nextWordIndex: 0,
      isComplete,
    };
  }

  const rawTapTime = sanitizeTimestamp(currentTime);
  const words = currentLine.words;
  const wordIdx = Math.min(Math.max(0, targetWordIndex), words.length - 1);
  const targetWord = words[wordIdx];

  // 1. Cap / adjust preceding word so timings remain monotonic and non-overlapping.
  // Preceding word's start_time is an invariant (cannot be moved backwards).
  // Target word's start_time must not precede the preceding word's start_time.
  let effectiveTap = rawTapTime;

  if (wordIdx > 0) {
    // Preceding word in same line
    const prevWord = words[wordIdx - 1];
    effectiveTap = Math.max(rawTapTime, prevWord.start_time);
    if (prevWord.end_time > effectiveTap) {
      prevWord.end_time = effectiveTap;
    }
  } else if (targetLineIndex > 0) {
    // Preceding word across line boundary: find most recent previous line with words
    let prevLine: LyricLine | null = null;
    let prevWord: WordTiming | null = null;
    for (let p = targetLineIndex - 1; p >= 0; p--) {
      const candidate = updatedLines[p];
      if (candidate && candidate.words && candidate.words.length > 0) {
        prevLine = candidate;
        prevWord = candidate.words[candidate.words.length - 1];
        break;
      }
    }
    if (prevLine && prevWord) {
      effectiveTap = Math.max(rawTapTime, prevWord.start_time);
      if (prevWord.end_time > effectiveTap) {
        prevWord.end_time = effectiveTap;
      }
      // Re-bound previous line
      prevLine.end_time = sanitizeTimestamp(Math.max(...prevLine.words.map((w) => w.end_time)));
      prevLine.start_time = sanitizeTimestamp(Math.min(...prevLine.words.map((w) => w.start_time)));
      if (prevLine.end_time > effectiveTap) {
        prevLine.end_time = effectiveTap;
      }
    }
  }

  // 2. Stamp target word start_time and ensure positive duration
  targetWord.start_time = effectiveTap;
  let proposedEnd =
    targetWord.end_time > effectiveTap
      ? targetWord.end_time
      : sanitizeTimestamp(effectiveTap + 0.5);
  if (duration > effectiveTap + 0.1 && proposedEnd > duration) {
    proposedEnd = sanitizeTimestamp(duration);
  }
  if (proposedEnd <= effectiveTap) {
    proposedEnd = sanitizeTimestamp(effectiveTap + 0.2);
  }
  targetWord.end_time = proposedEnd;

  // 3. Shift subsequent untapped words in current line to preserve monotonicity
  for (let k = wordIdx + 1; k < words.length; k++) {
    if (words[k].start_time < words[k - 1].end_time) {
      const dur = Math.max(0.1, sanitizeTimestamp(words[k].end_time - words[k].start_time));
      words[k].start_time = words[k - 1].end_time;
      words[k].end_time = sanitizeTimestamp(words[k].start_time + dur);
    }
  }

  // 4. Update parent line bounds monotonically
  currentLine.start_time = sanitizeTimestamp(Math.min(...words.map((w) => w.start_time)));
  currentLine.end_time = sanitizeTimestamp(Math.max(...words.map((w) => w.end_time)));
  if (currentLine.end_time <= currentLine.start_time) {
    currentLine.end_time = sanitizeTimestamp(currentLine.start_time + 0.5);
  }

  // 5. Determine advancement across word and line boundaries
  const isLastWordInLine = wordIdx >= words.length - 1;
  const isLastLine = targetLineIndex >= updatedLines.length - 1;

  if (isLastWordInLine) {
    if (isLastLine) {
      return {
        updatedLines,
        nextLineIndex: 0,
        nextWordIndex: 0,
        isComplete: true,
      };
    } else {
      return {
        updatedLines,
        nextLineIndex: targetLineIndex + 1,
        nextWordIndex: 0,
        isComplete: false,
      };
    }
  } else {
    return {
      updatedLines,
      nextLineIndex: targetLineIndex,
      nextWordIndex: wordIdx + 1,
      isComplete: false,
    };
  }
}
