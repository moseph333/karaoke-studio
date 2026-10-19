/**
 * Audio Controls Component
 *
 * Coordinates playback transport, timeline scrubbing, volume persistence,
 * pitch transposition, guide vocal blending, and custom instrumental replacement.
 * Integrates native HTMLMediaElement event lifecycle with global keyboard shortcuts.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';
import {
  MASTER_VOLUME_STORAGE_KEY,
  MASTER_MUTED_STORAGE_KEY,
  getStoredMasterVolume,
  setStoredMasterVolume,
  getStoredMasterMuted,
  setStoredMasterMuted,
} from '../utils/volumeStorage';
import { parseMediaError, type AudioPlaybackError } from '../utils/audioErrors';
import { MasterVolumeControl } from './audio/MasterVolumeControl';
import { PitchTranspositionControl } from './audio/PitchTranspositionControl';
import { GuideVocalControl } from './audio/GuideVocalControl';
import { AudioPlaybackErrorBanner } from './audio/AudioPlaybackErrorBanner';
import { AudioMixActionsBar } from './audio/AudioMixActionsBar';
import { WaveformScrubber } from './audio/WaveformScrubber';
import { PlaybackSpeedControl } from './audio/PlaybackSpeedControl';
import { Tooltip } from './Tooltip';

export { MASTER_VOLUME_STORAGE_KEY, MASTER_MUTED_STORAGE_KEY };
export { parseMediaError, type AudioPlaybackError };

export interface AudioControlsProps {
  projectId: string;
  masterAudioUrl?: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  lines?: Array<{
    id?: number;
    text?: string;
    start?: number;
    end?: number;
    start_time?: number;
    end_time?: number;
  }>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onMixChange: (semitones: number, guideVolume: number) => void;
  onCustomInstrumentalUploaded?: (url: string) => void;
  // Controls state synchronization (PROJECT.md Feature 38)
  initialSemitones?: number;
  initialGuideVolume?: number;
  // Master volume and mute controls (PROJECT.md Feature 42)
  initialVolume?: number;
  initialMuted?: boolean;
  onVolumeChange?: (volume: number) => void;
  onMuteChange?: (isMuted: boolean) => void;
  // Playback rate controls (Requirement R2)
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  // Audio playback bindings & resilience (Dispatch Feature 38)
  audioRef?: React.RefObject<HTMLAudioElement>;
  onTimeUpdate?: () => void;
  onLoadedMetadata?: () => void;
  onEnded?: () => void;
  onPlaybackError?: (error: AudioPlaybackError) => void;
  onRetryPlayback?: () => void;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  projectId,
  masterAudioUrl,
  lines,
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onMixChange,
  onCustomInstrumentalUploaded,
  initialSemitones = 0,
  initialGuideVolume = 0.0,
  initialVolume,
  initialMuted,
  onVolumeChange,
  onMuteChange,
  playbackRate: propPlaybackRate,
  onPlaybackRateChange,
  audioRef,
  onTimeUpdate,
  onLoadedMetadata,
  onEnded,
  onPlaybackError,
  onRetryPlayback,
}) => {
  const { toast } = useToast();
  const [semitones, setSemitones] = useState(initialSemitones);
  const [guideVolume, setGuideVolume] = useState(initialGuideVolume);
  const [isApplyingMix, setIsApplyingMix] = useState(false);
  const [uploadingInst, setUploadingInst] = useState(false);
  const [playbackError, setPlaybackError] = useState<AudioPlaybackError | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(propPlaybackRate ?? 1.0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedAudioRef = audioRef || internalAudioRef;

  // Master Volume & Mute State
  const [volume, setVolume] = useState<number>(() =>
    initialVolume !== undefined && !isNaN(initialVolume)
      ? Math.max(0, Math.min(1, initialVolume))
      : getStoredMasterVolume(1.0)
  );
  const [isMuted, setIsMuted] = useState<boolean>(() =>
    initialMuted !== undefined ? initialMuted : getStoredMasterMuted(false)
  );

  // Preserve last non-zero volume for smart unmute restoration
  const previousVolumeRef = useRef<number>(volume > 0 ? volume : 1.0);

  useEffect(() => {
    if (propPlaybackRate !== undefined && !isNaN(propPlaybackRate)) {
      setPlaybackRate(propPlaybackRate);
    }
  }, [propPlaybackRate]);

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (resolvedAudioRef.current) {
      resolvedAudioRef.current.playbackRate = rate;
    }
    onPlaybackRateChange?.(rate);
  };

  // Sync state when props change
  useEffect(() => {
    setSemitones(initialSemitones);
    setGuideVolume(initialGuideVolume);
  }, [initialSemitones, initialGuideVolume, projectId]);

  useEffect(() => {
    if (initialVolume !== undefined && !isNaN(initialVolume)) {
      const clamped = Math.max(0, Math.min(1, initialVolume));
      setVolume(clamped);
      if (clamped > 0) previousVolumeRef.current = clamped;
    }
  }, [initialVolume]);

  useEffect(() => {
    if (initialMuted !== undefined) setIsMuted(initialMuted);
  }, [initialMuted]);

  // Synchronize audio element when it mounts or when audio URL changes
  useEffect(() => {
    if (resolvedAudioRef.current) {
      resolvedAudioRef.current.volume = volume;
      resolvedAudioRef.current.muted = isMuted;
      resolvedAudioRef.current.playbackRate = playbackRate;
    }
  }, [resolvedAudioRef, masterAudioUrl, volume, isMuted, playbackRate]);

  // Clear error when master audio url changes
  useEffect(() => {
    setPlaybackError(null);
  }, [masterAudioUrl]);

  const handleSemitoneChange = (delta: number) => {
    setSemitones(Math.max(-12, Math.min(12, semitones + delta)));
  };

  const handleApplyAudioMix = async () => {
    setIsApplyingMix(true);
    setPlaybackError(null);
    try {
      await onMixChange(semitones, guideVolume);
    } finally {
      setIsApplyingMix(false);
    }
  };

  const handleAudioError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    const mediaError = e.currentTarget.error;
    const parsed = parseMediaError(mediaError);
    setPlaybackError(parsed);
    if (isPlaying) onTogglePlay();
    onPlaybackError?.(parsed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('karaoke_audio_error', { detail: parsed }));
    }
  };

  // Bidirectional audio element sync: fires on native volumechange
  const handleAudioVolumeChange = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audioEl = e.currentTarget;
    if (audioEl.volume !== volume) {
      setVolume(audioEl.volume);
      if (audioEl.volume > 0) previousVolumeRef.current = audioEl.volume;
      setStoredMasterVolume(audioEl.volume);
      onVolumeChange?.(audioEl.volume);
    }
    if (audioEl.muted !== isMuted) {
      setIsMuted(audioEl.muted);
      setStoredMasterMuted(audioEl.muted);
      onMuteChange?.(audioEl.muted);
    }
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const clamped = Math.max(0, Math.min(1, isNaN(val) ? 0 : val));
    setVolume(clamped);
    setStoredMasterVolume(clamped);
    if (clamped > 0) previousVolumeRef.current = clamped;
    if (resolvedAudioRef.current) resolvedAudioRef.current.volume = clamped;
    onVolumeChange?.(clamped);

    // Slider adjustments while muted automatically unmute (if volume > 0)
    if (isMuted && clamped > 0) {
      setIsMuted(false);
      setStoredMasterMuted(false);
      if (resolvedAudioRef.current) resolvedAudioRef.current.muted = false;
      onMuteChange?.(false);
    }
  };

  const handleToggleMute = useCallback(() => {
    if (isMuted || volume === 0) {
      // Unmuting: restore previous non-zero volume (or default 1.0)
      const restored = previousVolumeRef.current > 0 ? previousVolumeRef.current : 1.0;
      setIsMuted(false);
      setStoredMasterMuted(false);
      setVolume(restored);
      setStoredMasterVolume(restored);

      if (resolvedAudioRef.current) {
        resolvedAudioRef.current.muted = false;
        resolvedAudioRef.current.volume = restored;
      }

      onMuteChange?.(false);
      onVolumeChange?.(restored);
    } else {
      // Muting: preserve current volume
      if (volume > 0) {
        previousVolumeRef.current = volume;
      }
      setIsMuted(true);
      setStoredMasterMuted(true);

      if (resolvedAudioRef.current) {
        resolvedAudioRef.current.muted = true;
      }

      onMuteChange?.(true);
    }
  }, [isMuted, volume, onMuteChange, onVolumeChange, resolvedAudioRef]);

  // Listen for global custom event for keyboard shortcut integration
  useEffect(() => {
    const handleGlobalToggleMute = () => {
      handleToggleMute();
    };
    window.addEventListener('karaoke_toggle_mute', handleGlobalToggleMute);
    return () => window.removeEventListener('karaoke_toggle_mute', handleGlobalToggleMute);
  }, [handleToggleMute]);

  const handleRetryPlayback = () => {
    setPlaybackError(null);
    if (resolvedAudioRef.current) {
      resolvedAudioRef.current.load();
      resolvedAudioRef.current.volume = volume;
      resolvedAudioRef.current.muted = isMuted;
      resolvedAudioRef.current.playbackRate = playbackRate;
      if (currentTime > 0) {
        resolvedAudioRef.current.currentTime = currentTime;
      }
      resolvedAudioRef.current.play()?.catch(() => {});
    }
    onRetryPlayback?.();
  };

  const handleInstrumentalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingInst(true);
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload-instrumental', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (onCustomInstrumentalUploaded && data.instrumental_url) {
        onCustomInstrumentalUploaded(data.instrumental_url);
        toast.success('Custom instrumental uploaded successfully');
      }
      handleApplyAudioMix();
    } catch (err) {
      console.error('Error uploading instrumental:', err);
      toast.error('Could not upload instrumental file.');
    } finally {
      setUploadingInst(false);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl backdrop-blur-md">
      {/* Native Master Audio Element */}
      {masterAudioUrl && (
        <audio
          ref={resolvedAudioRef}
          data-testid="audio-element"
          src={masterAudioUrl}
          crossOrigin="use-credentials"
          onPlay={() => setPlaybackError(null)}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          onError={handleAudioError}
          onVolumeChange={handleAudioVolumeChange}
          className="hidden"
          aria-hidden="true"
        />
      )}

      {/* Playback Error Alert Banner */}
      {playbackError && (
        <AudioPlaybackErrorBanner
          playbackError={playbackError}
          onRetryPlayback={handleRetryPlayback}
        />
      )}

      {/* Player Header & Main Scrub Bar */}
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-3">
            <span className="text-slate-500 hidden md:inline">
              Master Mix (
              {semitones !== 0 ? `${semitones > 0 ? '+' : ''}${semitones} st` : 'Original Key'})
            </span>
            <PlaybackSpeedControl
              playbackRate={playbackRate}
              onPlaybackRateChange={handlePlaybackRateChange}
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Interactive Waveform Scrubber */}
        <WaveformScrubber
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          audioUrl={masterAudioUrl}
          lines={lines}
          isPlaying={isPlaying}
        />
      </div>

      {/* Control Buttons & Sliders Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
        {/* Play/Pause & Transport */}
        <div className="flex items-center gap-3">
          <Tooltip
            content={isPlaying ? 'Pause playback' : 'Start playback'}
            hotkey="Space"
            position="top"
          >
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
              className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-slate-950" aria-hidden="true" />
              ) : (
                <Play className="w-5 h-5 fill-slate-950 ml-0.5" aria-hidden="true" />
              )}
            </button>
          </Tooltip>

          <Tooltip content="Restart track from beginning" position="top">
            <button
              type="button"
              onClick={() => onSeek(0)}
              aria-label="Restart track from beginning"
              className="min-h-[44px] min-w-[44px] p-2.5 flex items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>
          </Tooltip>

          <div className="text-xs text-slate-400">
            <p className="font-semibold text-white">Karaoke Playback</p>
            <p className="text-[11px] text-slate-500">Sync with video timeline</p>
          </div>
        </div>

        {/* Master Volume Controls (Feature 42) */}
        <MasterVolumeControl
          volume={volume}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          onVolumeSliderChange={handleVolumeSliderChange}
        />

        {/* Pitch Shift Controls */}
        <PitchTranspositionControl
          semitones={semitones}
          onSemitoneChange={handleSemitoneChange}
          onResetPitch={() => setSemitones(0)}
        />

        {/* Guide Vocal Level & Custom Track */}
        <GuideVocalControl guideVolume={guideVolume} onGuideVolumeChange={setGuideVolume} />
      </div>

      {/* Bottom Bar: Apply Mix & Custom Instrumental Upload */}
      <AudioMixActionsBar
        isApplyingMix={isApplyingMix}
        uploadingInst={uploadingInst}
        fileInputRef={fileInputRef}
        onApplyAudioMix={handleApplyAudioMix}
        onInstrumentalUpload={handleInstrumentalUpload}
      />
    </div>
  );
};
