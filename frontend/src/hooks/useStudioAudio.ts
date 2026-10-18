/**
 * Studio Audio Playback Hook
 *
 * Encapsulates HTMLMediaElement playback lifecycle, time tracking, duration,
 * play/pause transport, seeking, and mute synchronization for the studio dashboard.
 */

import { useState, useRef, useCallback } from 'react';
import { ProjectState } from '../types';

export interface UseStudioAudioReturn {
  audioRef: React.RefObject<HTMLAudioElement>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate: number;
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

export function useStudioAudio(project: ProjectState | null): UseStudioAudioReturn {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    }
  };

  const handleTogglePlay = useCallback(() => {
    if (!project || project.status !== 'ready') return;
    if (!audioRef.current) return;
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
