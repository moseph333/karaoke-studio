import type { LyricLine, ProjectState } from '../../types';
import { mockGuideFetch } from './guideFixtures';

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

export const mockPracticeFetch = (song: ProjectState = PRACTICE_SONG) => mockGuideFetch(song);
