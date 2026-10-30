/**
 * Sub-frame Audio Time Interpolation Hook
 *
 * Provides high-frequency (60fps/120fps) interpolated playback timestamps anchored
 * to HTMLMediaElement and performance.now() without polling or idle CPU consumption.
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for high-frequency sub-frame audio playback time interpolation.
 * Anchors to audio element time or currentTime updates, extrapolating at 60fps/120fps
 * via requestAnimationFrame and performance.now(). Guarantees 0% CPU when paused.
 */
export function useInterpolatedTime({
  currentTime,
  isPlaying = false,
  playbackRate = 1.0,
  audioRef,
  getLiveTime,
}: {
  currentTime: number;
  isPlaying?: boolean;
  playbackRate?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
  /** Live position to follow instead of the element's clock, which reads 0 while a swapped
   *  source reloads (the playback clock reports the position being restored). */
  getLiveTime?: () => number;
}): number {
  const [interpolatedTime, setInterpolatedTime] = useState<number>(currentTime);
  const lastBaseTimeRef = useRef<number>(currentTime);
  const lastPerfTimeRef = useRef<number>(performance.now());
  const rafIdRef = useRef<number | null>(null);

  // Sync immediately when external currentTime prop changes (seek, step, timeupdate)
  useEffect(() => {
    lastBaseTimeRef.current = currentTime;
    lastPerfTimeRef.current = performance.now();
    setInterpolatedTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    // If not playing, cancel any running rAF loop and ensure sync with base time
    if (!isPlaying) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setInterpolatedTime(currentTime);
      return;
    }

    let isSubscribed = true;

    const tick = () => {
      if (!isSubscribed) return;

      // Handle visibility: skip frame processing if tab is backgrounded
      if (typeof document !== 'undefined' && document.hidden) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      // Check audio element if available
      if (audioRef?.current) {
        const audio = audioRef.current;
        const liveTime = getLiveTime ? getLiveTime() : audio.currentTime;
        if (audio.paused) {
          setInterpolatedTime(liveTime);
          return;
        }
        // If audio element currentTime has progressed, re-anchor base
        if (Math.abs(liveTime - lastBaseTimeRef.current) > 0.001) {
          lastBaseTimeRef.current = liveTime;
          lastPerfTimeRef.current = performance.now();
        }
      }

      const now = performance.now();
      const dtSec = Math.max(0, (now - lastPerfTimeRef.current) / 1000);

      // Clamp max extrapolation delta to 350ms to prevent runaway desync during audio stall
      const clampedDt = Math.min(dtSec, 0.35);
      const effectiveRate = audioRef?.current ? audioRef.current.playbackRate : playbackRate;
      const computed = lastBaseTimeRef.current + clampedDt * effectiveRate;

      setInterpolatedTime(computed);
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      isSubscribed = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isPlaying, playbackRate, audioRef, currentTime, getLiveTime]);

  return interpolatedTime;
}
