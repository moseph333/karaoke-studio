import { describe, it, expect } from 'vitest';
import { recalculateWordTimings } from '../utils/lyrics';
import { recalculateWordTimings as reexportedRecalculate } from '../components/LyricTimelineEditor';
import { WordTiming } from '../types';

/**
 * Universal invariant checker for recalculateWordTimings results.
 */
function assertWordTimingInvariants(
  tokens: WordTiming[],
  expectedCount?: number,
  options?: {
    expectedStart?: number;
    expectedEnd?: number;
    allowZeroDurationTokens?: boolean;
  }
) {
  if (expectedCount !== undefined) {
    expect(tokens).toHaveLength(expectedCount);
  }

  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // 1. Token string validity
    expect(typeof t.word).toBe('string');
    expect(t.word.length).toBeGreaterThan(0);

    // 2. Finite & non-NaN
    expect(Number.isFinite(t.start_time)).toBe(true);
    expect(Number.isFinite(t.end_time)).toBe(true);
    expect(isNaN(t.start_time)).toBe(false);
    expect(isNaN(t.end_time)).toBe(false);

    // 3. Non-negative
    expect(t.start_time).toBeGreaterThanOrEqual(0);
    expect(t.end_time).toBeGreaterThanOrEqual(0);

    // 4. Within single token: start <= end (or strictly < end if normal)
    if (options?.allowZeroDurationTokens) {
      expect(t.start_time).toBeLessThanOrEqual(t.end_time);
    } else {
      expect(t.start_time).toBeLessThanOrEqual(t.end_time);
    }

    // 5. Contiguous non-overlapping chaining with previous token
    if (i > 0) {
      const prev = tokens[i - 1];
      // Adjacent boundary must match exactly (contiguous)
      expect(t.start_time).toBe(prev.end_time);
      // Strictly non-overlapping
      expect(prev.end_time).toBeLessThanOrEqual(t.start_time);
    }
  }

  // Boundary anchoring
  if (options?.expectedStart !== undefined) {
    expect(tokens[0].start_time).toBe(options.expectedStart);
  }
  if (options?.expectedEnd !== undefined) {
    expect(tokens[tokens.length - 1].end_time).toBe(options.expectedEnd);
  }
}

describe('M3 Challenger 1: Adversarial Stress Testing of recalculateWordTimings', () => {
  it('verifies LyricTimelineEditor re-exports recalculateWordTimings correctly', () => {
    expect(typeof reexportedRecalculate).toBe('function');
    expect(reexportedRecalculate).toBe(recalculateWordTimings);
  });

  describe('Adversarial Text Inputs', () => {
    it('handles empty and whitespace-only text variations', () => {
      const emptyInputs = [
        '',
        ' ',
        '   ',
        '\t',
        '\n',
        '\r\n',
        ' \t \n \r \t ',
        '\u00A0', // non-breaking space (Zs)
        '\uFEFF', // zero-width no-break space / BOM
      ];

      for (const input of emptyInputs) {
        const res = recalculateWordTimings(input, 2.0, 5.0);
        expect(res).toEqual([]);
      }

      // Zero-width space U+200B is category Cf (non-whitespace in ECMAScript)
      // recalculateWordTimings treats it as a non-whitespace character and returns valid tokens
      const zwsRes = recalculateWordTimings('\u200B', 2.0, 5.0);
      assertWordTimingInvariants(zwsRes, 1, {
        expectedStart: 2.0,
        expectedEnd: 5.0,
      });
    });

    it('handles non-string type corruptions gracefully (runtime defense)', () => {
      const corruptInputs = [
        null as unknown as string,
        undefined as unknown as string,
        12345 as unknown as string,
        {} as unknown as string,
        [] as unknown as string,
        true as unknown as string,
      ];

      for (const input of corruptInputs) {
        const res = recalculateWordTimings(input, 2.0, 5.0);
        expect(res).toEqual([]);
      }
    });

    it('handles single characters across diverse scripts and symbols', () => {
      const singleCharInputs = [
        'A',
        'z',
        '9',
        '我',
        'あ',
        'カ',
        '한',
        '🎵',
        '🎤',
        '!',
        '?',
        '.',
        '-',
        '#',
      ];

      for (const char of singleCharInputs) {
        const res = recalculateWordTimings(char, 3.5, 7.2);
        assertWordTimingInvariants(res, 1, {
          expectedStart: 3.5,
          expectedEnd: 7.2,
        });
        expect(res[0].word).toBe(char);
      }
    });

    it('stress tests massive long text with 100+ and 250+ words', () => {
      const generateWords = (count: number) =>
        Array.from({ length: count }, (_, i) => `word_${i + 1}`).join(' ');

      // 100 words across 50 seconds
      const text100 = generateWords(100);
      const res100 = recalculateWordTimings(text100, 10.0, 60.0);
      assertWordTimingInvariants(res100, 100, {
        expectedStart: 10.0,
        expectedEnd: 60.0,
      });

      // 250 words across 100 seconds
      const text250 = generateWords(250);
      const res250 = recalculateWordTimings(text250, 0.0, 100.0);
      assertWordTimingInvariants(res250, 250, {
        expectedStart: 0.0,
        expectedEnd: 100.0,
      });
    });

    it('handles a massive single unspaced token of 1000 characters without crashing', () => {
      const massiveWord = 'A'.repeat(1000);
      const res = recalculateWordTimings(massiveWord, 5.0, 15.0);
      assertWordTimingInvariants(res, 1, {
        expectedStart: 5.0,
        expectedEnd: 15.0,
      });
      expect(res[0].word).toBe(massiveWord);
    });

    it('handles repeated words and irregular whitespace sequences', () => {
      const repeated = 'na   na \t\t  na \n na     na na!';
      const res = recalculateWordTimings(repeated, 1.0, 6.0);
      assertWordTimingInvariants(res, 6, {
        expectedStart: 1.0,
        expectedEnd: 6.0,
      });
      expect(res.map((w) => w.word)).toEqual(['na', 'na', 'na', 'na', 'na', 'na!']);
    });

    it('handles pure punctuation and symbol-heavy strings', () => {
      const symbols = '... --- !? *** ~~~ @@@ $$$ %%% ^^^ &&&';
      const res = recalculateWordTimings(symbols, 2.0, 8.0);
      assertWordTimingInvariants(res, 10, {
        expectedStart: 2.0,
        expectedEnd: 8.0,
      });
    });

    it('handles emojis and emoji sequences', () => {
      const emojiText = '🎤 Sing 🎶 together 🌟 tonight ✨';
      const res = recalculateWordTimings(emojiText, 0.0, 5.0);
      assertWordTimingInvariants(res, 7, {
        expectedStart: 0.0,
        expectedEnd: 5.0,
      });
    });

    it('handles CJK without spaces: Chinese poem segmentation and contiguous timing', () => {
      const poem = '床前明月光疑是地上霜举头望明月低头思故乡'; // 20 characters
      const res = recalculateWordTimings(poem, 10.0, 20.0);
      assertWordTimingInvariants(res, 20, {
        expectedStart: 10.0,
        expectedEnd: 20.0,
      });
      expect(res.map((w) => w.word).join('')).toBe(poem);
    });

    it('handles Japanese mixed script (Kanji, Hiragana, Katakana, Choonpu)', () => {
      const jText = 'スーパーロボット大戦の勝利';
      const res = recalculateWordTimings(jText, 2.0, 7.0);
      // 'スーパー' should preserve prolonged marks
      assertWordTimingInvariants(res, undefined, {
        expectedStart: 2.0,
        expectedEnd: 7.0,
      });
      expect(res.map((w) => w.word).join('')).toBe(jText);
    });

    it('handles Korean Hangul with and without spaces', () => {
      const kText = '동해물과 백두산이 마르고 닳도록';
      const res = recalculateWordTimings(kText, 1.0, 6.0);
      // Each Hangul character is segmented as a syllable
      assertWordTimingInvariants(res, undefined, {
        expectedStart: 1.0,
        expectedEnd: 6.0,
      });
      expect(res.map((w) => w.word).join('')).toBe(kText.replace(/\s+/g, ''));
    });

    it('handles mixed Latin, CJK, digits, and punctuation', () => {
      const mixed = 'Track 01: 桜花 (Cherry) - 2026!';
      const res = recalculateWordTimings(mixed, 0.0, 10.0);
      assertWordTimingInvariants(res, undefined, {
        expectedStart: 0.0,
        expectedEnd: 10.0,
      });
    });
  });

  describe('Adversarial Timestamp Extremes & Edge Cases', () => {
    it('defends against inverted timestamps (startTime > endTime)', () => {
      const res = recalculateWordTimings('One two three four', 15.0, 5.0);
      assertWordTimingInvariants(res, 4);
      // Must start at safeStart (15.0) and end at a strictly greater timestamp
      expect(res[0].start_time).toBe(15.0);
      expect(res[3].end_time).toBeGreaterThan(15.0);
    });

    it('defends against equal timestamps (startTime === endTime, zero duration)', () => {
      const res = recalculateWordTimings('Quick brown fox', 8.0, 8.0);
      assertWordTimingInvariants(res, 3);
      expect(res[0].start_time).toBe(8.0);
      expect(res[2].end_time).toBeGreaterThan(8.0);
    });

    it('defends against negative start times (clamps to 0.0)', () => {
      const res = recalculateWordTimings('Negative start time', -15.5, 5.0);
      assertWordTimingInvariants(res, 3, {
        expectedStart: 0.0,
        expectedEnd: 5.0,
      });
    });

    it('defends against both negative start and negative end times', () => {
      const res = recalculateWordTimings('Both negative times', -20.0, -5.0);
      assertWordTimingInvariants(res, 3);
      expect(res[0].start_time).toBe(0.0);
      expect(res[2].end_time).toBeGreaterThan(0.0);
    });

    it('defends against non-finite values (NaN, +Infinity, -Infinity)', () => {
      const testCases = [
        { start: NaN, end: 10.0 },
        { start: 5.0, end: NaN },
        { start: NaN, end: NaN },
        { start: Infinity, end: 10.0 },
        { start: 0.0, end: Infinity },
        { start: Infinity, end: Infinity },
        { start: -Infinity, end: 10.0 },
        { start: -Infinity, end: -Infinity },
        { start: -Infinity, end: Infinity },
      ];

      for (const tc of testCases) {
        const res = recalculateWordTimings('Non-finite timestamp stress test', tc.start, tc.end);
        assertWordTimingInvariants(res, 4);
        for (const w of res) {
          expect(Number.isFinite(w.start_time)).toBe(true);
          expect(Number.isFinite(w.end_time)).toBe(true);
          expect(isNaN(w.start_time)).toBe(false);
          expect(isNaN(w.end_time)).toBe(false);
        }
      }
    });

    it('handles microsecond / extremely compressed durations without collapse', () => {
      // 5 words in 0.0001 seconds
      const res = recalculateWordTimings('Rapid fire supersonic speech here', 10.0, 10.0001);
      assertWordTimingInvariants(res, 5);
      expect(res[0].start_time).toBe(10.0);
      expect(res[4].end_time).toBeGreaterThan(10.0);
      for (let i = 0; i < res.length; i++) {
        expect(res[i].end_time).toBeGreaterThan(res[i].start_time);
        if (i > 0) {
          expect(res[i].start_time).toBe(res[i - 1].end_time);
        }
      }
    });

    it('handles huge float timestamps near day boundary (86400s)', () => {
      const res = recalculateWordTimings('End of the 24 hour day', 86390.0, 86400.0);
      assertWordTimingInvariants(res, 6, {
        expectedStart: 86390.0,
        expectedEnd: 86400.0,
      });
    });

    it('clamps timestamps exceeding 86400s ceiling gracefully', () => {
      const res = recalculateWordTimings('Beyond ceiling timestamp', 999999.0, 1000000.0);
      assertWordTimingInvariants(res, 3);
      for (const w of res) {
        expect(Number.isFinite(w.start_time)).toBe(true);
        expect(Number.isFinite(w.end_time)).toBe(true);
      }
    });
  });

  describe('Property-Based / Fuzz Stress Testing (1,000 Iterations)', () => {
    it('executes 1,000 randomized permutations of text and timestamp boundaries', () => {
      const sampleTokens = [
        'apple',
        'banana',
        'cherry',
        'date',
        'elderberry',
        '青',
        '花',
        '瓷',
        'さくら',
        'ありがとう',
        '하늘',
        '사랑',
        '123',
        '!?',
        '...',
        '🎵',
        '✨',
        "don't",
        'rock-and-roll',
      ];

      for (let run = 0; run < 1000; run++) {
        // Pick random token count from 1 to 30
        const tokenCount = Math.floor(Math.random() * 30) + 1;
        const selectedTokens: string[] = [];
        for (let j = 0; j < tokenCount; j++) {
          selectedTokens.push(sampleTokens[Math.floor(Math.random() * sampleTokens.length)]);
        }
        const text = selectedTokens.join(' ');

        // Generate timestamps with adversarial variety
        const mode = run % 8;
        let start: number;
        let end: number;

        switch (mode) {
          case 0: // Normal valid window
            start = Math.random() * 500;
            end = start + Math.random() * 20 + 0.5;
            break;
          case 1: // Inverted window
            start = Math.random() * 500 + 10;
            end = start - Math.random() * 10;
            break;
          case 2: // Zero duration
            start = Math.random() * 500;
            end = start;
            break;
          case 3: // Negative start
            start = -Math.random() * 50;
            end = Math.random() * 20;
            break;
          case 4: // Micro-duration
            start = Math.random() * 100;
            end = start + Math.random() * 0.001;
            break;
          case 5: // NaNs
            start = NaN;
            end = Math.random() * 50;
            break;
          case 6: // Infinities
            start = Math.random() * 50;
            end = Infinity;
            break;
          case 7: // High values
            start = 86395.0 + Math.random() * 10;
            end = 86400.0 + Math.random() * 50;
            break;
          default:
            start = 0;
            end = 10;
        }

        const result = recalculateWordTimings(text, start, end);
        assertWordTimingInvariants(result);
      }
    });
  });
});
