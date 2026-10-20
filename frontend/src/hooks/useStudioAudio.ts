/**
 * Studio Audio Playback Hook
 *
 * Encapsulates HTMLMediaElement playback lifecycle, time tracking, duration,
 * play/pause transport, seeking, and mute synchronization for the studio dashboard.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
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
  }, [initWebAudio, project?.master_audio_url]);

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
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setIsMuted(audioRef.current.muted);
      audioRef.current.playbackRate = playbackRate;
      initWebAudio();
    }
  };

  const handleTogglePlay = useCallback(() => {
    if (!project || project.status !== 'ready') return;
    if (!audioRef.current) return;

    // Handle browser autoplay policy by resuming suspended AudioContext
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
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
  }, [project, isPlaying, playbackRate]);

  const handleSeek = useCallback(
    (time: number) => {
      if (!project || project.status !== 'ready') return;
      if (audioRef.current) {
        const maxDuration = Math.max(0, duration || audioRef.current.duration || 0);
        const clamped = Math.max(0, Math.min(maxDuration, time));
        audioRef.current.currentTime = clamped;
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
  };
}
