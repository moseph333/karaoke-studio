/**
 * Guide stops: the places a tour stops at, what each is called and what it does. The
 * pointer (`components/guide`) finds a stop's control by its `data-guide` attribute, so this
 * file is words and names only. `utils/features.ts` lists the single controls Help's "What
 * you can do" points at, in the same shape.
 */

import type { StudioWorkspaceTab } from '../types';

export type GuideScreen = 'studio' | 'home';
export type TourId = GuideScreen;

/** What the app is asked to point at: a whole tour, or one feature from `utils/features`. */
export type GuideRequest = { tour: TourId } | { feature: string };

/** The icons a legend row can carry; `components/guide/GuidePointer` draws them. */
export type LegendIcon =
  | 'highlight'
  | 'visualizer'
  | 'chords'
  | 'fullscreen'
  | 'undo'
  | 'offset'
  | 'duet'
  | 'tap'
  | 'lyrics'
  | 'nudge'
  | 'more'
  | 'words';

export interface LegendRow {
  icon: LegendIcon;
  name: string;
  text: string;
}

/** Where a stop is on screen. */
export interface GuideTarget {
  screen: GuideScreen;
  /** `data-guide` names, tried in order: the first one that is on screen is pointed at. */
  anchors: string[];
  /** The phone tab the control is on. */
  tab?: StudioWorkspaceTab;
  /** The `data-guide` name of a button that uncovers the control when it is collapsed. */
  open?: string;
  /** The control is not on every screen size, server or song. */
  optional?: boolean;
  /** Said when the control is not there to point at. */
  missing?: string;
}

export interface GuideStop extends GuideTarget {
  id: string;
  title: string;
  body: string;
  /** Names the icon-only buttons of a toolbar. */
  legend?: LegendRow[];
}

export const GUIDE_STOPS: GuideStop[] = [
  {
    id: 'song',
    screen: 'studio',
    anchors: ['song'],
    title: 'Your song',
    body: 'Check-up counts what looks off in the lyrics and timing and takes you to each fix. The pencil changes the title, the artist and the singers’ names.',
  },
  {
    id: 'workspace-tabs',
    screen: 'studio',
    anchors: ['workspace-tabs'],
    optional: true,
    title: 'Three views',
    body: 'Stage is the song as the video shows it, Timeline is every lyric line, and Mix & Look is how it sounds and looks.',
  },
  {
    id: 'stage',
    screen: 'studio',
    anchors: ['stage'],
    tab: 'stage',
    title: 'Stage',
    body: 'The words light up as they are sung, exactly as the video will show them. Press a word to jump to it.',
  },
  {
    id: 'stage-tools',
    screen: 'studio',
    anchors: ['stage-tools'],
    tab: 'stage',
    title: 'Stage tools',
    body: 'Four switches for what the stage shows.',
    legend: [
      { icon: 'highlight', name: 'Word or Line', text: 'light up each word, or the whole line' },
      { icon: 'visualizer', name: 'Beat visualizer', text: 'bars that move with the music' },
      { icon: 'chords', name: 'Chord bar', text: 'the chords, in the key you set' },
      { icon: 'fullscreen', name: 'Fullscreen', text: 'fill the screen, for a TV' },
    ],
  },
  {
    id: 'timeline',
    screen: 'studio',
    anchors: ['timeline'],
    tab: 'timeline',
    title: 'Timeline',
    body: 'Every lyric line, in order. Press a line to jump to it, and change its words or its timing here.',
  },
  {
    id: 'timeline-tools',
    screen: 'studio',
    anchors: ['timeline-tools'],
    tab: 'timeline',
    title: 'Lyric tools',
    body: 'Tools for the whole song’s lyrics.',
    legend: [
      { icon: 'undo', name: 'Undo and redo', text: 'take back an edit, or put it back' },
      { icon: 'offset', name: 'Offset', text: 'move every line earlier or later' },
      { icon: 'duet', name: 'Duet parts', text: 'give the lines to two singers' },
      { icon: 'tap', name: 'Tap sync', text: 'time the lines by tapping along' },
      { icon: 'lyrics', name: 'Re-import', text: 'other lyrics, or time them all again' },
    ],
  },
  {
    id: 'line-tools',
    screen: 'studio',
    anchors: ['line-tools', 'timeline-list'],
    tab: 'timeline',
    title: 'A line’s tools',
    body: 'Each line has its own.',
    legend: [
      { icon: 'nudge', name: 'Nudge', text: 'move the line a little earlier or later' },
      { icon: 'more', name: 'More', text: 'insert, merge, re-time this line, set its singer' },
      { icon: 'words', name: 'Words', text: 'open the line to time each word or split it' },
    ],
  },
  {
    id: 'audio-mix',
    screen: 'studio',
    anchors: ['audio-mix'],
    tab: 'mix',
    title: 'Audio mix',
    body: 'How the song sounds: its key, how much of the original singer you hear, which vocal parts stay in, and how cleanly the vocals were removed.',
  },
  {
    id: 'stage-look',
    screen: 'studio',
    anchors: ['stage-look'],
    tab: 'mix',
    title: 'Stage look',
    body: 'How the stage and the video look: the look, its colours, the lyric size, wide or tall, and the background.',
  },
  {
    id: 'transport',
    screen: 'studio',
    anchors: ['transport'],
    title: 'Playback',
    body: 'Play, start again, or drag through the song. The key and speed sit beside the play button.',
  },
  {
    id: 'header-tools',
    screen: 'studio',
    anchors: ['header-tools'],
    title: 'Export, Help, Search',
    body: 'Export makes the video, the subtitle files, the stems and a chord sheet. Help lists what you can do and has a fix for common problems. Search finds any action, song or lyric line.',
  },
  {
    id: 'home-search',
    screen: 'home',
    anchors: ['home-search', 'intake-mode'],
    title: 'Find a song',
    body: 'Type a title, an artist or both and pick the song from the list. Or paste a song link.',
  },
  {
    id: 'intake-mode',
    screen: 'home',
    anchors: ['intake-mode'],
    title: 'Or your own audio',
    body: 'Local audio file makes karaoke from a recording you already have.',
  },
  {
    id: 'advanced',
    screen: 'home',
    anchors: ['advanced'],
    title: 'Advanced options',
    body: 'Choose how carefully the vocals are removed, and paste your own lyrics if you have them.',
  },
  {
    id: 'setlist',
    screen: 'home',
    anchors: ['setlist'],
    title: 'Setlist',
    body: 'Every song you make is kept here, ready to open again. Community library lists the songs others made.',
  },
  {
    id: 'home-help',
    screen: 'home',
    anchors: ['help'],
    title: 'Help',
    body: 'Each step explained, a list of what you can do, and a fix for common problems.',
  },
];

/** The stops of each tour, in order. */
export const TOURS: Record<TourId, string[]> = {
  studio: [
    'song',
    'workspace-tabs',
    'stage',
    'stage-tools',
    'timeline',
    'timeline-tools',
    'line-tools',
    'audio-mix',
    'stage-look',
    'transport',
    'header-tools',
  ],
  home: ['home-search', 'intake-mode', 'advanced', 'setlist', 'home-help'],
};

const STOPS_BY_ID = new Map(GUIDE_STOPS.map((stop) => [stop.id, stop]));

/** The stops of a tour, in order. */
export function tourStops(tour: TourId): GuideStop[] {
  return TOURS[tour].flatMap((id) => STOPS_BY_ID.get(id) ?? []);
}
