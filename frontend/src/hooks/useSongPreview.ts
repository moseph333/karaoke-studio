/**
 * Plays the 30-second preview of a search result, one at a time, so a song can be checked
 * by ear before minutes are spent making it. The clip plays from an audio element of its
 * own that is never put in the page (the studio's transport keeps the only `<audio>` tag).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const PREVIEW_VOLUME = 0.8;

export interface SongPreview {
  /** The result whose preview is playing or loading. */
  activeId: string | null;
  /** True once the active preview makes sound. */
  playing: boolean;
  /** Results whose preview would not play (an expired link, a blocked clip). Choosing one
   * again tries again. */
  failedIds: ReadonlySet<string>;
  /** Plays this result's preview, or stops it when it is the one playing. */
  toggle: (id: string, url: string) => void;
  stop: () => void;
}

export function useSongPreview(): SongPreview {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());

  const setActive = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    setActive(null);
  }, [setActive]);

  const fail = useCallback(
    (id: string) => {
      if (activeRef.current !== id) return;
      setFailedIds((ids) => new Set(ids).add(id));
      stop();
    },
    [stop]
  );

  const toggle = useCallback(
    (id: string, url: string) => {
      if (activeRef.current === id) {
        stop();
        return;
      }
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'none';
        audio.volume = PREVIEW_VOLUME;
        audioRef.current = audio;
        audio.addEventListener('playing', () => setPlaying(true));
        audio.addEventListener('ended', () => setActive(null));
        audio.addEventListener('error', () => {
          if (activeRef.current) fail(activeRef.current);
        });
      }
      audio.pause();
      audio.src = url;
      setActive(id);
      setFailedIds((ids) => {
        if (!ids.has(id)) return ids;
        const rest = new Set(ids);
        rest.delete(id);
        return rest;
      });
      // Autoplay rules and a clip that will not load both reject the promise. Being
      // stopped or replaced by another preview (AbortError) is not a failure.
      void Promise.resolve(audio.play()).catch((err: unknown) => {
        if ((err as { name?: string } | null)?.name !== 'AbortError') fail(id);
      });
    },
    [fail, setActive, stop]
  );

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
    },
    []
  );

  return { activeId, playing, failedIds, toggle, stop };
}
