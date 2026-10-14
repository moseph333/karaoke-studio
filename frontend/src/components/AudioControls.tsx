import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Mic,
  Upload,
  Sliders,
  Music2,
  AlertCircle,
  Volume2,
  Volume1,
  VolumeX,
} from 'lucide-react';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';

export const MASTER_VOLUME_STORAGE_KEY = 'karaoke_master_volume';
export const MASTER_MUTED_STORAGE_KEY = 'karaoke_master_muted';

function getStoredMasterVolume(fallback = 1.0): number {
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch {
    // Storage access restricted
  }
  return fallback;
}

function setStoredMasterVolume(volume: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, volume.toString());
  } catch {
    // Storage access restricted
  }
}

function getStoredMasterMuted(fallback = false): boolean {
  try {
    const raw = localStorage.getItem(MASTER_MUTED_STORAGE_KEY);
    if (raw !== null) {
      return raw === 'true';
    }
  } catch {
    // Storage access restricted
  }
  return fallback;
}

function setStoredMasterMuted(isMuted: boolean): void {
  try {
    localStorage.setItem(MASTER_MUTED_STORAGE_KEY, isMuted ? 'true' : 'false');
  } catch {
    // Storage access restricted
  }
}

export interface AudioPlaybackError {
  code: number;
  codeName:
    | 'MEDIA_ERR_ABORTED'
    | 'MEDIA_ERR_NETWORK'
    | 'MEDIA_ERR_DECODE'
    | 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    | 'MEDIA_ERR_UNKNOWN';
  message: string;
  timestamp: number;
}

export function parseMediaError(error: MediaError | null): AudioPlaybackError {
  if (!error) {
    return {
      code: 0,
      codeName: 'MEDIA_ERR_UNKNOWN',
      message: 'An unknown audio playback error occurred.',
      timestamp: Date.now(),
    };
  }

  switch (error.code) {
    case 1:
      return {
        code: 1,
        codeName: 'MEDIA_ERR_ABORTED',
        message: 'Audio playback was aborted. Click Retry to reload the track.',
        timestamp: Date.now(),
      };
    case 2:
      return {
        code: 2,
        codeName: 'MEDIA_ERR_NETWORK',
        message: 'Network error loading audio stream. Please check server connectivity.',
        timestamp: Date.now(),
      };
    case 3:
      return {
        code: 3,
        codeName: 'MEDIA_ERR_DECODE',
        message: 'Audio decoding failed. The audio stream may be corrupt or incomplete.',
        timestamp: Date.now(),
      };
    case 4:
      return {
        code: 4,
        codeName: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
        message: 'Audio format not supported or file not found on server.',
        timestamp: Date.now(),
      };
    default:
      return {
        code: error.code,
        codeName: 'MEDIA_ERR_UNKNOWN',
        message: error.message || 'An unexpected audio playback error occurred.',
        timestamp: Date.now(),
      };
  }
}

export interface AudioControlsProps {
  projectId: string;
  masterAudioUrl?: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
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

  // Master Volume & Mute State
  const [volume, setVolume] = useState<number>(() => {
    if (initialVolume !== undefined && !isNaN(initialVolume)) {
      return Math.max(0, Math.min(1, initialVolume));
    }
    return getStoredMasterVolume(1.0);
  });

  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (initialMuted !== undefined) {
      return initialMuted;
    }
    return getStoredMasterMuted(false);
  });

  // Preserve last non-zero volume for smart unmute restoration
  const previousVolumeRef = useRef<number>(volume > 0 ? volume : 1.0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedAudioRef = audioRef || internalAudioRef;

  // Sync state when props change
  useEffect(() => {
    setSemitones(initialSemitones);
  }, [initialSemitones, projectId]);

  useEffect(() => {
    setGuideVolume(initialGuideVolume);
  }, [initialGuideVolume, projectId]);

  useEffect(() => {
    if (initialVolume !== undefined && !isNaN(initialVolume)) {
      const clamped = Math.max(0, Math.min(1, initialVolume));
      setVolume(clamped);
      if (clamped > 0) previousVolumeRef.current = clamped;
    }
  }, [initialVolume]);

  useEffect(() => {
    if (initialMuted !== undefined) {
      setIsMuted(initialMuted);
    }
  }, [initialMuted]);

  // Synchronize audio element when it mounts or when audio URL changes
  useEffect(() => {
    if (resolvedAudioRef.current) {
      resolvedAudioRef.current.volume = volume;
      resolvedAudioRef.current.muted = isMuted;
    }
  }, [resolvedAudioRef, masterAudioUrl, volume, isMuted]);

  // Clear error when master audio url changes
  useEffect(() => {
    setPlaybackError(null);
  }, [masterAudioUrl]);

  const handleSemitoneChange = (delta: number) => {
    const nextVal = Math.max(-12, Math.min(12, semitones + delta));
    setSemitones(nextVal);
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

    // Stop playback state if currently playing
    if (isPlaying) {
      onTogglePlay();
    }

    onPlaybackError?.(parsed);

    // Dispatch event for optional listeners
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('karaoke_audio_error', { detail: parsed }));
    }
  };

  // Bidirectional audio element sync: fires on native volumechange
  const handleAudioVolumeChange = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audioEl = e.currentTarget;
    if (audioEl.volume !== volume) {
      setVolume(audioEl.volume);
      if (audioEl.volume > 0) {
        previousVolumeRef.current = audioEl.volume;
      }
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
    if (clamped > 0) {
      previousVolumeRef.current = clamped;
    }

    if (resolvedAudioRef.current) {
      resolvedAudioRef.current.volume = clamped;
    }
    onVolumeChange?.(clamped);

    // Slider adjustments while muted automatically unmute (if volume > 0)
    if (isMuted && clamped > 0) {
      setIsMuted(false);
      setStoredMasterMuted(false);
      if (resolvedAudioRef.current) {
        resolvedAudioRef.current.muted = false;
      }
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
        <div
          data-testid="audio-error-banner"
          role="alert"
          aria-live="assertive"
          className="mb-4 p-3.5 rounded-xl bg-red-950/70 border border-red-800/80 text-red-200 text-xs flex flex-wrap items-center justify-between gap-3 shadow-lg"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold text-red-300">Playback Error: {playbackError.codeName}</p>
              <p className="text-[11px] text-slate-300 font-mono mt-0.5">{playbackError.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetryPlayback}
            className="px-3 py-1.5 rounded-lg bg-red-800/80 hover:bg-red-700 text-white font-medium text-xs transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-red-400 shadow"
            aria-label="Retry playback"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry Playback
          </button>
        </div>
      )}

      {/* Player Header & Main Scrub Bar */}
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span className="text-slate-500">
            Master Mix (
            {semitones !== 0 ? `${semitones > 0 ? '+' : ''}${semitones} st` : 'Original Key'})
          </span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          aria-label="Audio timeline position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 100}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-300 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500 touch-none py-2"
        />
      </div>

      {/* Control Buttons & Sliders Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
        {/* Play/Pause & Transport */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-slate-950" aria-hidden="true" />
            ) : (
              <Play className="w-5 h-5 fill-slate-950 ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Restart track from beginning"
            className="min-h-[44px] min-w-[44px] p-2.5 flex items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
            title="Restart Track"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>

          <div className="text-xs text-slate-400">
            <p className="font-semibold text-white">Karaoke Playback</p>
            <p className="text-[11px] text-slate-500">Sync with video timeline</p>
          </div>
        </div>

        {/* Master Volume Controls (Feature 42) */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-slate-400 font-medium">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted || volume === 0 ? 'Unmute audio' : 'Mute audio'}
                aria-pressed={isMuted || volume === 0}
                title={isMuted || volume === 0 ? 'Unmute audio (M)' : 'Mute audio (M)'}
                className="min-h-[44px] min-w-[44px] p-2.5 -ml-2 flex items-center justify-center rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" aria-hidden="true" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                )}
              </button>
              <span>Master Volume</span>
            </div>
            <span
              className={`font-mono font-bold ${
                isMuted || volume === 0 ? 'text-red-400' : 'text-cyan-400'
              }`}
            >
              {isMuted || volume === 0 ? 'Muted' : `${Math.round(volume * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolumeSliderChange}
            aria-label="Master volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isMuted || volume === 0 ? 0 : Math.round(volume * 100)}
            aria-valuetext={isMuted || volume === 0 ? 'Muted' : `${Math.round(volume * 100)}%`}
            className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-all ${
              isMuted || volume === 0
                ? 'bg-slate-800 accent-slate-500 opacity-60'
                : 'bg-slate-800 accent-cyan-400 hover:accent-cyan-300'
            }`}
          />
          <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Pitch Shift Controls */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
              Pitch Transposition
            </span>
            <span
              className={`font-mono font-bold ${semitones === 0 ? 'text-slate-300' : 'text-cyan-400'}`}
            >
              {semitones === 0
                ? '0 (Original)'
                : `${semitones > 0 ? '+' : ''}${semitones} semitones`}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => handleSemitoneChange(-1)}
              aria-label="Decrease pitch by one semitone"
              className="flex-1 min-h-[44px] py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              -1
            </button>
            <button
              type="button"
              onClick={() => setSemitones(0)}
              aria-label="Reset pitch to original key"
              className="px-2.5 min-h-[44px] py-2.5 rounded-md bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 text-xs font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
              title="Reset Pitch"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => handleSemitoneChange(1)}
              aria-label="Increase pitch by one semitone"
              className="flex-1 min-h-[44px] py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              +1
            </button>
          </div>
        </div>

        {/* Guide Vocal Level & Custom Track */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Mic className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
              Guide Vocal Level
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              {Math.round(guideVolume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={guideVolume}
            onChange={(e) => setGuideVolume(parseFloat(e.target.value))}
            aria-label="Guide vocal volume level"
            aria-valuemin={0}
            aria-valuemax={50}
            aria-valuenow={Math.round(guideVolume * 100)}
            aria-valuetext={`${Math.round(guideVolume * 100)}% guide vocal`}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-500">Muted (0%)</span>
            <span className="text-[10px] text-slate-500">Subtle (20%)</span>
            <span className="text-[10px] text-slate-500">Loud (50%)</span>
          </div>
        </div>
      </div>

      {/* Bottom Bar: Apply Mix & Custom Instrumental Upload */}
      <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleApplyAudioMix}
            disabled={isApplyingMix}
            aria-label="Apply audio mix settings to playback"
            className="w-full sm:w-auto min-h-[44px] justify-center px-3.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            {isApplyingMix ? (
              <span
                className="w-3 h-3 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin"
                role="status"
                aria-label="Applying mix"
              ></span>
            ) : (
              <Music2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Apply Audio Mix
          </button>
          <span className="text-slate-500 text-[11px]">
            Updates pitch & vocal blend in preview player
          </span>
        </div>

        <div className="w-full sm:w-auto">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInstrumentalUpload}
            accept="audio/*"
            aria-label="Upload custom instrumental audio file"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingInst}
            aria-label="Replace instrumental file"
            className="w-full sm:w-auto min-h-[44px] justify-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <Upload className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            {uploadingInst ? 'Uploading...' : 'Replace Instrumental File'}
          </button>
        </div>
      </div>
    </div>
  );
};
