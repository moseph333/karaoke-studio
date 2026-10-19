import { describe, it, expect } from 'vitest';
import { applyWordTap, applyLineTap } from '../utils/tapSync';
import { LyricLine } from '../types';

describe('tapSync utility (Word and Line Tap-to-Sync Engine)', () => {
  const createSampleLines = (): LyricLine[] => [
    {
      id: 1,
      text: 'Hello lovely world',
      start_time: 1.0,
      end_time: 4.0,
      words: [
        { word: 'Hello', start_time: 1.0, end_time: 2.0 },
        { word: 'lovely', start_time: 2.0, end_time: 3.0 },
        { word: 'world', start_time: 3.0, end_time: 4.0 },
      ],
    },
    {
      id: 2,
      text: 'Singing with joy',
      start_time: 5.0,
      end_time: 8.0,
      words: [
        { word: 'Singing', start_time: 5.0, end_time: 6.0 },
        { word: 'with', start_time: 6.0, end_time: 7.0 },
        { word: 'joy', start_time: 7.0, end_time: 8.0 },
      ],
    },
  ];

  describe('applyWordTap: Word-Level Tap-to-Sync', () => {
    it('stamps current playback timestamp as target word start_time', () => {
      const lines = createSampleLines();
      const result = applyWordTap(lines, 0, 0, 1.25, 20);

      const targetWord = result.updatedLines[0].words[0];
      expect(targetWord.start_time).toBe(1.25);
      expect(targetWord.end_time).toBeGreaterThan(1.25);
      expect(result.nextLineIndex).toBe(0);
      expect(result.nextWordIndex).toBe(1);
      expect(result.isComplete).toBe(false);
    });

    it('caps preceding word end_time so it does not exceed target word start_time', () => {
      const lines = createSampleLines();
      // First word was tapped at 1.0s, ending at 2.5s
      lines[0].words[0].start_time = 1.0;
      lines[0].words[0].end_time = 2.5;

      // Second word tapped at 1.8s (earlier than previous word's 2.5s end_time)
      const result = applyWordTap(lines, 0, 1, 1.8, 20);

      const prevWord = result.updatedLines[0].words[0];
      const targetWord = result.updatedLines[0].words[1];

      expect(targetWord.start_time).toBe(1.8);
      // Preceding word must be capped to targetWord.start_time
      expect(prevWord.end_time).toBe(1.8);
      expect(prevWord.start_time).toBeLessThanOrEqual(prevWord.end_time);
      expect(result.nextLineIndex).toBe(0);
      expect(result.nextWordIndex).toBe(2);
      expect(result.isComplete).toBe(false);
    });

    it('caps preceding word across line boundaries when tapping first word of next line', () => {
      const lines = createSampleLines();
      // Line 1 last word ended at 4.5s
      lines[0].words[2].start_time = 3.5;
      lines[0].words[2].end_time = 4.5;
      lines[0].end_time = 4.5;

      // Tap Line 2 first word at 4.2s (earlier than Line 1 last word's end_time)
      const result = applyWordTap(lines, 1, 0, 4.2, 20);

      const prevLineLastWord = result.updatedLines[0].words[2];
      const prevLine = result.updatedLines[0];
      const currentWord = result.updatedLines[1].words[0];
      const currentLine = result.updatedLines[1];

      expect(currentWord.start_time).toBe(4.2);
      expect(prevLineLastWord.end_time).toBe(4.2);
      expect(prevLine.end_time).toBeLessThanOrEqual(4.2);
      expect(currentLine.start_time).toBe(4.2);
      expect(result.nextLineIndex).toBe(1);
      expect(result.nextWordIndex).toBe(1);
    });

    it('updates parent line start_time and end_time bounds monotonically', () => {
      const lines = createSampleLines();
      const result = applyWordTap(lines, 0, 0, 2.5, 20);

      const parentLine = result.updatedLines[0];
      expect(parentLine.start_time).toBe(2.5);
      expect(parentLine.end_time).toBeGreaterThanOrEqual(parentLine.start_time);
      for (const w of parentLine.words) {
        expect(w.start_time).toBeGreaterThanOrEqual(parentLine.start_time);
        expect(w.end_time).toBeLessThanOrEqual(parentLine.end_time);
      }
    });

    it('advances from last word of line to first word of next line', () => {
      const lines = createSampleLines();
      // Line 0 has 3 words (indices 0, 1, 2). Tap word 2 (last word of line 0)
      const result = applyWordTap(lines, 0, 2, 3.8, 20);

      expect(result.nextLineIndex).toBe(1);
      expect(result.nextWordIndex).toBe(0);
      expect(result.isComplete).toBe(false);
    });

    it('marks isComplete true and returns clean completion when final word of final line is tapped', () => {
      const lines = createSampleLines();
      // Line 1 has 3 words (indices 0, 1, 2). Tap word 2 of line 1 (final word of song)
      const result = applyWordTap(lines, 1, 2, 7.5, 20);

      expect(result.isComplete).toBe(true);
      expect(result.nextLineIndex).toBe(0);
      expect(result.nextWordIndex).toBe(0);
      expect(result.updatedLines[1].words[2].start_time).toBe(7.5);
    });

    it('shifts subsequent untapped words to preserve monotonic non-overlapping order', () => {
      const lines = createSampleLines();
      // Tap word 0 at 3.0s (later than words 1 and 2 original times)
      const result = applyWordTap(lines, 0, 0, 3.0, 20);
      const words = result.updatedLines[0].words;

      expect(words[0].start_time).toBe(3.0);
      expect(words[1].start_time).toBeGreaterThanOrEqual(words[0].end_time);
      expect(words[2].start_time).toBeGreaterThanOrEqual(words[1].end_time);
    });

    it('handles backward seeking without retroactively moving preceding word start_time or inverting earlier words', () => {
      const lines = createSampleLines();
      // Word 0 is at 4.0 -> 5.0, Word 1 is at 5.0 -> 6.0
      lines[0].words[0].start_time = 4.0;
      lines[0].words[0].end_time = 5.0;
      lines[0].words[1].start_time = 5.0;
      lines[0].words[1].end_time = 6.0;

      // User seeks backward to 2.0s and taps Word 2
      const result = applyWordTap(lines, 0, 2, 2.0, 20);
      const words = result.updatedLines[0].words;

      // Word 0 and Word 1 start_times must remain intact (not moved to 2.0s)
      expect(words[0].start_time).toBe(4.0);
      expect(words[1].start_time).toBe(5.0);
      // Word 2 cannot start before Word 1's start_time
      expect(words[2].start_time).toBeGreaterThanOrEqual(words[1].start_time);
      expect(words[1].end_time).toBeLessThanOrEqual(words[2].start_time);
      // Parent line bounds remain monotonic and non-negative
      expect(result.updatedLines[0].start_time).toBe(4.0);
      expect(result.updatedLines[0].end_time).toBeGreaterThan(result.updatedLines[0].start_time);
    });

    it('handles cross-line backward seeking without corrupting previous line bounds', () => {
      const lines = createSampleLines();
      lines[0].start_time = 4.0;
      lines[0].end_time = 6.0;
      lines[0].words[0].start_time = 4.0;
      lines[0].words[0].end_time = 4.8;
      lines[0].words[1].start_time = 4.8;
      lines[0].words[1].end_time = 5.5;
      lines[0].words[2].start_time = 5.5;
      lines[0].words[2].end_time = 6.0;

      // User seeks backward to 2.0s and taps Line 1, Word 0
      const result = applyWordTap(lines, 1, 0, 2.0, 20);

      // Previous line start_time must NOT be moved backwards to 2.0s
      expect(result.updatedLines[0].start_time).toBe(4.0);
      // Current line start_time must be bounded by previous line
      expect(result.updatedLines[1].start_time).toBeGreaterThanOrEqual(
        result.updatedLines[0].words[2].start_time
      );
      expect(result.updatedLines[0].end_time).toBeLessThanOrEqual(
        result.updatedLines[1].start_time
      );
    });

    it('handles cross-line backward seeking across intermediate lines with empty words', () => {
      const lines: LyricLine[] = [
        {
          id: 1,
          text: 'First line',
          start_time: 4.0,
          end_time: 6.0,
          words: [
            { word: 'First', start_time: 4.0, end_time: 5.0 },
            { word: 'line', start_time: 5.0, end_time: 6.0 },
          ],
        },
        {
          id: 2,
          text: '',
          start_time: 6.0,
          end_time: 7.0,
          words: [],
        },
        {
          id: 3,
          text: 'Third line',
          start_time: 7.0,
          end_time: 9.0,
          words: [
            { word: 'Third', start_time: 7.0, end_time: 8.0 },
            { word: 'line', start_time: 8.0, end_time: 9.0 },
          ],
        },
      ];

      // Seeks back to 2.0s and taps Line 2 (third line) Word 0
      const result = applyWordTap(lines, 2, 0, 2.0, 20);

      // Line 0 bounds and words must not be inverted
      expect(result.updatedLines[0].start_time).toBe(4.0);
      expect(result.updatedLines[2].start_time).toBeGreaterThanOrEqual(
        result.updatedLines[0].words[1].start_time
      );
      expect(result.updatedLines[0].end_time).toBeLessThanOrEqual(
        result.updatedLines[2].start_time
      );
    });
  });

  describe('applyLineTap: Line-Level Tap-to-Sync', () => {
    it('sets current line start_time and caps previous line end_time', () => {
      const lines = createSampleLines();
      lines[0].end_time = 4.5;

      const result = applyLineTap(lines, 1, 4.0, 20);

      expect(result.updatedLines[0].end_time).toBe(4.0);
      expect(result.updatedLines[1].start_time).toBe(4.0);
      expect(result.isComplete).toBe(true);
    });

    it('handles backward seeking in line tap without collapsing previous line start_time', () => {
      const lines = createSampleLines();
      lines[0].start_time = 5.0;
      lines[0].end_time = 8.0;

      // User seeks back to 2.0s and taps Line 1
      const result = applyLineTap(lines, 1, 2.0, 20);

      // Previous line start_time must not be moved back to 2.0s
      expect(result.updatedLines[0].start_time).toBe(5.0);
      expect(result.updatedLines[1].start_time).toBeGreaterThanOrEqual(
        result.updatedLines[0].start_time
      );
      expect(result.updatedLines[0].end_time).toBeLessThanOrEqual(
        result.updatedLines[1].start_time
      );
      // All words in previous line must be capped to effectiveTap
      for (const w of result.updatedLines[0].words) {
        expect(w.end_time).toBeLessThanOrEqual(result.updatedLines[0].end_time);
      }
    });
  });

  describe('Adversarial & Boundary Stress Scenarios', () => {
    it('handles out-of-bounds targetLineIndex and targetWordIndex gracefully', () => {
      const lines = createSampleLines();

      // targetLineIndex >= lines.length
      const oobLine = applyWordTap(lines, 999, 0, 10.0, 20);
      expect(oobLine.isComplete).toBe(true);
      expect(oobLine.nextLineIndex).toBe(0);

      // targetWordIndex < 0 clamps to word 0
      const negativeWord = applyWordTap(lines, 0, -5, 2.0, 20);
      expect(negativeWord.updatedLines[0].words[0].start_time).toBe(2.0);

      // targetWordIndex >= words.length clamps to last word
      const oobWord = applyWordTap(lines, 0, 999, 3.5, 20);
      expect(oobWord.updatedLines[0].words[2].start_time).toBe(3.5);
      expect(oobWord.nextLineIndex).toBe(1);
    });

    it('populates and synchronizes CJK words when words array is initially empty', () => {
      const lines: LyricLine[] = [
        {
          id: 1,
          text: '你好世界',
          start_time: 1.0,
          end_time: 5.0,
          words: [],
        },
      ];

      const result = applyWordTap(lines, 0, 0, 2.0, 20);
      expect(result.updatedLines[0].words.length).toBeGreaterThan(0);
      expect(result.updatedLines[0].words[0].start_time).toBe(2.0);
      expect(result.updatedLines[0].start_time).toBe(2.0);
    });

    it('handles rapid consecutive taps with <10ms intervals preserving strict non-decreasing order', () => {
      let currentLines = createSampleLines();
      const rapidTimestamps = [1.0, 1.005, 1.01, 1.015];

      for (let i = 0; i < 3; i++) {
        const result = applyWordTap(currentLines, 0, i, rapidTimestamps[i], 20);
        currentLines = result.updatedLines;
      }

      const words = currentLines[0].words;
      expect(words[0].start_time).toBe(1.0);
      expect(words[1].start_time).toBeGreaterThanOrEqual(words[0].start_time);
      expect(words[0].end_time).toBeLessThanOrEqual(words[1].start_time);
      expect(words[2].start_time).toBeGreaterThanOrEqual(words[1].start_time);
      expect(words[1].end_time).toBeLessThanOrEqual(words[2].start_time);
      expect(currentLines[0].start_time).toBe(1.0);
      expect(currentLines[0].end_time).toBeGreaterThanOrEqual(currentLines[0].start_time);
    });

    it('handles negative, NaN, and infinite timestamps safely via sanitizeTimestamp', () => {
      const lines = createSampleLines();

      const negResult = applyWordTap(lines, 0, 0, -10.0, 20);
      expect(negResult.updatedLines[0].words[0].start_time).toBe(0.0);

      const nanResult = applyWordTap(lines, 0, 0, NaN, 20);
      expect(nanResult.updatedLines[0].words[0].start_time).toBe(0.0);

      const infResult = applyWordTap(lines, 0, 0, Infinity, 20);
      expect(infResult.updatedLines[0].words[0].start_time).toBe(0.0);
    });
  });
});
