/**
 * Playback Clock
 *
 * The song position as an external store, so a media `timeupdate` (about 4 times a second)
 * re-renders only the components that show the time instead of the whole studio.
 *
 * useStudioAudio creates one clock per studio and the app provides it through
 * PlaybackClockContext. Components read it with usePlaybackValue(select), which re-renders
 * only when the selected value changes (the active line, the active word, ...). A component
 * given a `currentTime` prop uses that instead and works without the provider, as in tests.
 */

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

export interface PlaybackClockState {
  /** Song position in seconds. */
  readonly time: number;
  /** Increases on every seek (not during playback), for listeners that react to jumps. */
  readonly seekId: number;
}

export interface PlaybackClock {
  /** The same object until the next change. */
  getState(): PlaybackClockState;
  subscribe(listener: () => void): () => void;
  /** The live position: the media element's clock when it can be trusted, else the stored time. */
  now(): number;
  /** Publishes a position (synchronously). `seek` marks a jump rather than playback. */
  setTime(time: number, options?: { seek?: boolean }): void;
  setLiveReader(reader: (() => number | null) | null): void;
}

export function createPlaybackClock(): PlaybackClock {
  let state: PlaybackClockState = { time: 0, seekId: 0 };
  let liveReader: (() => number | null) | null = null;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    now() {
      const live = liveReader?.();
      return typeof live === 'number' && Number.isFinite(live) ? live : state.time;
    },
    setTime(time, options) {
      if (!Number.isFinite(time)) return;
      const seek = Boolean(options?.seek);
      if (time === state.time && !seek) return;
      state = { time, seekId: seek ? state.seekId + 1 : state.seekId };
      listeners.forEach((listener) => listener());
    },
    setLiveReader(reader) {
      liveReader = reader;
    },
  };
}

export const PlaybackClockContext = createContext<PlaybackClock | null>(null);

export function usePlaybackClock(): PlaybackClock | null {
  return useContext(PlaybackClockContext);
}

const subscribeToNothing = () => () => {};

/**
 * A value derived from the song position, re-rendering only when `select(time)` changes, so
 * selectors return primitives (a line index, a word key, a whole second).
 * - `timeOverride` (a component's `currentTime` prop) wins: the value comes from it and
 *   nothing subscribes, as when tests drive time through props.
 * - `live: false` stops following the clock (a hidden stage); the value is read fresh on the
 *   next render instead.
 */
export function usePlaybackValue<T extends string | number | boolean | null>(
  select: (time: number) => T,
  timeOverride?: number,
  options?: { live?: boolean }
): T {
  const clock = usePlaybackClock();
  const follow = timeOverride === undefined && clock !== null && options?.live !== false;
  const getSnapshot = () => select(timeOverride ?? clock?.getState().time ?? 0);
  return useSyncExternalStore(
    follow && clock ? clock.subscribe : subscribeToNothing,
    getSnapshot,
    getSnapshot
  );
}

const sameTime = (time: number) => time;

/** The song position itself: re-renders on every change (for frame-rate consumers). */
export function usePlaybackTime(timeOverride?: number, options?: { live?: boolean }): number {
  return usePlaybackValue(sameTime, timeOverride, options);
}

/** Calls `onSeek` after every seek published to the clock (not during playback). */
export function usePlaybackSeekListener(onSeek: () => void, enabled = true): void {
  const clock = usePlaybackClock();
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onSeekRef.current = onSeek;
  });
  useEffect(() => {
    if (!clock || !enabled) return;
    let lastSeekId = clock.getState().seekId;
    return clock.subscribe(() => {
      const { seekId } = clock.getState();
      if (seekId === lastSeekId) return;
      lastSeekId = seekId;
      onSeekRef.current();
    });
  }, [clock, enabled]);
}
