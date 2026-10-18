import { describe, it, expect } from 'vitest';
import {
  recalculateWordTimings,
  tokenizeLyricText,
  calculateLineInsertTimes,
  round3,
  sanitizeTimestamp,
  formatLineTime,
} from '../utils/lyrics';
import { LyricLine } from '../types';

describe('lyrics utility module (Milestone 3)', () => {
  describe('round3, sanitizeTimestamp, formatLineTime', () => {
    it('round3 rounds to 3 decimal places and guards non-finites', () => {
      expect(round3(1.23456)).toBe(1.235);
      expect(round3(1.2)).toBe(1.2);
      expect(round3(NaN)).toBe(0);
      expect(round3(Infinity)).toBe(0);
      expect(round3(-Infinity)).toBe(0);
      expect(round3(null as unknown as number)).toBe(0);
      expect(round3(undefined as unknown as number)).toBe(0);
    });

    it('sanitizeTimestamp clamps negative numbers to zero and guards non-finites', () => {
      expect(sanitizeTimestamp(-5.5)).toBe(0);
      expect(sanitizeTimestamp(0)).toBe(0);
      expect(sanitizeTimestamp(12.3456)).toBe(12.346);
      expect(sanitizeTimestamp(NaN)).toBe(0);
      expect(sanitizeTimestamp(Infinity)).toBe(0);
    });

    it('formatLineTime formats times cleanly', () => {
      expect(formatLineTime(5.0)).toBe('5.0');
      expect(formatLineTime(5.25)).toBe('5.25');
      expect(formatLineTime(10.123)).toBe('10.12');
      expect(formatLineTime(0)).toBe('0.0');
    });
  });

  describe('tokenizeLyricText', () => {
    it('returns empty array for empty or whitespace text', () => {
      expect(tokenizeLyricText('')).toEqual([]);
      expect(tokenizeLyricText('   \n\t  ')).toEqual([]);
      expect(tokenizeLyricText(null as unknown as string)).toEqual([]);
      expect(tokenizeLyricText(undefined as unknown as string)).toEqual([]);
    });

    it('tokenizes Western words with attached punctuation', () => {
      expect(tokenizeLyricText('Is this the real life?')).toEqual([
        'Is',
        'this',
        'the',
        'real',
        'life?',
      ]);
      expect(tokenizeLyricText("Don't stop me now!")).toEqual(["Don't", 'stop', 'me', 'now!']);
    });

    it('tokenizes unspaced CJK characters into individual syllables', () => {
      expect(tokenizeLyricText('青花瓷')).toEqual(['青', '花', '瓷']);
      expect(tokenizeLyricText('青花瓷！')).toEqual(['青', '花', '瓷！']);
    });

    it('tokenizes Japanese kana with prolonged sound marks', () => {
      expect(tokenizeLyricText('残酷な天使のテーゼ')).toEqual([
        '残',
        '酷',
        'な',
        '天',
        '使',
        'の',
        'テー',
        'ゼ',
      ]);
    });

    it('tokenizes mixed Latin and CJK text', () => {
      expect(tokenizeLyricText('Hello 世界, beautiful world!')).toEqual([
        'Hello',
        '世',
        '界,',
        'beautiful',
        'world!',
      ]);
    });

    it('tokenizes pure punctuation tokens', () => {
      expect(tokenizeLyricText('... --- !?')).toEqual(['...', '---', '!?']);
    });
  });

  describe('recalculateWordTimings', () => {
    it('returns empty array for empty, whitespace, or invalid inputs', () => {
      expect(recalculateWordTimings('', 5.0, 8.0)).toEqual([]);
      expect(recalculateWordTimings('   \n\t  ', 5.0, 8.0)).toEqual([]);
      expect(recalculateWordTimings(null as unknown as string, 5.0, 8.0)).toEqual([]);
      expect(recalculateWordTimings(undefined as unknown as string, 5.0, 8.0)).toEqual([]);
    });

    it('anchors a single Western word to exactly [startTime, endTime]', () => {
      const tokens = recalculateWordTimings('Bohemian', 5.0, 8.0);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].word).toBe('Bohemian');
      expect(tokens[0].start_time).toBe(5.0);
      expect(tokens[0].end_time).toBe(8.0);
    });

    it('anchors a single CJK character to exactly [startTime, endTime]', () => {
      const tokens = recalculateWordTimings('青', 10.0, 12.0);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].word).toBe('青');
      expect(tokens[0].start_time).toBe(10.0);
      expect(tokens[0].end_time).toBe(12.0);
    });

    it('distributes multi-word Western lines proportionally, contiguously, and boundary anchored', () => {
      const tokens = recalculateWordTimings('Is this the real life', 5.0, 8.0);
      expect(tokens).toHaveLength(5);
      expect(tokens.map((t) => t.word)).toEqual(['Is', 'this', 'the', 'real', 'life']);

      // Boundary anchoring
      expect(tokens[0].start_time).toBe(5.0);
      expect(tokens[4].end_time).toBe(8.0);

      // Monotonic non-decreasing & contiguous (zero gap, zero overlap)
      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i].start_time).toBeLessThanOrEqual(tokens[i].end_time);
        expect(Number.isFinite(tokens[i].start_time)).toBe(true);
        expect(Number.isFinite(tokens[i].end_time)).toBe(true);
        if (i > 0) {
          expect(tokens[i].start_time).toBe(tokens[i - 1].end_time);
        }
      }

      // Proportional: "this" (len 4) gets more duration than "Is" (len 2)
      const durIs = tokens[0].end_time - tokens[0].start_time;
      const durThis = tokens[1].end_time - tokens[1].start_time;
      expect(durThis).toBeGreaterThan(durIs);
    });

    it('segments unspaced CJK into individual characters with contiguous timing', () => {
      const tokens = recalculateWordTimings('青花瓷', 10.0, 13.0);
      expect(tokens).toHaveLength(3);
      expect(tokens.map((t) => t.word)).toEqual(['青', '花', '瓷']);

      expect(tokens[0].start_time).toBe(10.0);
      expect(tokens[2].end_time).toBe(13.0);

      expect(tokens[1].start_time).toBe(tokens[0].end_time);
      expect(tokens[2].start_time).toBe(tokens[1].end_time);
    });

    it('handles Japanese kana with prolonged sound marks', () => {
      const tokens = recalculateWordTimings('残酷な天使のテーゼ', 0.0, 8.0);
      expect(tokens).toHaveLength(8);
      expect(tokens.map((t) => t.word)).toEqual(['残', '酷', 'な', '天', '使', 'の', 'テー', 'ゼ']);
      expect(tokens[0].start_time).toBe(0.0);
      expect(tokens[7].end_time).toBe(8.0);
    });

    it('handles mixed Latin and CJK text seamlessly', () => {
      const tokens = recalculateWordTimings('Hello 世界, beautiful world!', 2.0, 7.0);
      expect(tokens).toHaveLength(5);
      expect(tokens.map((t) => t.word)).toEqual(['Hello', '世', '界,', 'beautiful', 'world!']);

      expect(tokens[0].start_time).toBe(2.0);
      expect(tokens[4].end_time).toBe(7.0);
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i].start_time).toBe(tokens[i - 1].end_time);
      }
    });

    it('handles punctuation attachment and standalone symbols without NaNs', () => {
      const tokens = recalculateWordTimings('... --- !?', 1.0, 4.0);
      expect(tokens).toHaveLength(3);
      expect(tokens[0].start_time).toBe(1.0);
      expect(tokens[2].end_time).toBe(4.0);
      for (const t of tokens) {
        expect(Number.isFinite(t.start_time)).toBe(true);
        expect(Number.isFinite(t.end_time)).toBe(true);
      }
    });

    it('defends against zero duration by assigning positive duration', () => {
      const tokens = recalculateWordTimings('Hello world', 5.0, 5.0);
      expect(tokens).toHaveLength(2);
      expect(tokens[0].start_time).toBe(5.0);
      expect(tokens[1].end_time).toBeGreaterThan(5.0);
      for (const t of tokens) {
        expect(t.end_time).toBeGreaterThan(t.start_time);
      }
    });

    it('defends against inverted timestamps by assigning positive duration', () => {
      const tokens = recalculateWordTimings('One two three', 8.0, 4.0);
      expect(tokens).toHaveLength(3);
      expect(tokens[0].start_time).toBe(8.0);
      expect(tokens[2].end_time).toBeGreaterThan(8.0);
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i].start_time).toBe(tokens[i - 1].end_time);
      }
    });

    it('defends against NaN and Infinite timestamps', () => {
      const tokens = recalculateWordTimings('Valid words', NaN, Infinity);
      expect(tokens).toHaveLength(2);
      expect(tokens[0].start_time).toBe(0.0);
      expect(Number.isFinite(tokens[1].end_time)).toBe(true);
      expect(tokens[1].end_time).toBeGreaterThan(0.0);
      for (const t of tokens) {
        expect(Number.isFinite(t.start_time)).toBe(true);
        expect(Number.isFinite(t.end_time)).toBe(true);
        expect(!isNaN(t.start_time)).toBe(true);
        expect(!isNaN(t.end_time)).toBe(true);
      }
    });

    it('handles micro-duration compression with strictly increasing times', () => {
      const tokens = recalculateWordTimings('Rapid five token sentence here', 1.0, 1.002);
      expect(tokens).toHaveLength(5);
      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i].end_time).toBeGreaterThan(tokens[i].start_time);
        if (i > 0) {
          expect(tokens[i].start_time).toBeGreaterThanOrEqual(tokens[i - 1].end_time);
        }
      }
    });

    it('handles large-scale lines with 50 words across 60 seconds with exact boundary anchoring', () => {
      const wordsArray = Array.from({ length: 50 }, (_, i) => `word${i + 1}`);
      const text = wordsArray.join(' ');
      const tokens = recalculateWordTimings(text, 10.0, 70.0);

      expect(tokens).toHaveLength(50);
      expect(tokens[0].start_time).toBe(10.0);
      expect(tokens[49].end_time).toBe(70.0);

      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i].start_time).toBeLessThanOrEqual(tokens[i].end_time);
        if (i > 0) {
          expect(tokens[i].start_time).toBe(tokens[i - 1].end_time);
        }
      }
    });
  });

  describe('calculateLineInsertTimes', () => {
    const lines: LyricLine[] = [
      {
        id: 1,
        text: 'Line 1',
        start_time: 2.0,
        end_time: 5.0,
        words: [],
      },
      {
        id: 2,
        text: 'Line 2',
        start_time: 8.0,
        end_time: 12.0,
        words: [],
      },
    ];

    it('calculates insert times for empty lines list', () => {
      const res = calculateLineInsertTimes([], 0, 15.0);
      expect(res.start_time).toBe(15.0);
      expect(res.end_time).toBe(18.0);
    });

    it('calculates insert times before the first line', () => {
      const res = calculateLineInsertTimes(lines, -1);
      expect(res.start_time).toBe(0.0);
      expect(res.end_time).toBe(1.9);
    });

    it('calculates insert times in a gap between lines', () => {
      // Gap between 5.0 and 8.0 is 3.0s (>= 0.6s)
      const res = calculateLineInsertTimes(lines, 0);
      expect(res.start_time).toBe(5.1);
      expect(res.end_time).toBeLessThanOrEqual(7.9);
      expect(res.end_time).toBeGreaterThan(res.start_time);
    });

    it('calculates insert times when lines touch or overlap', () => {
      const touchingLines: LyricLine[] = [
        { id: 1, text: 'A', start_time: 2.0, end_time: 5.0, words: [] },
        { id: 2, text: 'B', start_time: 5.2, end_time: 8.0, words: [] },
      ];
      const res = calculateLineInsertTimes(touchingLines, 0);
      expect(res.start_time).toBe(5.0);
      expect(res.end_time).toBe(7.0);
    });

    it('calculates insert times at the end of lines', () => {
      const res = calculateLineInsertTimes(lines, 1, 0, 60.0);
      expect(res.start_time).toBe(12.5);
      expect(res.end_time).toBe(15.5);
    });

    it('caps insert end time by project duration if near audio end', () => {
      const res = calculateLineInsertTimes(lines, 1, 0, 14.0);
      expect(res.start_time).toBe(12.5);
      expect(res.end_time).toBe(14.0);
    });
  });
});
