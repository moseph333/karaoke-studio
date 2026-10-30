/**
 * Lyric Timing Utilities
 *
 * Timestamp rounding and sanitizing, word tokenizing and even re-timing, insertion times
 * for new lines, batch offsets, and the line and word being sung at a given time.
 */

import { WordTiming, LyricLine } from '../types';

/**
 * Rounds a floating point timestamp to 3 decimal places (milliseconds).
 * Defends against IEEE 754 precision drift.
 */
export const round3 = (val: number): number => {
  if (typeof val !== 'number' || !Number.isFinite(val) || isNaN(val)) return 0;
  return parseFloat(val.toFixed(3));
};

/**
 * Sanitizes a timestamp: non-negative, finite, 3-decimal rounded.
 */
export const sanitizeTimestamp = (val: number): number => {
  if (typeof val !== 'number' || !Number.isFinite(val) || isNaN(val)) return 0;
  return Math.max(0, round3(val));
};

/**
 * Formats seconds into displayable string (e.g. 5.0, 5.25).
 */
export const formatLineTime = (t: number): string => {
  const rounded = round3(t);
  const str = rounded.toFixed(2);
  if (str.endsWith('0')) {
    return rounded.toFixed(1);
  }
  return str;
};

/**
 * Regular expression matching:
 * 1. Single CJK character + attached closing punctuation/prolonged sound marks
 * 2. Or sequence of non-CJK, non-whitespace characters (Latin words, digits, symbols)
 */
const TOKEN_REGEX =
  /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af][\u30fc\u3001\u3002\uff01\uff0c\uff1f\uff1a\uff1b\u3009\u300b\u300d\u300f\u3011.,!?'")\]}>]*)|([^\s\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)/gu;

/**
 * Tokenizes lyric text into words or CJK syllable units.
 */
export function tokenizeLyricText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(TOKEN_REGEX);
  return matches ? Array.from(matches) : [];
}

/**
 * Recalculates word-level timing tokens across [startTime, endTime].
 *
 * Guarantees:
 * - words[0].start_time === startTime
 * - words[n-1].end_time === endTime
 * - Strictly monotonic non-decreasing timestamps: words[i].start_time <= words[i].end_time
 * - Zero overlap between adjacent tokens: words[i].start_time === words[i-1].end_time
 * - Proportional timing weighted by character length with baseline floor
 * - Complete defense against empty text, single words, CJK characters, zero duration,
 *   inverted timestamps, and NaN / Infinity values.
 */
export function recalculateWordTimings(
  text: string,
  startTime: number,
  endTime: number
): WordTiming[] {
  const rawTokens = tokenizeLyricText(text);
  if (rawTokens.length === 0) {
    return [];
  }

  const n = rawTokens.length;

  // 1. Sanitize start time
  let safeStart =
    typeof startTime !== 'number' || !Number.isFinite(startTime) || isNaN(startTime)
      ? 0.0
      : Math.max(0.0, startTime);
  safeStart = Math.min(86400.0, round3(safeStart));

  // 2. Minimum duration guard: at least 0.1s per token, minimum 0.5s total
  const minDuration = Math.max(0.5, n * 0.1);
  if (safeStart + minDuration > 86400.0) {
    safeStart = Math.max(0.0, round3(86400.0 - minDuration));
  }

  let safeEnd =
    typeof endTime !== 'number' || !Number.isFinite(endTime) || isNaN(endTime)
      ? safeStart + minDuration
      : endTime;
  safeEnd = Math.min(86400.0, round3(safeEnd));

  if (safeEnd <= safeStart) {
    safeEnd = round3(safeStart + minDuration);
  } else if (safeEnd - safeStart < n * 0.001) {
    // Micro-duration defense: ensure at least 10ms per token if duration is impossibly compressed
    safeEnd = round3(safeStart + n * 0.01);
  }

  const totalDur = safeEnd - safeStart;

  // 3. Single token case: anchors directly to [safeStart, safeEnd]
  if (n === 1) {
    return [
      {
        word: rawTokens[0],
        start_time: safeStart,
        end_time: safeEnd,
      },
    ];
  }

  // 4. Calculate proportional weights (baseWeight=2.0 + alphanumeric character count)
  const weights = rawTokens.map((t) => {
    const cleanChars = t.replace(/[\s.,/#!$%^&*;:{}=\-_`~()"<>[\]?]/g, '');
    const charLen = cleanChars.length > 0 ? cleanChars.length : t.length;
    return 2.0 + Math.min(10, charLen);
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  // 5. Monotonic boundary distribution with contiguous endpoints
  const words: WordTiming[] = [];
  let currentStart = safeStart;
  let cumWeight = 0;

  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      // Last token anchors exactly to safeEnd
      words.push({
        word: rawTokens[i],
        start_time: currentStart,
        end_time: safeEnd,
      });
    } else {
      cumWeight += weights[i];
      const targetTime = safeStart + totalDur * (cumWeight / totalWeight);

      // Clamp between currentStart + 0.001s and safeEnd - (n - 1 - i) * 0.001s
      const minEnd = round3(currentStart + 0.001);
      const maxEnd = round3(safeEnd - (n - 1 - i) * 0.001);
      let calculatedEnd = round3(targetTime);
      if (calculatedEnd < minEnd) calculatedEnd = minEnd;
      if (calculatedEnd > maxEnd) calculatedEnd = maxEnd;

      words.push({
        word: rawTokens[i],
        start_time: currentStart,
        end_time: calculatedEnd,
      });
      currentStart = calculatedEnd;
    }
  }

  // 6. Final safety invariant pass to defend against any IEEE 754 precision drift
  for (let i = 1; i < words.length; i++) {
    if (words[i].start_time < words[i - 1].end_time) {
      words[i].start_time = words[i - 1].end_time;
    }
    if (words[i].end_time < words[i].start_time) {
      words[i].end_time = words[i].start_time;
    }
  }

  return words;
}

/**
 * Calculates start and end times for inserting a new line into an existing lines array.
 */
export function calculateLineInsertTimes(
  lines: LyricLine[],
  afterIndex: number,
  currentTime: number = 0,
  duration: number = 0
): { start_time: number; end_time: number } {
  if (!lines || lines.length === 0) {
    const s = Math.max(0, round3(currentTime));
    return { start_time: s, end_time: round3(s + 3.0) };
  }

  if (afterIndex < 0) {
    // Insert before first line
    const first = lines[0];
    if (first.start_time >= 3.5) {
      const s = round3(first.start_time - 3.2);
      const e = round3(first.start_time - 0.2);
      return { start_time: s, end_time: e };
    } else if (first.start_time > 0.6) {
      const s = 0.0;
      const e = round3(first.start_time - 0.1);
      return { start_time: s, end_time: e };
    } else {
      const s = 0.0;
      const e = round3(Math.max(0.5, first.start_time));
      return { start_time: s, end_time: e };
    }
  }

  if (afterIndex >= lines.length - 1) {
    // Insert after last line
    const last = lines[lines.length - 1];
    const s = round3(last.end_time + 0.5);
    let e = round3(s + 3.0);
    if (duration > s + 0.5 && e > duration) {
      e = round3(duration);
    }
    return { start_time: s, end_time: e };
  }

  // Insert between lines[afterIndex] and lines[afterIndex + 1]
  const prev = lines[afterIndex];
  const next = lines[afterIndex + 1];
  const gap = next.start_time - prev.end_time;

  if (gap >= 0.6) {
    const s = round3(prev.end_time + 0.1);
    const dur = Math.min(3.0, Math.max(0.5, next.start_time - 0.1 - s));
    const e = round3(Math.min(next.start_time - 0.1, s + dur));
    return { start_time: s, end_time: e <= s ? round3(next.start_time) : e };
  } else {
    // Tight gap or overlapping
    const s = round3(prev.end_time);
    return { start_time: s, end_time: round3(s + 2.0) };
  }
}

/**
 * Applies a uniform time offset (in seconds) to lyric lines and their internal word tokens.
 *
 * Invariants maintained:
 * - Lines before fromLineIndex are unmodified.
 * - Non-negative timestamps: All line and word start_time / end_time values are >= 0.0s.
 * - Monotonicity: For each line, words[i].start_time >= words[i-1].end_time (for i >= 1).
 * - Minimum word duration: Each word has duration >= 0.01s.
 * - Line endpoints anchor to word extents (if words are present), or maintain min duration >= 0.01s.
 * - Precision: All timestamps are rounded to 3 decimal places using round3().
 * - Returns a new array with cloned objects.
 */
export function applyBatchOffset(
  lines: LyricLine[],
  deltaSeconds: number,
  fromLineIndex: number = 0
): LyricLine[] {
  if (!lines || lines.length === 0) return [];
  const delta = round3(deltaSeconds);
  if (!Number.isFinite(delta) || isNaN(delta)) {
    return lines.map((l) => ({
      ...l,
      words: l.words ? l.words.map((w) => ({ ...w })) : [],
    }));
  }

  const startIndex = Math.max(0, Math.min(lines.length, fromLineIndex));

  return lines.map((line, idx) => {
    if (idx < startIndex) {
      return {
        ...line,
        words: line.words ? line.words.map((w) => ({ ...w })) : [],
      };
    }

    if (!line.words || line.words.length === 0) {
      const newStart = Math.max(0.0, sanitizeTimestamp(line.start_time + delta));
      const proposedEnd = sanitizeTimestamp(line.end_time + delta);
      const newEnd = Math.max(round3(newStart + 0.01), proposedEnd);
      return {
        ...line,
        start_time: newStart,
        end_time: newEnd,
        words: [],
      };
    }

    // Shift and sanitize each word
    const shiftedWords: WordTiming[] = line.words.map((w) => {
      const wStart = sanitizeTimestamp(w.start_time + delta);
      const wEnd = sanitizeTimestamp(w.end_time + delta);
      return {
        word: w.word,
        start_time: wStart,
        end_time: wEnd,
      };
    });

    // Enforce monotonic non-overlapping word bounds and minimum 0.01s duration
    for (let i = 0; i < shiftedWords.length; i++) {
      if (i === 0) {
        shiftedWords[0].start_time = Math.max(0.0, shiftedWords[0].start_time);
      } else {
        shiftedWords[i].start_time = Math.max(
          shiftedWords[i - 1].end_time,
          shiftedWords[i].start_time
        );
      }
      shiftedWords[i].end_time = Math.max(
        round3(shiftedWords[i].start_time + 0.01),
        shiftedWords[i].end_time
      );
    }

    const lineStart = Math.min(...shiftedWords.map((w) => w.start_time));
    const lineEnd = Math.max(...shiftedWords.map((w) => w.end_time));

    return {
      ...line,
      start_time: lineStart,
      end_time: lineEnd,
      words: shiftedWords,
    };
  });
}

export interface ActiveWordLocation {
  lineId: number;
  wordIndex: number;
  word: WordTiming;
}

/**
 * Calculates current active word location based on playback currentTime.
 */
export function getActiveWordLocation(
  lines: LyricLine[],
  currentTime: number
): ActiveWordLocation | null {
  if (!lines || lines.length === 0) return null;

  for (const line of lines) {
    if (currentTime >= line.start_time - 0.5 && currentTime <= line.end_time + 0.5) {
      if (line.words && line.words.length > 0) {
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time && currentTime <= w.end_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }
        for (let wIdx = line.words.length - 1; wIdx >= 0; wIdx--) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }
        if (currentTime >= line.start_time - 0.5) {
          return { lineId: line.id, wordIndex: 0, word: line.words[0] };
        }
      }
    }
  }
  return null;
}

/**
 * getActiveWordLocation as a key ("lineId:wordIndex"), a primitive a playback-clock selector
 * can return so the timeline re-renders only when the active word changes.
 */
export function activeWordKeyAt(lines: LyricLine[], currentTime: number): string | null {
  const loc = getActiveWordLocation(lines, currentTime);
  return loc ? `${loc.lineId}:${loc.wordIndex}` : null;
}

/** The word a key from activeWordKeyAt names, or null when it is no longer in `lines`. */
export function wordLocationFromKey(
  lines: LyricLine[],
  key: string | null
): ActiveWordLocation | null {
  if (key === null) return null;
  const split = key.lastIndexOf(':');
  const lineId = Number(key.slice(0, split));
  const wordIndex = Number(key.slice(split + 1));
  const word = lines.find((l) => l.id === lineId)?.words?.[wordIndex];
  return word ? { lineId, wordIndex, word } : null;
}

/**
 * The line the timeline highlights: the first from 1.5 s before its start to 1 s after its
 * end, or -1.
 */
export function findLeadInLineIndex(lines: LyricLine[], currentTime: number): number {
  return lines.findIndex(
    (l) => currentTime >= l.start_time - 1.5 && currentTime <= l.end_time + 1.0
  );
}
