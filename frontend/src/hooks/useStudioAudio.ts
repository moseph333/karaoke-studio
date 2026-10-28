/**
 * Studio Audio Playback Hook
 *
 * Encapsulates HTMLMediaElement playback lifecycle, time tracking, duration,
 * play/pause transport, seeking, and mute synchronization for the studio dashboard.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { ProjectState } from '../types';

export interface UseStudioAudioReturn {
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate: number;
  analyserNode: AnalyserNode | null;
  setPlaybackRate: (rate: number) => void;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setDuration: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleTogglePlay: () => void;
  handleSeek: (time: number) => void;
  handleToggleMute: () => void;
  /** Live playback position read straight from the media element (falls back to state). */
  getCurrentTime: () => number;
  /** Seek to `time` as soon as the media element has loaded (e.g. deep links `?t=`). */
  queueSeek: (time: number) => void;
}

// Module-level registry to prevent calling createMediaElementSource more than once on the same element
const mediaElementSourceMap = new WeakMap<
  HTMLMediaElement,
  {
    source: MediaElementAudioSourceNode;
    analyser: AnalyserNode;
    audioContext: AudioContext;
  }
>();

export function useStudioAudio(project: ProjectState | null): UseStudioAudioReturn {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Source-swap bookkeeping: when the master mix URL changes (re-pitch, guide blend,
  // re-separation) the element reloads from 0; restore position and play state afterwards.
  const lastTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const restoreRef = useRef<{ time: number; play: boolean } | null>(null);
  const prevSourceRef = useRef<string | undefined>(project?.master_audio_url);
  isPlayingRef.current = isPlaying;

  useLayoutEffect(() => {
    const nextSource = project?.master_audio_url;
    const prevSource = prevSourceRef.current;
    prevSourceRef.current = nextSource;
    if (prevSource && nextSource && prevSource !== nextSource) {
      restoreRef.current = { time: lastTimeRef.current, play: isPlayingRef.current };
    } else if (!nextSource) {
      restoreRef.current = null;
    }
  }, [project?.master_audio_url]);

  const prevProjectIdRef = useRef<string | undefined>(project?.id);
  useLayoutEffect(() => {
    if (prevProjectIdRef.current !== project?.id) {
      prevProjectIdRef.current = project?.id;
      // New project: forget a source-swap restore captured for the previous song
      if (restoreRef.current?.play) restoreRef.current = null;
      if (!restoreRef.current) lastTimeRef.current = 0;
    }
  }, [project?.id]);

  // Safely initialize or re-attach Web Audio AnalyserNode to audioRef
  const initWebAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    const audioEl = audioRef.current;
    if (!audioEl) return;

    // Check if element is already attached to prevent InvalidStateError
    if (mediaElementSourceMap.has(audioEl)) {
      const existing = mediaElementSourceMap.get(audioEl)!;
      analyserRef.current = existing.analyser;
      audioContextRef.current = existing.audioContext;
      setAnalyserNode(existing.analyser);
      return;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      let ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContextClass();
        audioContextRef.current = ctx;
      }

      const source = ctx.createMediaElementSource(audioEl);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128; // 64 frequency bins, lightweight, zero CPU overhead
      analyser.smoothingTimeConstant = 0.8;

      // Connect graph: source -> analyser -> destination
      source.connect(analyser);
      analyser.connect(ctx.destination);

      mediaElementSourceMap.set(audioEl, { source, analyser, audioContext: ctx });
      analyserRef.current = analyser;
      setAnalyserNode(analyser);
    } catch (err) {
      // Gracefully handle browser restrictions or test stubs
      console.warn('Web Audio initialization deferred/suppressed:', err);
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      initWebAudio();
    }
  }, [initWebAudio, project?.id, project?.status, project?.master_audio_url]);

  useEffect(() => {
    if (project?.duration && project.duration > 0) {
      setDuration((prev) => (prev > 0 ? prev : project.duration!));
    }
  }, [project?.id, project?.duration]);

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      // Ignore the reset-to-zero updates emitted while a swapped source reloads
      if (restoreRef.current) return;
      lastTimeRef.current = audioRef.current.currentTime;
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const audioEl = audioRef.current;
    if (audioEl) {
      setDuration(audioEl.duration);
      setIsMuted(audioEl.muted);
      audioEl.playbackRate = playbackRate;
      initWebAudio();
      const restore = restoreRef.current;
      if (restore) {
        restoreRef.current = null;
        const maxTime = Number.isFinite(audioEl.duration) ? audioEl.duration : restore.time;
        const target = Math.max(0, Math.min(restore.time, maxTime));
        audioEl.currentTime = target;
        lastTimeRef.current = target;
        setCurrentTime(target);
        if (restore.play) {
          const playPromise = audioEl.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
          }
        }
      }
    }
  };

  const queueSeek = useCallback((time: number) => {
    if (!Number.isFinite(time) || time < 0) return;
    lastTimeRef.current = time;
    setCurrentTime(time);
    const el = audioRef.current;
    if (el && el.readyState >= 1) {
      el.currentTime = time;
      return;
    }
    restoreRef.current = { time, play: false };
  }, []);

  const getCurrentTime = useCallback(() => {
    const el = audioRef.current;
    if (el && Number.isFinite(el.currentTime)) return el.currentTime;
    return lastTimeRef.current;
  }, []);

  const handleTogglePlay = useCallback(() => {
    if (!project || project.status !== 'ready') return;
    if (!audioRef.current) return;

    initWebAudio();

    // Handle browser autoplay policy by resuming suspended AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'running') {
      audioContextRef.current.resume().catch((err) => {
        console.warn('AudioContext resume deferred:', err);
      });
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error('Playback failed:', err);
          setIsPlaying(false);
        });
    }
  }, [project, isPlaying, playbackRate, initWebAudio]);

  const handleSeek = useCallback(
    (time: number) => {
      if (!project || project.status !== 'ready') return;
      if (audioRef.current) {
        const maxDuration = Math.max(0, duration || audioRef.current.duration || 0);
        const clamped = Math.max(0, Math.min(maxDuration, time));
        audioRef.current.currentTime = clamped;
        lastTimeRef.current = clamped;
        if (restoreRef.current) restoreRef.current = { ...restoreRef.current, time: clamped };
        setCurrentTime(clamped);
      }
    },
    [project, duration]
  );

  const handleToggleMute = useCallback(() => {
    if (!project || project.status !== 'ready') return;
    if (audioRef.current) {
      const nextMuted = !audioRef.current.muted;
      audioRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
    window.dispatchEvent(new CustomEvent('karaoke_toggle_mute'));
  }, [project]);

  return {
    audioRef,
    currentTime,
    duration,
    isPlaying,
    isMuted,
    playbackRate,
    analyserNode,
    setPlaybackRate,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setIsMuted,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleTogglePlay,
    handleSeek,
    handleToggleMute,
    getCurrentTime,
    queueSeek,
  };
}
