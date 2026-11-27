/** The best whole-song practice score of each song, remembered in this browser only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PRACTICE_SCORES_KEY,
  bestSongScore,
  keepSongScore,
} from '../../utils/practiceScoreStorage';

describe('remembered practice scores', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('has none for a song never practised', () => {
    expect(bestSongScore('song')).toBeNull();
  });

  it('keeps a first score', () => {
    expect(keepSongScore('song', 0.6)).toBe(0.6);
    expect(bestSongScore('song')).toBe(0.6);
  });

  it('keeps the better of two, whichever came first', () => {
    keepSongScore('song', 0.6);
    expect(keepSongScore('song', 0.4)).toBe(0.6);
    expect(keepSongScore('song', 0.9)).toBe(0.9);
    expect(bestSongScore('song')).toBe(0.9);
  });

  it('keeps each song’s own', () => {
    keepSongScore('one', 0.3);
    keepSongScore('two', 0.8);
    expect(bestSongScore('one')).toBe(0.3);
    expect(bestSongScore('two')).toBe(0.8);
  });

  it('keeps a score between nothing and full marks', () => {
    expect(keepSongScore('song', 7)).toBe(1);
    expect(keepSongScore('other', -2)).toBe(0);
  });

  it('forgets the songs practised longest ago once there are very many', () => {
    for (let n = 0; n < 205; n += 1) keepSongScore(`song-${n}`, 0.5);
    keepSongScore('song-3', 0.7);
    expect(Object.keys(JSON.parse(localStorage.getItem(PRACTICE_SCORES_KEY)!))).toHaveLength(200);
    expect(bestSongScore('song-0')).toBeNull();
    expect(bestSongScore('song-204')).toBe(0.5);
  });

  it('starts over from storage that is damaged or holds something else', () => {
    for (const damage of ['{not json', '[1,2]', '"text"', '{"song": "high", "other": 4}']) {
      localStorage.setItem(PRACTICE_SCORES_KEY, damage);
      expect(bestSongScore('song')).toBeNull();
      expect(bestSongScore('other')).toBeNull();
    }
    expect(keepSongScore('song', 0.5)).toBe(0.5);
  });

  it('still answers when the browser will not store anything', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(keepSongScore('song', 0.5)).toBe(0.5);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(bestSongScore('song')).toBeNull();
  });
});
