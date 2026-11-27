/**
 * A show's queue: who sings what, in order.
 *
 * The host of a karaoke night (`/?show=1`) adds a singer and their song; a song is one from
 * the library or a karaoke video on YouTube. One entry at most is on stage (`playing`); the
 * ones `waiting` are sung in order; those `done` or `skipped` stay listed so a singer can go
 * again. The queue is kept in this browser (`localStorage`), so a reload or a closed tab
 * does not lose the night.
 */

import type { StageBilling } from './stageLink';

export const SHOW_QUEUE_STORAGE_KEY = 'karaoke_show_queue_v1';
export const SHOW_TITLE_STORAGE_KEY = 'karaoke_show_title_v1';
export const DEFAULT_SHOW_TITLE = 'Karaoke night';
const SINGER_MAX = 40;
const TITLE_MAX = 60;

export type ShowSource =
  | {
      kind: 'library';
      projectId: string;
      title: string;
      artist: string;
      duration?: number | null;
      thumbnail?: string | null;
    }
  | {
      kind: 'youtube';
      videoId: string;
      title: string;
      /** The channel that uploaded the video. */
      artist: string;
      duration?: number | null;
      thumbnail?: string | null;
    };

export type ShowEntryStatus = 'waiting' | 'playing' | 'done' | 'skipped';

export interface ShowEntry {
  id: string;
  singer: string;
  source: ShowSource;
  status: ShowEntryStatus;
}

export type ShowQueue = ShowEntry[];

export type ShowAction =
  | { type: 'add'; id: string; singer: string; source: ShowSource }
  | { type: 'remove'; id: string }
  /** Moves a waiting entry one place earlier (-1) or later (1) among the waiting ones. */
  | { type: 'move'; id: string; by: -1 | 1 }
  /** Puts the entry on stage; whoever was on is done. */
  | { type: 'start'; id: string }
  | { type: 'finish'; id: string }
  | { type: 'skip'; id: string }
  /** A singer who has sung, or was skipped, goes to the end of the line. */
  | { type: 'again'; id: string }
  | { type: 'clear-finished' };

export function cleanSinger(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, SINGER_MAX);
}

export function cleanShowTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || DEFAULT_SHOW_TITLE;
}

const setStatus = (queue: ShowQueue, id: string, status: ShowEntryStatus): ShowQueue =>
  queue.map((entry) => (entry.id === id ? { ...entry, status } : entry));

/** The queue with one entry placed just before (`after: false`) or after another. */
function placed(queue: ShowQueue, id: string, anchorId: string, after: boolean): ShowQueue {
  const entry = queue.find((e) => e.id === id);
  if (!entry || id === anchorId) return queue;
  const rest = queue.filter((e) => e.id !== id);
  const at = rest.findIndex((e) => e.id === anchorId);
  if (at < 0) return queue;
  rest.splice(after ? at + 1 : at, 0, entry);
  return rest;
}

export function showQueueReducer(queue: ShowQueue, action: ShowAction): ShowQueue {
  switch (action.type) {
    case 'add': {
      const singer = cleanSinger(action.singer);
      if (!singer || queue.some((e) => e.id === action.id)) return queue;
      return [...queue, { id: action.id, singer, source: action.source, status: 'waiting' }];
    }
    case 'remove':
      return queue.filter((e) => e.id !== action.id);
    case 'move': {
      const waiting = queue.filter((e) => e.status === 'waiting');
      const at = waiting.findIndex((e) => e.id === action.id);
      const neighbour = waiting[at + action.by];
      if (at < 0 || !neighbour) return queue;
      return placed(queue, action.id, neighbour.id, action.by > 0);
    }
    case 'start': {
      if (!queue.some((e) => e.id === action.id)) return queue;
      return queue.map((entry) => {
        if (entry.id === action.id) return { ...entry, status: 'playing' };
        return entry.status === 'playing' ? { ...entry, status: 'done' } : entry;
      });
    }
    case 'finish':
      return setStatus(queue, action.id, 'done');
    case 'skip':
      return setStatus(queue, action.id, 'skipped');
    case 'again': {
      const entry = queue.find((e) => e.id === action.id);
      if (!entry || entry.status === 'waiting' || entry.status === 'playing') return queue;
      return [...queue.filter((e) => e.id !== action.id), { ...entry, status: 'waiting' }];
    }
    case 'clear-finished':
      return queue.filter((e) => e.status === 'waiting' || e.status === 'playing');
    default:
      return queue;
  }
}

/** The entry on stage. */
export function playingEntry(queue: ShowQueue): ShowEntry | null {
  return queue.find((e) => e.status === 'playing') ?? null;
}

/** The entries still to sing, in order. */
export function waitingEntries(queue: ShowQueue): ShowEntry[] {
  return queue.filter((e) => e.status === 'waiting');
}

/** The entries that have been on, or were passed over, latest first. */
export function finishedEntries(queue: ShowQueue): ShowEntry[] {
  return queue.filter((e) => e.status === 'done' || e.status === 'skipped').reverse();
}

/** How the stage's cards name an entry. A video's "artist" is its uploader, so it is left out. */
export function billingOf(entry: ShowEntry): StageBilling {
  const artist = entry.source.kind === 'library' ? entry.source.artist : undefined;
  return { singer: entry.singer, title: entry.source.title, ...(artist ? { artist } : {}) };
}

export function newEntryId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isSource(value: unknown): value is ShowSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  if (typeof source.title !== 'string' || typeof source.artist !== 'string') return false;
  if (source.kind === 'library') return typeof source.projectId === 'string';
  if (source.kind === 'youtube') return typeof source.videoId === 'string';
  return false;
}

function isEntry(value: unknown): value is ShowEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.singer === 'string' &&
    ['waiting', 'playing', 'done', 'skipped'].includes(entry.status as string) &&
    isSource(entry.source)
  );
}

/**
 * The saved queue. An entry that was on stage when the page went is waiting again, at the
 * head of the line: the song stopped with the page.
 */
export function loadShowQueue(): ShowQueue {
  try {
    const raw = window.localStorage.getItem(SHOW_QUEUE_STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(saved)) return [];
    const entries = saved.filter(isEntry);
    const interrupted = entries.filter((e) => e.status === 'playing');
    if (interrupted.length === 0) return entries;
    const waiting = interrupted.map((e) => ({ ...e, status: 'waiting' as const }));
    const rest = entries.filter((e) => e.status !== 'playing');
    const firstWaiting = rest.findIndex((e) => e.status === 'waiting');
    const at = firstWaiting < 0 ? rest.length : firstWaiting;
    return [...rest.slice(0, at), ...waiting, ...rest.slice(at)];
  } catch {
    return [];
  }
}

export function saveShowQueue(queue: ShowQueue): void {
  try {
    window.localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage is full or blocked: the queue lasts as long as the page does
  }
}

export function loadShowTitle(): string {
  try {
    return cleanShowTitle(window.localStorage.getItem(SHOW_TITLE_STORAGE_KEY) ?? '');
  } catch {
    return DEFAULT_SHOW_TITLE;
  }
}

export function saveShowTitle(title: string): void {
  try {
    window.localStorage.setItem(SHOW_TITLE_STORAGE_KEY, cleanShowTitle(title));
  } catch {
    // As above
  }
}
