/**
 * The song-request helpers: what is read from the server's answers, how typed words are
 * tidied, and the one line that says who asked for a song.
 */

import { describe, expect, it } from 'vitest';
import {
  SONG_REQUEST_MAX,
  cleanSongRequest,
  parseSongRequests,
  songRequestNote,
  type SongRequest,
} from '../../utils/songRequests';

const request = (over: Partial<SongRequest> = {}): SongRequest => ({
  id: 'a1',
  song: 'Halo',
  singers: [],
  show: '',
  count: 1,
  requested_at: 0,
  ...over,
});

describe('reading the request list', () => {
  it('takes the requests of a well-formed answer', () => {
    const body = { requests: [request({ singers: ['Ana'], count: 2, show: 'Friday' })] };

    expect(parseSongRequests(body)).toEqual(body.requests);
  });

  it('is null for an answer that is not a request list', () => {
    for (const body of [null, undefined, {}, [], 'requests', { requests: 'none' }, { demo: {} }]) {
      expect(parseSongRequests(body)).toBeNull();
    }
  });

  it('leaves out entries that are not requests and fills in what one lacks', () => {
    const body = {
      requests: [
        { id: 'a1', song: 'Halo', singers: ['Ana', 7, ''], count: 0 },
        { id: '', song: 'No id' },
        { id: 'b2', song: '  ' },
        'Jolene',
        null,
      ],
    };

    expect(parseSongRequests(body)).toEqual([request({ singers: ['Ana'] })]);
  });
});

describe('tidying the typed words', () => {
  it('keeps one line with single spaces', () => {
    expect(cleanSongRequest('  Total \n Eclipse\tof the   Heart ')).toBe(
      'Total Eclipse of the Heart'
    );
  });

  it('cuts very long words to the length the server keeps', () => {
    expect(cleanSongRequest('x'.repeat(400))).toHaveLength(SONG_REQUEST_MAX);
  });

  it('is empty for nothing but spaces', () => {
    expect(cleanSongRequest(' \n ')).toBe('');
  });
});

describe('who asked for a song', () => {
  it('says nothing when nothing is known', () => {
    expect(songRequestNote(request())).toBe('');
  });

  it('names one singer, two, and more', () => {
    expect(songRequestNote(request({ singers: ['Ana'] }))).toBe('Asked for by Ana');
    expect(songRequestNote(request({ singers: ['Ana', 'Bo'] }))).toBe('Asked for by Ana and Bo');
    expect(songRequestNote(request({ singers: ['Ana', 'Bo', 'Cy'] }))).toBe(
      'Asked for by Ana, Bo and Cy'
    );
  });

  it('adds how often and at which night', () => {
    expect(songRequestNote(request({ singers: ['Ana'], count: 3, show: 'Friday' }))).toBe(
      'Asked for by Ana · 3 times · Friday'
    );
    expect(songRequestNote(request({ count: 2 }))).toBe('2 times');
  });
});
