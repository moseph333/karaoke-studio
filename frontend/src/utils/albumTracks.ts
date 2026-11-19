/**
 * Helpers for the album picker (`components/album/AlbumTrackPicker`): what the source of a
 * song list means in plain words, the time range of a song, which songs can still be picked,
 * and the label of the button that makes them.
 */

import type { AlbumListing, AlbumSource, AlbumTrack } from '../types';
import { formatTime } from './format';

const SITE_NAMES: Record<string, string> = { deezer: 'Deezer', itunes: 'the iTunes Store' };

/** Where the song list came from, said so that the listener knows what to check. */
export function albumSourceSentence(
  source: AlbumSource,
  kind: AlbumListing['kind'],
  catalogSite?: string | null
): string {
  const recording = kind === 'upload' ? 'file' : 'video';
  switch (source) {
    case 'chapters':
      return `The songs come from the ${recording}'s chapters. Each cut is placed in the pause between two songs.`;
    case 'catalog':
      return `The songs come from the album's track list on ${
        SITE_NAMES[catalogSite ?? ''] ?? 'a music catalog'
      }. Each cut is placed in the pause between two songs.`;
    case 'pauses':
      return `Nothing names the songs in this ${recording}, so they were found from the pauses between them. Give the ones you pick their names so their lyrics can be found.`;
    default:
      return `No songs could be told apart in this ${recording}.`;
  }
}

/** "4:56 – 6:32 · 1:36" */
export function trackRangeLabel(track: Pick<AlbumTrack, 'start' | 'end'>): string {
  return `${formatTime(track.start)} – ${formatTime(track.end)} · ${formatTime(
    track.end - track.start
  )}`;
}

const MADE_STATUSES = new Set([
  'ready',
  'queued',
  'processing',
  'downloading',
  'separating',
  'fetching_lyrics',
  'aligning',
  'mixing',
]);

/** Whether a song has been made from this track already (or is being made): it opens rather
 * than being picked. A failed or cancelled one can be picked again. */
export function isTrackMade(track: Pick<AlbumTrack, 'project_status'>): boolean {
  return Boolean(track.project_status && MADE_STATUSES.has(track.project_status));
}

/** The words for a made song's state on its row. */
export function madeTrackLabel(status: string | null | undefined): string {
  if (status === 'ready') return 'Ready';
  return 'Being made';
}

/** "Make 1 song", "Make 3 songs" */
export function makeSongsLabel(count: number): string {
  return count === 1 ? 'Make 1 song' : `Make ${count} songs`;
}

/** The songs to send: each picked number with the name typed for it, if one was. */
export function songPicks(
  selected: Iterable<number>,
  titles: Record<number, string>
): Array<{ number: number; title?: string }> {
  return [...selected]
    .sort((a, b) => a - b)
    .map((number) => {
      const title = titles[number]?.trim();
      return title ? { number, title } : { number };
    });
}

/** The picked songs that still have a stand-in name ("Track 3") and no name typed for them. */
export function unnamedPicks(
  tracks: AlbumTrack[],
  selected: ReadonlySet<number>,
  titles: Record<number, string>
): AlbumTrack[] {
  return tracks.filter((t) => selected.has(t.number) && !t.named && !titles[t.number]?.trim());
}
