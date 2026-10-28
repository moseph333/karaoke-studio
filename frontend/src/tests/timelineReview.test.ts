import { describe, it, expect } from 'vitest';
import {
  collectLineIssues,
  getLineIssues,
  LOW_CONFIDENCE_THRESHOLD,
} from '../utils/timelineReview';
import { LyricLine } from '../types';

const line = (overrides: Partial<LyricLine> = {}): LyricLine => ({
  id: 1,
  text: 'Hello world',
  start_time: 1,
  end_time: 3,
  words: [
    { word: 'Hello', start_time: 1, end_time: 2 },
    { word: 'world', start_time: 2, end_time: 3 },
  ],
  ...overrides,
});

describe('timeline review checks', () => {
  it('reports nothing for a well-timed line', () => {
    expect(getLineIssues(line(), line({ id: 2, start_time: 3.5, end_time: 5 }))).toEqual([]);
  });

  it('flags low alignment confidence but not confident or unmeasured lines', () => {
    expect(getLineIssues(line({ confidence: 0.42 }))).toEqual([
      { kind: 'low_confidence', message: 'Low sync confidence (42%)' },
    ]);
    expect(getLineIssues(line({ confidence: LOW_CONFIDENCE_THRESHOLD }))).toEqual([]);
    expect(getLineIssues(line({ confidence: undefined }))).toEqual([]);
    expect(getLineIssues(line({ confidence: Number.NaN }))).toEqual([]);
  });

  it('flags lines with text but no word timings, ignoring blank lines', () => {
    expect(getLineIssues(line({ words: [] })).map((i) => i.kind)).toEqual(['no_words']);
    expect(getLineIssues(line({ text: '   ', words: [] }))).toEqual([]);
  });

  it('counts words too short to see', () => {
    const issues = getLineIssues(
      line({
        words: [
          { word: 'a', start_time: 1, end_time: 1 },
          { word: 'b', start_time: 1, end_time: 1.01 },
          { word: 'c', start_time: 1.01, end_time: 2 },
        ],
      })
    );
    expect(issues).toEqual([{ kind: 'short_words', message: '2 words too short to see' }]);
  });

  it('flags overlaps with the next line of the same voice only', () => {
    const next = line({ id: 2, start_time: 2.5, end_time: 4 });
    expect(getLineIssues(line(), next)).toEqual([
      { kind: 'overlap', message: 'Overlaps the next line by 0.50s' },
    ]);
    // Duet partners and unison lines may legitimately overlap
    expect(getLineIssues(line(), { ...next, singer: 'singer2' })).toEqual([]);
    expect(getLineIssues(line({ singer: 'both' }), { ...next, singer: 'both' })).toEqual([]);
    // Tiny overlaps from rounding are tolerated
    expect(getLineIssues(line(), { ...next, start_time: 2.97 })).toEqual([]);
  });

  it('collects issues by line id and omits clean lines', () => {
    const lines = [
      line({ id: 1 }),
      line({ id: 2, start_time: 4, end_time: 6, words: [] }),
      line({ id: 3, start_time: 7, end_time: 9, confidence: 0.2 }),
    ];
    const issues = collectLineIssues(lines);
    expect([...issues.keys()]).toEqual([2, 3]);
    expect(issues.get(3)?.[0].kind).toBe('low_confidence');
  });
});
