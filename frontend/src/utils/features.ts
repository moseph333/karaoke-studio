/**
 * What you can do: the features a new user is unlikely to find, grouped by what they are
 * for. Help's "What you can do" tab lists them and the command palette finds them by typing;
 * "Show me" points at each one's control (`components/guide`). The README's feature sections
 * say the same at length; this list is kept by hand.
 */

import type { GuideTarget } from './guideStops';

export interface Feature extends GuideTarget {
  id: string;
  group: string;
  title: string;
  /** What it is for, in the list. */
  text: string;
  /** What to do with the control, said while it is pointed at. */
  how: string;
}

const NO_LINES = 'This song has no lyric lines yet. Add its lyrics first.';

export const FEATURES: Feature[] = [
  {
    id: 'upload-audio',
    group: 'Start a song',
    screen: 'home',
    anchors: ['intake-mode'],
    title: 'Use your own audio',
    text: 'Make karaoke from a recording you have, instead of a link.',
    how: 'Choose Local audio file, then pick the recording.',
  },
  {
    id: 'own-lyrics',
    group: 'Start a song',
    screen: 'home',
    anchors: ['advanced'],
    title: 'Bring your own lyrics',
    text: 'Paste the words before the song is made. They are timed to the singing.',
    how: 'Open Advanced options and paste the words into the lyrics box.',
  },
  {
    id: 'intake-quality',
    group: 'Start a song',
    screen: 'home',
    anchors: ['advanced'],
    title: 'Choose how cleanly the vocals come off',
    text: 'A better stem quality takes longer and leaves less of the singer behind.',
    how: 'Open Advanced options and pick a stem quality.',
  },
  {
    id: 'show',
    group: 'Start a song',
    screen: 'home',
    anchors: ['run-show'],
    title: 'Run a karaoke night',
    text: 'A queue of singers and the stage on a second screen, with songs from here or karaoke videos from YouTube.',
    how: 'Press this to open the host screen.',
  },
  {
    id: 'change-key',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['key'],
    tab: 'mix',
    title: 'Change the key',
    text: 'Move the song up or down to suit your voice. The tempo stays the same.',
    how: 'Step the key up or down, one semitone at a time.',
  },
  {
    id: 'find-key',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['key-suggest'],
    tab: 'mix',
    title: 'Find your key',
    text: 'Say what kind of voice you have and get a key that fits the song to it.',
    how: 'Press this, then choose your voice.',
  },
  {
    id: 'guide-vocal',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['guide-vocal'],
    tab: 'mix',
    title: 'Sing along with the original singer',
    text: 'Bring the singer back in quietly, as a guide.',
    how: 'Slide this up to hear the singer under the music.',
  },
  {
    id: 'speed',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['speed'],
    open: 'transport-more',
    title: 'Slow it down to practise',
    text: 'Play the song slower or faster. The pitch stays the same.',
    how: 'Pick a speed. 1.0x is the song as recorded.',
  },
  {
    id: 'practice',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['practice'],
    title: 'Practise a song',
    text: 'Swap the timeline for what you rehearse with. Your lyric edits stay as they are.',
    how: 'Press this, or the P key. Press it again to come back to the timeline.',
  },
  {
    id: 'practice-repeat',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['practice-repeat'],
    open: 'practice',
    optional: true,
    missing: 'This song has no lyric lines to repeat yet. Add its lyrics first.',
    title: 'Repeat a hard part',
    text: 'One part of the song goes round, starting a moment early each time.',
    how: 'Turn this on while the part plays, or pick a part or two lines below. The L key does the same.',
  },
  {
    id: 'practice-singer',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['practice-singer'],
    open: 'practice',
    optional: true,
    missing: 'Open Practice first: its button is beside the song’s title.',
    title: 'Bring the singer in and out',
    text: 'Hear the original singer while you learn a part, then sing it alone. No waiting for a new mix.',
    how: 'Switch this on to hear the singer, off to sing alone. The O key does the same.',
  },
  {
    id: 'practice-pitch',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['practice-pitch'],
    open: 'practice',
    optional: true,
    missing: 'Open Practice first: its button is beside the song’s title.',
    title: 'See if you are in tune',
    text: 'Sing into the microphone and watch your pitch against the song’s melody. What you sing stays on this device.',
    how: 'Switch this on and allow the microphone. Your line turns yellow while you are on the note.',
  },
  {
    id: 'fullscreen',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['stage-fullscreen'],
    tab: 'stage',
    title: 'Put it on a TV',
    text: 'Fill the screen with the stage.',
    how: 'Press this, or the F key. Escape leaves.',
  },
  {
    id: 'stage-window',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['stage-window'],
    tab: 'stage',
    optional: true,
    missing: 'The stage window opens from a computer with a second screen, not from a phone.',
    title: 'Use a second screen',
    text: 'Put the stage on a TV while the timeline and the mix stay on this screen.',
    how: 'Press this, drag the new window to the TV, then press F in it to fill that screen.',
  },
  {
    id: 'chords',
    group: 'Sing it',
    screen: 'studio',
    anchors: ['stage-chords'],
    tab: 'stage',
    title: 'Show the chords',
    text: 'A chord bar over the stage, in the key you set.',
    how: 'Press this, or the C key.',
  },
  {
    id: 'checkup',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['checkup'],
    title: 'See what looks off',
    text: 'The check-up lists what the studio is unsure about and takes you to each fix.',
    how: 'Press this to open the song check-up.',
  },
  {
    id: 'needs-review',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['timeline-review'],
    tab: 'timeline',
    optional: true,
    missing: 'No line in this song needs review.',
    title: 'See only the lines to check',
    text: 'Hide every line the studio is sure of.',
    how: 'Press this to show only the lines that need review. Press it again for all of them.',
  },
  {
    id: 'offset',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['timeline-offset'],
    tab: 'timeline',
    title: 'Move every line at once',
    text: 'For when all the words light up early or late.',
    how: 'Press this and shift the lines earlier or later. Start with 0.1 to 0.5 seconds.',
  },
  {
    id: 'tap-sync',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['timeline-tap'],
    tab: 'timeline',
    title: 'Time the lines by tapping',
    text: 'Play the song and tap as each line starts.',
    how: 'Press this to start, then tap along as the song plays.',
  },
  {
    id: 'reimport',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['timeline-reimport'],
    tab: 'timeline',
    title: 'Get other lyrics, or time them again',
    text: 'Search for another listing, paste your own words, or re-time every line.',
    how: 'Press this to search again, paste lyrics, or re-align the ones you have.',
  },
  {
    id: 'line-menu',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['line-more'],
    tab: 'timeline',
    missing: NO_LINES,
    title: 'Merge two lines, or re-time one',
    text: 'Each line’s menu also inserts a line and sets who sings it.',
    how: 'Open a line’s menu for Merge with next line and Re-align this line.',
  },
  {
    id: 'words',
    group: 'Fix the lyrics',
    screen: 'studio',
    anchors: ['line-expand'],
    tab: 'timeline',
    missing: NO_LINES,
    title: 'Time single words, or split a line',
    text: 'Open a line to see its words, each with a start and an end.',
    how: 'Press the arrow to open the line’s words. The scissors after a word split the line there.',
  },
  {
    id: 'duet',
    group: 'Sing it together',
    screen: 'studio',
    anchors: ['timeline-duet'],
    tab: 'timeline',
    title: 'Give the lines to two singers',
    text: 'Take turns, pick a range of lines, or let the studio tell the two voices apart.',
    how: 'Press this to choose how the lines are shared out.',
  },
  {
    id: 'singer-names',
    group: 'Sing it together',
    screen: 'studio',
    anchors: ['song-details'],
    title: 'Name the singers',
    text: 'Their names take the place of Singer 1 and Singer 2.',
    how: 'The pencil opens the song’s details, where the singers are named.',
  },
  {
    id: 'keep-singer',
    group: 'Sing it together',
    screen: 'studio',
    anchors: ['vocal-singers'],
    tab: 'mix',
    optional: true,
    missing: 'This shows once the song’s lines are shared between two singers.',
    title: 'Keep your duet partner in',
    text: 'Sing one part while the other singer stays in the mix.',
    how: 'Choose how the lead is divided, then set a level for each singer.',
  },
  {
    id: 'backing-vocals',
    group: 'Sing it together',
    screen: 'studio',
    anchors: ['vocal-split'],
    tab: 'mix',
    optional: true,
    missing: 'This server cannot split the vocals.',
    title: 'Keep the backing vocals',
    text: 'Split them from the lead, then leave them in while the lead is removed.',
    how: 'Split the vocals here, then set the backing vocals’ level.',
  },
  {
    id: 'looks',
    group: 'Make it look right',
    screen: 'studio',
    anchors: ['looks'],
    tab: 'mix',
    title: 'Pick a look',
    text: 'Five looks for the stage and the video, each with its own type.',
    how: 'Pick one. The stage shows it at once.',
  },
  {
    id: 'tall-video',
    group: 'Make it look right',
    screen: 'studio',
    anchors: ['format'],
    tab: 'mix',
    title: 'Make it tall for phones',
    text: '9:16 for Shorts and other upright video.',
    how: 'Choose 9:16 Shorts. The stage and the export both follow.',
  },
  {
    id: 'song-loop',
    group: 'Make it look right',
    screen: 'studio',
    anchors: ['song-loop'],
    tab: 'mix',
    optional: true,
    missing: 'This server cannot make song loops.',
    title: 'Make a moving background from the lyrics',
    text: 'A short looping video of what the song is about.',
    how: 'Make a loop here. It takes a few minutes and then plays behind the lyrics.',
  },
  {
    id: 'better-stems',
    group: 'Make it sound right',
    screen: 'studio',
    anchors: ['stems'],
    tab: 'mix',
    title: 'Remove the vocals more cleanly',
    text: 'Re-make the stems at a better quality when the singer still comes through.',
    how: 'Press Improve stem separation and pick a quality.',
  },
];

const FEATURES_BY_ID = new Map(FEATURES.map((feature) => [feature.id, feature]));

export function featureById(id: string): Feature | undefined {
  return FEATURES_BY_ID.get(id);
}

/** The groups in the order they are listed, each with its features. */
export function featureGroups(): { group: string; features: Feature[] }[] {
  const groups: { group: string; features: Feature[] }[] = [];
  for (const feature of FEATURES) {
    const last = groups.find((g) => g.group === feature.group);
    if (last) last.features.push(feature);
    else groups.push({ group: feature.group, features: [feature] });
  }
  return groups;
}
