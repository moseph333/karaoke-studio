import type { ProjectState } from '../../types';
import { json, mockStudioFetch } from './qualityFixtures';

/** A finished song with two lines, one for each singer, and chords. */
export const GUIDE_SONG: ProjectState = {
  id: 'guide-song',
  title: 'Pointing Song',
  artist: 'The Ushers',
  status: 'ready',
  progress: 100,
  duration: 64,
  lines: [
    {
      id: 1,
      text: 'Look over here',
      start_time: 2,
      end_time: 6,
      words: [
        { word: 'Look', start_time: 2, end_time: 3 },
        { word: 'over', start_time: 3, end_time: 4.5 },
        { word: 'here', start_time: 4.5, end_time: 6 },
      ],
    },
    {
      id: 2,
      text: 'Then over there',
      start_time: 7,
      end_time: 11,
      singer: 'singer2',
      words: [
        { word: 'Then', start_time: 7, end_time: 8 },
        { word: 'over', start_time: 8, end_time: 9.5 },
        { word: 'there', start_time: 9.5, end_time: 11 },
      ],
    },
  ],
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/guide_master.wav',
  instrumental_url: '/static/stems/guide/no_vocals.wav',
  vocals_url: '/static/stems/guide/vocals.wav',
  chords: [
    { start: 2, end: 6, chord: 'C' },
    { start: 7, end: 11, chord: 'Am' },
  ],
};

/** Mocks the server for a studio that has `GUIDE_SONG` (open it with `?project=guide-song`)
 *  and an empty library. */
export function mockGuideFetch(song: ProjectState = GUIDE_SONG) {
  return mockStudioFetch((url) => {
    if (url.includes('/api/auth/status')) {
      return json({ auth_required: false, authenticated: true });
    }
    if (url.includes(`/api/project/${song.id}`)) return json(song);
    if (url.includes('/api/projects')) return json({});
    return undefined;
  });
}
