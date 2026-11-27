import type { LyricLine, MelodyData, ProjectState } from '../../types';
import { json, mockStudioFetch } from './qualityFixtures';

const WORDS = [
  'Morning comes in slowly',
  'Coffee on the stove',
  'Nothing left to say now',
  'Carry me back home',
  'Over the long river',
  'Under the tall trees',
  'Past the empty station',
  'Where we used to be',
  'Hold the last note longer',
  'Let the room go quiet',
  'Count me in again',
  'One more time around',
  'Then we close the door',
];

/** Thirteen lines of 2.5 s: three, a six-second pause, then ten with one longer breath in the
 *  middle. Practice splits them into lines 1-3, 4-8 and 9-13. */
const STARTS = [10, 13, 16, 26, 29, 32, 35, 38, 43, 46, 49, 52, 55];

export const PRACTICE_LINES: LyricLine[] = STARTS.map((start, index) => {
  const words = WORDS[index].split(' ');
  const step = 2.5 / words.length;
  return {
    id: index + 1,
    text: WORDS[index],
    start_time: start,
    end_time: start + 2.5,
    words: words.map((word, n) => ({
      word,
      start_time: start + n * step,
      end_time: start + (n + 1) * step,
    })),
  };
});

/** A finished song long enough to have parts. Open it with `?project=practice-song`. */
export const PRACTICE_SONG: ProjectState = {
  id: 'practice-song',
  title: 'Rehearsal Song',
  artist: 'The Understudies',
  status: 'ready',
  progress: 100,
  duration: 64,
  lines: PRACTICE_LINES,
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/practice_master.wav',
  instrumental_url: '/static/stems/practice/no_vocals.wav',
  vocals_url: '/static/stems/practice/vocals.wav',
  chords: [{ start: 10, end: 18, chord: 'C' }],
};

/** The song's melody: every line held on A3 (57), with pauses between the lines. */
export const PRACTICE_MELODY: MelodyData = {
  project_id: 'practice-song',
  version: 1,
  source: 'vocals',
  detected: true,
  start: 0.064,
  hop: 0.032,
  low: 57,
  high: 57,
  midi: Array.from({ length: 2000 }, (_, frame) => {
    const time = 0.064 + frame * 0.032;
    return STARTS.some((start) => time >= start && time < start + 2.5) ? 57 : null;
  }),
};

/** Where the server says the song's vocals alone are, at the original key. */
export const PRACTICE_VOCAL_URL = '/static/stems/practice/vocals.wav';

/** Mocks the server for a studio that has `song` (open it with `?project=practice-song`):
 *  an empty library, and the vocals alone at whatever key is asked for. */
export function mockPracticeFetch(song: ProjectState = PRACTICE_SONG) {
  return mockStudioFetch((url, init) => {
    if (url.includes('/api/auth/status')) {
      return json({ auth_required: false, authenticated: true });
    }
    if (url.includes(`/api/project/${song.id}/practice-vocal`)) {
      const semitones = JSON.parse(String(init?.body ?? '{}')).semitones ?? 0;
      return json({
        status: 'ok',
        url: semitones === 0 ? PRACTICE_VOCAL_URL : `/static/output/vocal_${semitones}.wav?v=1`,
        semitones,
      });
    }
    if (url.includes(`/api/project/${song.id}/melody`)) return json(PRACTICE_MELODY);
    if (url.includes(`/api/project/${song.id}/mix`)) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return json({
        status: 'ok',
        master_audio_url: `/static/output/mix_${body.semitones}_${body.guide_volume}.wav?v=1`,
      });
    }
    if (url.includes(`/api/project/${song.id}`)) return json(song);
    if (url.includes('/api/projects')) return json({});
    return undefined;
  });
}
