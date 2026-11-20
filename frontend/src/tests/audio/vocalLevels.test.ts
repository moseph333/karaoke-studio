import { describe, expect, it } from 'vitest';
import type { LyricLine, SingerRole } from '../../types';
import {
  cleanVocalLevels,
  divideBySinger,
  divideByVoice,
  hasVocalLevels,
  singerPartsInLines,
  undivide,
  vocalLevelsKey,
} from '../../utils/vocalLevels';

const line = (start: number, end: number, singer?: string): LyricLine => ({
  id: start,
  text: 'la',
  start_time: start,
  end_time: end,
  words: [],
  singer: singer as SingerRole | undefined,
});

describe('vocal levels', () => {
  it('are stored within 0-1 to two decimals, known keys only', () => {
    expect(
      cleanVocalLevels({ backing: 1.7, singer1: -1, both: 0.333, by: 'lines', extra: 1 } as never)
    ).toEqual({ backing: 1, singer1: 0, both: 0.33, by: 'lines' });
    expect(cleanVocalLevels({ backing: Number.NaN, by: 'choir' } as never)).toEqual({});
    expect(cleanVocalLevels({ by: 'voices', male: 0, female: 2 })).toEqual({
      by: 'voices',
      male: 0,
      female: 1,
    });
    expect(cleanVocalLevels(null)).toEqual({});
    expect(cleanVocalLevels(undefined)).toEqual({});
  });

  it('compare by what they say, not by object identity or key order', () => {
    expect(vocalLevelsKey(null)).toBe('');
    expect(vocalLevelsKey({})).toBe('');
    expect(vocalLevelsKey({ singer2: 1, backing: 0.5, by: 'lines' })).toBe(
      vocalLevelsKey({ by: 'lines', backing: 0.5, singer2: 1 })
    );
    expect(vocalLevelsKey({ backing: 0.5 })).toBe(vocalLevelsKey({ backing: 0.5004 }));
    expect(vocalLevelsKey({ backing: 0.5 })).not.toBe(vocalLevelsKey({ backing: 0.55 }));
    // A level of zero is a choice (removed), not the same as no level
    expect(vocalLevelsKey({ backing: 0 })).not.toBe('');
    expect(hasVocalLevels({ backing: 0 })).toBe(true);
    expect(hasVocalLevels({})).toBe(false);
  });
});

describe('the singer parts in a song', () => {
  it('are the roles its lines carry, in display order', () => {
    expect(singerPartsInLines([])).toEqual([]);
    expect(singerPartsInLines([line(1, 2), line(3, 4)])).toEqual(['singer1']);
    expect(singerPartsInLines([line(3, 4, 'singer2'), line(1, 2)])).toEqual(['singer1', 'singer2']);
    expect(singerPartsInLines([line(1, 2, 'both'), line(3, 4, 'singer2'), line(5, 6)])).toEqual([
      'singer1',
      'singer2',
      'both',
    ]);
  });

  it('read the labels lyrics data uses for a part', () => {
    expect(singerPartsInLines([line(1, 2, 'lead'), line(3, 4, 'partner')])).toEqual([
      'singer1',
      'singer2',
    ]);
    expect(singerPartsInLines([line(1, 2), line(3, 4, 'duet')])).toEqual(['singer1', 'both']);
  });

  it('count overlapping lines of two singers as sung together, as the mix does', () => {
    expect(singerPartsInLines([line(1, 4), line(3, 6, 'singer2')])).toEqual([
      'singer1',
      'singer2',
      'both',
    ]);
    // Touching is not overlapping, and neither is one singer overlapping themselves
    expect(singerPartsInLines([line(1, 3), line(3, 6, 'singer2')])).toEqual(['singer1', 'singer2']);
    expect(singerPartsInLines([line(1, 4, 'singer2'), line(3, 6, 'singer2'), line(8, 9)])).toEqual([
      'singer1',
      'singer2',
    ]);
    // A line with no length sings nothing
    expect(singerPartsInLines([line(1, 2), line(5, 5, 'singer2')])).toEqual(['singer1']);
  });
});

describe('dividing the lead by singer', () => {
  it('starts every part at the guide level, so the switch changes nothing to hear', () => {
    expect(divideBySinger({}, ['singer1', 'singer2'], 0.3)).toEqual({
      by: 'lines',
      singer1: 0.3,
      singer2: 0.3,
    });
  });

  it('keeps levels the parts already have, and the backing level', () => {
    expect(divideBySinger({ backing: 1, singer2: 0.8 }, ['singer1', 'singer2', 'both'], 0)).toEqual(
      { backing: 1, by: 'lines', singer1: 0, singer2: 0.8, both: 0 }
    );
  });

  it('divides by voice the same way, and switches between the two ways', () => {
    expect(divideByVoice({ backing: 1 }, 0.25)).toEqual({
      backing: 1,
      by: 'voices',
      male: 0.25,
      female: 0.25,
    });
    const bySinger = { by: 'lines' as const, singer1: 0, singer2: 1 };
    const byVoice = divideByVoice({ ...bySinger, female: 0.9 }, 0.1);
    expect(byVoice).toEqual({ by: 'voices', singer1: 0, singer2: 1, male: 0.1, female: 0.9 });
    expect(vocalLevelsKey(byVoice)).not.toBe(vocalLevelsKey(bySinger));
    expect(undivide(byVoice)).toEqual({ singer1: 0, singer2: 1, male: 0.1, female: 0.9 });
  });

  it('goes back to one level without forgetting the singers', () => {
    expect(undivide({ backing: 1, by: 'lines', singer1: 0, singer2: 1 })).toEqual({
      backing: 1,
      singer1: 0,
      singer2: 1,
    });
  });
});
