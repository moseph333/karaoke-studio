/**
 * Transport Dock
 *
 * The studio's single playback surface: owns the master <audio> element, play/pause,
 * restart, the waveform scrubber, playback speed, master volume and a key/mix shortcut.
 * Renders as a fixed mini-player on mobile and an in-flow dock on desktop, so every
 * control exists exactly once in the DOM.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SlidersHorizontal, ChevronUp } from 'lucide-react';
import { WaveformScrubber, LyricLine as WaveformLine } from '../audio/WaveformScrubber';
import { PlaybackSpeedControl } from '../audio/PlaybackSpeedControl';
import { MasterVolumeControl } from '../audio/MasterVolumeControl';
import { AudioPlaybackErrorBanner } from '../audio/AudioPlaybackErrorBanner';
import { IconButton } from '../ui/IconButton';
import { Spinner } from '../ui/Spinner';
import { Tooltip } from '../Tooltip';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { formatRate, formatSemitones, formatTime } from '../../utils/format';
import { parseMediaError, type AudioPlaybackError } from '../../utils/audioErrors';
import {
  getStoredMasterMuted,
  getStoredMasterVolume,
  setStoredMasterMuted,
  setStoredMasterVolume,
} from '../../utils/volumeStorage';
import { useInterpolatedTime } from '../../hooks/useInterpolatedTime';
import { useMediaSession } from '../../hooks/useMediaSession';
import { lineStartAtOffset } from '../../utils/lineNavigation';

export interface TransportDockProps {
  masterAudioUrl?: string;
  lines?: WaveformLine[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onTimeUpdate?: () => void;
  onLoadedMetadata?: () => void;
  onEnded?: () => void;
  onPlaybackError?: (error: AudioPlaybackError) => void;
  onRetryPlayback?: () => void;
  initialVolume?: number;
  initialMuted?: boolean;
  onVolumeChange?: (volume: number) => void;
  onMuteChange?: (isMuted: boolean) => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Requested key offset shown on the key chip. */
  semitones?: number;
  /** True while the server re-renders the master mix. */
  isRemixing?: boolean;
  /** Opens the key / mix settings (mobile Mix tab or desktop inspector). */
  onOpenMixSettings?: () => void;
  peaks?: number[] | null;
  /** Song details for the OS media controls (lock screen, media keys). */
  mediaTitle?: string;
  mediaArtist?: string;
  mediaArtworkUrl?: string;
  className?: string;
}

interface TransportProgressProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  audioRef: React.RefObject<HTMLAudioElement>;
  onSeek: (time: number) => void;
  masterAudioUrl?: string;
  lines?: WaveformLine[];
  peaks?: number[] | null;
  className?: string;
}

/** Re-renders at frame rate while playing, isolated from the rest of the dock. */
const TransportProgress: React.FC<TransportProgressProps> = ({
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  audioRef,
  onSeek,
  masterAudioUrl,
  lines,
  peaks,
  className,
}) => {
  const smoothTime = useInterpolatedTime({ currentTime, isPlaying, playbackRate, audioRef });
  const maxTime = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const shownTime = Math.min(maxTime, Number.isFinite(smoothTime) ? Math.max(0, smoothTime) : 0);
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span
        data-testid="transport-time"
        className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-theme-text"
      >
        {formatTime(shownTime)}
      </span>
      <WaveformScrubber
        currentTime={shownTime}
        duration={duration}
        onSeek={onSeek}
        audioUrl={masterAudioUrl}
        lines={lines}
        peaks={peaks}
        showMarkers
        isPlaying={isPlaying}
        className="h-11 flex-1"
      />
      <span
        data-testid="transport-duration"
        className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-theme-text-muted"
      >
        {formatTime(duration)}
      </span>
    </div>
  );
};

export const TransportDock: React.FC<TransportDockProps> = ({
  masterAudioUrl,
  lines,
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  audioRef,
  onTimeUpdate,
  onLoadedMetadata,
  onEnded,
  onPlaybackError,
  onRetryPlayback,
  initialVolume,
  initialMuted,
  onVolumeChange,
  onMuteChange,
  playbackRate: propPlaybackRate,
  onPlaybackRateChange,
  semitones = 0,
  isRemixing = false,
  onOpenMixSettings,
  peaks,
  mediaTitle,
  mediaArtist,
  mediaArtworkUrl,
  className,
}) => {
  const dockRef = useRef<HTMLElement>(null);
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedAudioRef = (audioRef ?? internalAudioRef) as React.RefObject<HTMLAudioElement>;
  const [playbackError, setPlaybackError] = useState<AudioPlaybackError | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(propPlaybackRate ?? 1.0);
  const [extrasOpen, setExtrasOpen] = useState(false);

  const [volume, setVolume] = useState<number>(() =>
    initialVolume !== undefined && !isNaN(initialVolume)
      ? Math.max(0, Math.min(1, initialVolume))
      : getStoredMasterVolume(1.0)
  );
  const [isMuted, setIsMuted] = useState<boolean>(() =>
    initialMuted !== undefined ? initialMuted : getStoredMasterMuted(false)
  );
  const previousVolumeRef = useRef<number>(volume > 0 ? volume : 1.0);

  useEffect(() => {
    if (propPlaybackRate !== undefined && !isNaN(propPlaybackRate)) {
      setPlaybackRate(propPlaybackRate);
    }
  }, [propPlaybackRate]);

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

  // Keep the media element in sync with volume, mute and rate (also after source swaps)
  useEffect(() => {
    const el = resolvedAudioRef.current;
    if (el) {
      el.volume = volume;
      el.muted = isMuted;
      el.playbackRate = playbackRate;
    }
  }, [resolvedAudioRef, masterAudioUrl, volume, isMuted, playbackRate]);

  useEffect(() => {
    setPlaybackError(null);
  }, [masterAudioUrl]);

  // Media keys, headset buttons and the lock screen drive the transport; previous/next
  // track step through lyric lines.
  const elementTime = () => resolvedAudioRef.current?.currentTime ?? currentTime;
  const seekLine = (offset: -1 | 1) => {
    const steps = (lines ?? []).map((l) => ({
      start_time: l.start_time ?? l.start ?? 0,
      end_time: l.end_time ?? l.end ?? 0,
    }));
    const target = lineStartAtOffset(steps, elementTime(), offset);
    if (target !== null) onSeek(target);
  };
  useMediaSession({
    enabled: Boolean(masterAudioUrl),
    title: mediaTitle,
    artist: mediaArtist,
    artworkUrl: mediaArtworkUrl,
    isPlaying,
    duration,
    playbackRate,
    getCurrentTime: elementTime,
    audioRef: resolvedAudioRef,
    onPlay: () => {
      if (!isPlaying) onTogglePlay();
    },
    onPause: () => {
      if (isPlaying) onTogglePlay();
    },
    onSeek,
    onPreviousLine: () => seekLine(-1),
    onNextLine: () => seekLine(1),
  });

  // Publish the dock height (--dock-height) so page padding and toasts clear the dock
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const update = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty('--dock-height', `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--dock-height');
    };
  }, []);

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (resolvedAudioRef.current) resolvedAudioRef.current.playbackRate = rate;
    onPlaybackRateChange?.(rate);
  };

  const handleAudioError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    const parsed = parseMediaError(e.currentTarget.error);
    setPlaybackError(parsed);
    if (isPlaying) onTogglePlay();
    onPlaybackError?.(parsed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('karaoke_audio_error', { detail: parsed }));
    }
  };

  const handleAudioVolumeChange = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const el = e.currentTarget;
    if (el.volume !== volume) {
      setVolume(el.volume);
      if (el.volume > 0) previousVolumeRef.current = el.volume;
      setStoredMasterVolume(el.volume);
      onVolumeChange?.(el.volume);
    }
    if (el.muted !== isMuted) {
      setIsMuted(el.muted);
      setStoredMasterMuted(el.muted);
      onMuteChange?.(el.muted);
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
    if (isMuted && clamped > 0) {
      setIsMuted(false);
      setStoredMasterMuted(false);
      if (resolvedAudioRef.current) resolvedAudioRef.current.muted = false;
      onMuteChange?.(false);
    }
  };

  const handleToggleMute = useCallback(() => {
    const el = resolvedAudioRef.current;
    if (isMuted || volume === 0) {
      const restored = previousVolumeRef.current > 0 ? previousVolumeRef.current : 1.0;
      setIsMuted(false);
      setStoredMasterMuted(false);
      setVolume(restored);
      setStoredMasterVolume(restored);
      if (el) {
        el.muted = false;
        el.volume = restored;
      }
      onMuteChange?.(false);
      onVolumeChange?.(restored);
    } else {
      if (volume > 0) previousVolumeRef.current = volume;
      setIsMuted(true);
      setStoredMasterMuted(true);
      if (el) el.muted = true;
      onMuteChange?.(true);
    }
  }, [isMuted, volume, onMuteChange, onVolumeChange, resolvedAudioRef]);

  // Global M shortcut (useKeyboardShortcuts dispatches karaoke_toggle_mute)
  useEffect(() => {
    const onGlobalToggle = () => handleToggleMute();
    window.addEventListener('karaoke_toggle_mute', onGlobalToggle);
    return () => window.removeEventListener('karaoke_toggle_mute', onGlobalToggle);
  }, [handleToggleMute]);

  const handleRetryPlayback = () => {
    setPlaybackError(null);
    const el = resolvedAudioRef.current;
    if (el) {
      el.load();
      el.volume = volume;
      el.muted = isMuted;
      el.playbackRate = playbackRate;
      if (currentTime > 0) el.currentTime = currentTime;
      el.play()?.catch(() => {});
    }
    onRetryPlayback?.();
  };

  const keyText = formatSemitones(semitones, 'Orig key');
  const speedText = formatRate(playbackRate);

  return (
    <section
      ref={dockRef}
      data-testid="transport-dock"
      aria-label="Playback transport"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-theme-border-subtle ks-glass shadow-theme-lg',
        'md:static md:z-auto md:mx-3 md:mb-3 md:rounded-theme-xl md:border lg:mx-6',
        className
      )}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
    >
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

      {isRemixing && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 overflow-hidden md:inset-x-4 md:rounded-full"
        >
          <div className="h-full w-1/3 bg-gradient-accent motion-safe:animate-pulse" />
        </div>
      )}

      {playbackError && (
        <div className="px-3 pt-2 md:px-4">
          <AudioPlaybackErrorBanner
            playbackError={playbackError}
            onRetryPlayback={handleRetryPlayback}
          />
        </div>
      )}

      <div
        className={cn(
          'grid items-center gap-x-3 gap-y-1.5 px-3 pt-2 md:px-4 md:py-3',
          'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"progress_progress""primary_secondary""extras_extras"]',
          'md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-4 md:[grid-template-areas:"primary_progress_secondary""extras_extras_extras"]',
          'xl:grid-cols-[auto_minmax(0,1fr)_auto_auto] xl:[grid-template-areas:"primary_progress_extras_secondary"]'
        )}
      >
        <TransportProgress
          className="[grid-area:progress]"
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          audioRef={resolvedAudioRef}
          onSeek={onSeek}
          masterAudioUrl={masterAudioUrl}
          lines={lines}
          peaks={peaks}
        />

        <div className="flex items-center gap-1.5 [grid-area:primary]">
          <IconButton
            icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
            label="Restart track from beginning"
            onClick={() => onSeek(0)}
          />
          <Tooltip
            content={isPlaying ? 'Pause playback' : 'Start playback'}
            hotkey="Space"
            position="top"
          >
            <button
              type="button"
              data-testid="transport-play-pause-btn"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
              className={cn(
                'inline-flex h-12 w-12 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-pill bg-gradient-accent text-theme-accent-text shadow-theme-glow transition-transform hover:brightness-110 active:scale-95',
                focusRing
              )}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center justify-end gap-1.5 [grid-area:secondary]">
          <button
            type="button"
            data-testid="transport-key-chip"
            onClick={onOpenMixSettings}
            aria-label={`Open mix settings. Active key: ${keyText}, speed: ${speedText}`}
            className={cn(
              'inline-flex min-h-[44px] md:min-h-[36px] items-center gap-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle px-2.5 text-xs font-semibold text-theme-text transition-colors hover:border-theme-border hover:bg-theme-surface-raised',
              focusRing
            )}
          >
            {isRemixing ? (
              <Spinner className="h-3.5 w-3.5 text-theme-highlight" />
            ) : (
              <SlidersHorizontal className="h-3.5 w-3.5 text-theme-highlight" aria-hidden="true" />
            )}
            <span className="font-mono tabular-nums">{isRemixing ? 'Re-pitching…' : keyText}</span>
            <span className="text-theme-text-muted" aria-hidden="true">
              ·
            </span>
            <span className="font-mono tabular-nums text-theme-text-muted">{speedText}</span>
          </button>
          <button
            type="button"
            data-testid="transport-more-toggle"
            onClick={() => setExtrasOpen((o) => !o)}
            aria-expanded={extrasOpen}
            aria-controls="transport-extras"
            aria-label={extrasOpen ? 'Hide speed and volume' : 'Show speed and volume'}
            className={cn(
              'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-md text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text xl:hidden',
              focusRing
            )}
          >
            <ChevronUp
              className={cn('h-4 w-4 transition-transform', !extrasOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        </div>

        <div
          id="transport-extras"
          data-testid="transport-extras"
          className={cn(
            'flex-wrap items-center justify-between gap-2 [grid-area:extras] md:justify-end xl:flex',
            extrasOpen ? 'flex' : 'hidden'
          )}
        >
          <PlaybackSpeedControl
            playbackRate={playbackRate}
            onPlaybackRateChange={handlePlaybackRateChange}
          />
          <MasterVolumeControl
            volume={volume}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
            onVolumeSliderChange={handleVolumeSliderChange}
          />
        </div>
      </div>
    </section>
  );
};
