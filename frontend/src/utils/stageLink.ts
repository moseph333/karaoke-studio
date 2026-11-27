/**
 * Stage link
 *
 * How the studio's window and a stage window talk. A stage window (`/?stage=1`) is the stage
 * alone, for a second screen: a TV shows the lyrics while the studio's window keeps the
 * timeline, the mix and the player. Both are pages of this app in one browser, so they share
 * a BroadcastChannel; nothing goes through the server.
 *
 * The studio sends what the stage draws (`state`) whenever it changes and where the song is
 * (`transport`) on every time update. The stage window keeps time by itself between those
 * (`transportTime`), sends `hello` when it opens and `closed` when it goes, and asks for
 * play, pause and seek as `command`s. The messages are plain data and know nothing of the
 * channel, so another carrier (a stage on another device) would send the same ones.
 */

import type { ChordSegment, LyricLine, PartNames, SyncDisplayMode } from '../types';
import type { Aspect, LookId } from '../theme/stageLooks';
import type { StageBackgroundStyle } from '../theme/stageBackgrounds';

export const STAGE_CHANNEL_NAME = 'karaoke-stage';
/** `/?stage=1` opens the stage window instead of the app. */
export const STAGE_PARAM = 'stage';
/** `/?show=1` opens the host screen of a show instead of the app. */
export const SHOW_PARAM = 'show';

/** Everything the stage draws apart from the song position. */
export interface StageState {
  lines: LyricLine[];
  duration: number;
  title?: string;
  artist?: string;
  partNames: PartNames | null;
  lookId: LookId;
  aspect: Aspect;
  fontSizeScale: number;
  syncMode: SyncDisplayMode;
  sung: string;
  unsung: string;
  singer2: string;
  both: string;
  backgroundStyle?: StageBackgroundStyle;
  backgroundMedia: { url: string; kind: 'image' | 'video' } | null;
  artworkUrl?: string;
  albumArtUrl?: string;
  backgroundPalette?: [string, string, string];
  showVisualizer: boolean;
  showChordBar: boolean;
  chords?: ChordSegment[];
  semitones: number;
  keyHint?: string | null;
}

/** Where the song is: `time` was the position at `at` (the sender's `Date.now()`). */
export interface StageTransport {
  time: number;
  at: number;
  isPlaying: boolean;
  rate: number;
  /** A jump (a seek), not playback moving on. */
  seek: boolean;
}

export type StageCommand = { name: 'play' } | { name: 'pause' } | { name: 'seek'; time: number };

// --- A show (the host screen, /?show=1) ---------------------------------------------------
// A show puts more on the stage window than a song's lyrics: a card between singers, and
// karaoke videos, which play in the stage window itself (there is one sound, and it is the
// window the room watches). The host sends the `scene`; a video's player lives in the stage
// window, takes `player` commands and sends back `report`s.

/** A singer and their song, as the cards name them. */
export interface StageBilling {
  singer: string;
  title: string;
  artist?: string;
}

export type StageScene =
  /** Nobody is on: the night's name and who is coming up. */
  | { kind: 'idle'; title: string; next: StageBilling[] }
  /** A singer has been called and has not started. */
  | { kind: 'upnext'; title: string; now: StageBilling; next: StageBilling[] }
  /** A song from the library: the stage the host's window sends (`state`, `transport`). */
  | { kind: 'lyrics' }
  /** A YouTube video in YouTube's own player. `play` tells one playing of it from the next. */
  | { kind: 'youtube'; videoId: string; play: number }
  /** A video file (the server's copy of a video that cannot be embedded). */
  | { kind: 'file'; url: string; play: number };

export type PlayerCommand =
  | { name: 'play' }
  | { name: 'pause' }
  | { name: 'seek'; time: number }
  | { name: 'volume'; volume: number; muted: boolean };

/** Why a video did not play: its uploader does not allow embedding, it is gone or private,
 *  or the player failed. */
export type PlayerError = 'embed' | 'unavailable' | 'playback';

export interface PlayerReport {
  /** The scene's `play`, so a report from the video before is not taken for this one's. */
  play: number;
  /** `blocked`: the browser will not start sound in the stage window until it is clicked. */
  status: 'loading' | 'playing' | 'paused' | 'ended' | 'blocked' | 'error';
  time: number;
  duration: number;
  error?: PlayerError;
}

export type StageMessage =
  /** From a studio: its stage, or null when its song closed. */
  | { type: 'state'; from: string; state: StageState | null }
  | { type: 'transport'; from: string; transport: StageTransport }
  /** From a studio: is a stage window open? One that is answers `hello`. */
  | { type: 'who' }
  /** From a stage window: it opened, or it is answering `who`. */
  | { type: 'hello' }
  /** From a stage window: it is closing. */
  | { type: 'closed' }
  /** From a stage window, to the studio it follows. */
  | { type: 'command'; to: string; command: StageCommand }
  /** From a show's host: what the stage window shows, or null when the show closed. */
  | { type: 'scene'; from: string; scene: StageScene | null }
  /** From a show's host, to the video playing in the stage window. */
  | { type: 'player'; from: string; command: PlayerCommand }
  /** From a stage window's video player, to the host that put it there. */
  | { type: 'report'; to: string; report: PlayerReport };

export const PAUSED_AT_START: StageTransport = {
  time: 0,
  at: 0,
  isPlaying: false,
  rate: 1,
  seek: false,
};

/** How long a stage window keeps the song moving with no word from the studio. The player
 *  reports its position at least four times a second, so a longer silence means it stalled. */
export const MAX_COAST_SEC = 0.75;

/** The song position at `now` for the last transport received. */
export function transportTime(transport: StageTransport, now: number): number {
  if (!transport.isPlaying) return transport.time;
  const elapsed = Math.min(Math.max(0, (now - transport.at) / 1000), MAX_COAST_SEC);
  return transport.time + elapsed * transport.rate;
}

export interface StageLink {
  post(message: StageMessage): void;
  close(): void;
}

function isStageMessage(data: unknown): data is StageMessage {
  return (
    typeof data === 'object' && data !== null && typeof (data as StageMessage).type === 'string'
  );
}

/** Joins the channel; null where the browser has no BroadcastChannel. */
export function openStageLink(onMessage: (message: StageMessage) => void): StageLink | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  let channel: BroadcastChannel | null;
  try {
    channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
  } catch {
    return null;
  }
  channel.onmessage = (event: MessageEvent) => {
    if (isStageMessage(event.data)) onMessage(event.data);
  };
  return {
    post(message) {
      try {
        channel?.postMessage(message);
      } catch {
        // A closed channel, or a value that cannot be copied: the stage window misses one update
      }
    },
    close() {
      channel?.close();
      channel = null;
    },
  };
}

/** Whether this page was opened as a stage window. */
export function isStageWindowUrl(search: string): boolean {
  return new URLSearchParams(search).has(STAGE_PARAM);
}

/** Whether this page was opened as a show's host screen. */
export function isShowUrl(search: string): boolean {
  return new URLSearchParams(search).has(SHOW_PARAM);
}

/** A name for one studio window, so a stage window can tell two studios apart. */
export function newStudioId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
