/**
 * A song's parts for practice: split where the singing pauses, with long runs cut at their
 * longest breath, and stretches picked line by line.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PART_LINES,
  firstWords,
  partAt,
  practiceParts,
  stretchOf,
} from '../../utils/practiceSections';
import { PRACTICE_LINES } from '../helpers/practiceFixtures';

const line = (start: number, end: number, text = 'la la') => ({
  id: start,
  text,
  start_time: start,
  end_time: end,
  words: [],
});

describe('practiceParts', () => {
  it('starts a part after every pause the stage counts in for', () => {
    const parts = practiceParts([line(1, 3), line(3.5, 6), line(12, 14), line(14.5, 16)]);
    expect(parts.map((part) => [part.firstLine, part.lastLine])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(parts[1]).toMatchObject({ number: 2, start: 12, end: 16, lineCount: 2 });
  });

  it('cuts a long run at its longest breath', () => {
    const parts = practiceParts(PRACTICE_LINES);
    expect(parts.map((part) => [part.firstLine, part.lastLine])).toEqual([
      [0, 2],
      [3, 7],
      [8, 12],
    ]);
    expect(parts.map((part) => part.number)).toEqual([1, 2, 3]);
  });

  it('never leaves a part longer than the limit, even with no pause to cut at', () => {
    const lines = Array.from({ length: 30 }, (_, n) => line(n * 2, n * 2 + 2));
    const parts = practiceParts(lines);
    expect(Math.max(...parts.map((part) => part.lineCount))).toBeLessThanOrEqual(MAX_PART_LINES);
    expect(Math.min(...parts.map((part) => part.lineCount))).toBeGreaterThanOrEqual(2);
    expect(parts.reduce((sum, part) => sum + part.lineCount, 0)).toBe(30);
    // In order, with nothing skipped or shared
    parts.slice(1).forEach((part, n) => expect(part.firstLine).toBe(parts[n].lastLine + 1));
  });

  it('names a part by its first words', () => {
    const parts = practiceParts([
      line(1, 3, 'Hello darkness my old friend I have come'),
      line(10, 12, 'Short one'),
      line(20, 22, ''),
    ]);
    expect(parts.map((part) => part.name)).toEqual([
      'Hello darkness my old friend…',
      'Short one',
      'Line 3',
    ]);
  });

  it('gives no parts for a song without lines', () => {
    expect(practiceParts([])).toEqual([]);
    expect(practiceParts(null)).toEqual([]);
  });
});

describe('firstWords', () => {
  it('keeps a row short', () => {
    expect(firstWords('Supercalifragilisticexpialidocious and then some more', 'x')).toBe(
      'Supercalifragilisticexpialidocio…'
    );
    expect(firstWords('   ', 'No words')).toBe('No words');
  });
});

describe('partAt', () => {
  const parts = practiceParts(PRACTICE_LINES);

  it('is the part being sung', () => {
    expect(partAt(parts, 14)?.number).toBe(1);
    expect(partAt(parts, 30)?.number).toBe(2);
  });

  it('is the next part while nothing is sung', () => {
    expect(partAt(parts, 0)?.number).toBe(1);
    expect(partAt(parts, 22)?.number).toBe(2);
  });

  it('is the last part once the singing is over', () => {
    expect(partAt(parts, 63)?.number).toBe(3);
    expect(partAt([], 5)).toBeNull();
  });
});

describe('stretchOf', () => {
  it('runs from the first line picked to the last, in either order', () => {
    expect(stretchOf(PRACTICE_LINES, 4, 6)).toEqual({
      firstLine: 4,
      lastLine: 6,
      start: 29,
      end: 37.5,
    });
    expect(stretchOf(PRACTICE_LINES, 6, 4)).toEqual(stretchOf(PRACTICE_LINES, 4, 6));
  });

  it('can be a single line, and is nothing outside the song', () => {
    expect(stretchOf(PRACTICE_LINES, 2, 2)).toMatchObject({ start: 16, end: 18.5 });
    expect(stretchOf(PRACTICE_LINES, 40, 50)).toBeNull();
  });
});
