/**
 * The place kept for a show's song that may be cut off: what is stored, what is read back,
 * and when it is worth picking a song up rather than starting it again.
 */

import { describe, expect, it } from 'vitest';
import {
  SHOW_RESUME_STORAGE_KEY,
  loadShowResume,
  resumePlace,
  saveShowResume,
} from '../../utils/showResume';

describe('the place kept for the song on stage', () => {
  it('is read back as it was written', () => {
    saveShowResume({ entryId: 'e1', time: 83.2, duration: 200 });

    expect(loadShowResume()).toEqual({ entryId: 'e1', time: 83.2, duration: 200 });
  });

  it('is forgotten when told to', () => {
    saveShowResume({ entryId: 'e1', time: 83, duration: 200 });

    saveShowResume(null);

    expect(loadShowResume()).toBeNull();
    expect(localStorage.getItem(SHOW_RESUME_STORAGE_KEY)).toBeNull();
  });

  it('is nothing when none was kept', () => {
    expect(loadShowResume()).toBeNull();
  });

  it.each([
    ['not json', '{oops'],
    ['another shape', JSON.stringify({ id: 'e1', at: 83 })],
    ['a place that is not a number', JSON.stringify({ entryId: 'e1', time: 'soon', duration: 1 })],
    ['a list', JSON.stringify([1, 2])],
  ])('is nothing when what is stored is %s', (_what, stored) => {
    localStorage.setItem(SHOW_RESUME_STORAGE_KEY, stored);

    expect(loadShowResume()).toBeNull();
  });
});

describe('where an entry is picked up', () => {
  const kept = { entryId: 'e1', time: 83, duration: 200 };

  it('is the place kept for it', () => {
    expect(resumePlace(kept, 'e1')).toBe(83);
  });

  it('is nowhere for another entry, or with nothing kept', () => {
    expect(resumePlace(kept, 'e2')).toBeNull();
    expect(resumePlace(null, 'e1')).toBeNull();
  });

  it('is nowhere in the first few seconds: the song just starts', () => {
    expect(resumePlace({ ...kept, time: 3 }, 'e1')).toBeNull();
  });

  it('is nowhere in the last few seconds: the song was over', () => {
    expect(resumePlace({ ...kept, time: 198 }, 'e1')).toBeNull();
  });

  it('does not need the song’s length', () => {
    expect(resumePlace({ ...kept, duration: 0 }, 'e1')).toBe(83);
    expect(resumePlace({ ...kept, duration: Number.NaN }, 'e1')).toBe(83);
  });
});
