/**
 * Media Session integration
 *
 * Keyboard media keys, headset buttons and the lock screen / notification shade control
 * playback, and the OS shows the song's title, artist and artwork. Previous/next track map
 * to the previous/next lyric line. Everything is feature-detected and cleaned up on exit.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export interface UseMediaSessionOptions {
  enabled: boolean;
  title?: string;
  artist?: string;
  artworkUrl?: string;
  isPlaying: boolean;
  duration: number;
  playbackRate: number;
  getCurrentTime: () => number;
  /** The playing element, so seeks and rate changes refresh the OS position. */
  audioRef?: React.RefObject<HTMLMediaElement>;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onPreviousLine?: () => void;
  onNextLine?: () => void;
}

const DEFAULT_SKIP_SECONDS = 10;

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'stop',
  'seekto',
  'seekbackward',
  'seekforward',
  'previoustrack',
  'nexttrack',
];

function getSession(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : null;
}

function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Browsers throw for actions they do not support
  }
}

export function useMediaSession(options: UseMediaSessionOptions): void {
  const { enabled, title, artist, artworkUrl, isPlaying, duration, playbackRate, audioRef } =
    options;
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const updatePosition = useCallback(() => {
    const session = getSession();
    const { duration: total, playbackRate: rate, getCurrentTime } = latest.current;
    if (!session || typeof session.setPositionState !== 'function') return;
    if (!Number.isFinite(total) || total <= 0) return;
    try {
      session.setPositionState({
        duration: total,
        playbackRate: rate > 0 ? rate : 1,
        position: Math.min(total, Math.max(0, getCurrentTime() || 0)),
      });
    } catch {
      // Invalid state (e.g. position briefly past a shortened duration): try next update
    }
  }, []);

  // Song metadata for the OS media controls
  useEffect(() => {
    const session = getSession();
    if (!enabled || !session || typeof MediaMetadata === 'undefined') return;
    try {
      session.metadata = new MediaMetadata({
        title: title || 'Karaoke track',
        artist: artist || '',
        album: 'Karaoke Studio',
        artwork: artworkUrl
          ? [{ src: new URL(artworkUrl, window.location.href).href, sizes: '512x512' }]
          : [],
      });
    } catch {
      // Invalid artwork URL or unsupported metadata
    }
    return () => {
      session.metadata = null;
    };
  }, [enabled, title, artist, artworkUrl]);

  // Media key handlers (read the latest callbacks through the ref)
  useEffect(() => {
    const session = getSession();
    if (!enabled || !session) return;
    const skip = (direction: 1 | -1) => (details: MediaSessionActionDetails) => {
      const { getCurrentTime, onSeek, duration: total } = latest.current;
      const offset = details.seekOffset ?? DEFAULT_SKIP_SECONDS;
      const target = getCurrentTime() + direction * offset;
      onSeek(Math.max(0, total > 0 ? Math.min(total, target) : target));
    };
    setHandler(session, 'play', () => latest.current.onPlay());
    setHandler(session, 'pause', () => latest.current.onPause());
    setHandler(session, 'stop', () => latest.current.onPause());
    setHandler(session, 'seekto', (details) => {
      if (typeof details.seekTime === 'number') latest.current.onSeek(details.seekTime);
    });
    setHandler(session, 'seekbackward', skip(-1));
    setHandler(session, 'seekforward', skip(1));
    setHandler(session, 'previoustrack', () => latest.current.onPreviousLine?.());
    setHandler(session, 'nexttrack', () => latest.current.onNextLine?.());
    return () => {
      ACTIONS.forEach((action) => setHandler(session, action, null));
    };
  }, [enabled]);

  useEffect(() => {
    const session = getSession();
    if (!enabled || !session) return;
    session.playbackState = isPlaying ? 'playing' : 'paused';
    return () => {
      session.playbackState = 'none';
    };
  }, [enabled, isPlaying]);

  useEffect(() => {
    if (enabled) updatePosition();
  }, [enabled, isPlaying, duration, playbackRate, updatePosition]);

  // Seeks from the scrubber, keyboard or timeline move the OS position too
  useEffect(() => {
    const el = audioRef?.current;
    if (!enabled || !el) return;
    el.addEventListener('seeked', updatePosition);
    el.addEventListener('ratechange', updatePosition);
    return () => {
      el.removeEventListener('seeked', updatePosition);
      el.removeEventListener('ratechange', updatePosition);
    };
  }, [enabled, audioRef, updatePosition]);
}
