/**
 * Mobile Studio Sticky Transport Component (Milestone M1)
 *
 * Persistent bottom mini-player transport bar for mobile viewports (< 768px).
 * Exposes play/pause, seek scrubber, time readout, and active key/tempo quick-switch
 * to the Mix & Theme workspace tab while respecting device safe-area insets.
 */

import React from 'react';
import { Play, Pause, Sliders, RotateCcw } from 'lucide-react';
import { StudioWorkspaceTab } from '../types';

export interface MobileStudioTransportProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  activeSemitones?: number;
  semitones?: number;
  playbackRate?: number;
  onSelectTab?: (tab: StudioWorkspaceTab) => void;
  onOpenMixTab?: () => void;
  onRestart?: () => void;
  className?: string;
}

/**
 * Formats seconds into standard audio time format (M:SS).
 */
const formatTime = (secs: number): string => {
  if (isNaN(secs) || secs < 0 || !Number.isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Formats semitone offset into readable badge text.
 */
const formatKeyTranspose = (semitones = 0): string => {
  if (semitones === 0) return 'Orig Key';
  return `${semitones > 0 ? '+' : ''}${semitones} st`;
};

/**
 * Formats playback rate into readable speed badge text.
 */
const formatPlaybackSpeed = (rate = 1.0): string => {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}x`;
};

export const MobileStudioTransport: React.FC<MobileStudioTransportProps> = ({
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  activeSemitones,
  semitones,
  playbackRate = 1.0,
  onSelectTab,
  onOpenMixTab,
  onRestart,
  className = '',
}) => {
  const currentSemitones = activeSemitones ?? semitones ?? 0;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const keyText = formatKeyTranspose(currentSemitones);
  const speedText = formatPlaybackSpeed(playbackRate);

  const handleMixClick = () => {
    onOpenMixTab?.();
    onSelectTab?.('mix');
  };

  return (
    <aside
      data-testid="mobile-studio-transport"
      role="region"
      aria-label="Mobile audio playback transport"
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden bg-theme-surface/95 backdrop-blur-md border-t border-theme-border shadow-theme-lg transition-transform duration-200 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] ${className}`.trim()}
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
      }}
    >
      <div className="max-w-7xl mx-auto px-3 pt-2 pb-1.5 flex flex-col gap-1">
        {/* Scrubber Row */}
        <div className="relative w-full min-h-[36px] flex items-center group">
          {/* Visual Track Background */}
          <div className="w-full h-1.5 bg-theme-surface-raised rounded-theme-pill overflow-hidden relative">
            <div
              data-testid="mobile-scrubber-progress"
              className="h-full bg-theme-accent transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Accessible Range Input Overlay */}
          <input
            type="range"
            data-testid="mobile-scrubber"
            role="slider"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            aria-label="Audio playback scrub bar"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration) || 100}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            className="absolute inset-0 w-full min-h-[44px] opacity-0 cursor-pointer touch-none z-10"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Play/Pause button + Optional Restart */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="mobile-play-pause-btn"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
              className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-theme-pill bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text border border-theme-border flex items-center justify-center shadow-theme-sm transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-theme-accent"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
              )}
            </button>

            {onRestart && (
              <button
                type="button"
                data-testid="mobile-restart-btn"
                onClick={onRestart}
                aria-label="Restart track from beginning"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Center: Time Display */}
          <div
            data-testid="mobile-transport-time"
            className="font-mono text-xs sm:text-sm text-theme-text-muted font-medium select-none truncate"
            aria-label={`Current playback time: ${formatTime(currentTime)} of ${formatTime(duration)}`}
          >
            <span data-testid="mobile-time-display">
              <span>{formatTime(currentTime)}</span>
              <span className="mx-1 text-theme-text-muted/60"> / </span>
              <span>{formatTime(duration)}</span>
            </span>
          </div>

          {/* Right: Key Transpose & Speed Badge with quick-switch */}
          <button
            type="button"
            data-testid="mobile-mix-quick-switch"
            onClick={handleMixClick}
            aria-label={`Open Mix and Theme settings. Active key: ${keyText}, speed: ${speedText}`}
            className="min-h-[44px] px-3 py-2 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text flex items-center gap-1.5 transition-colors text-xs font-mono select-none focus:outline-none focus:ring-2 focus:ring-theme-accent shrink-0 active:scale-95"
          >
            <Sliders className="w-3.5 h-3.5 text-theme-accent" aria-hidden="true" />
            <span className="font-semibold">{keyText}</span>
            <span className="text-theme-text-muted/60">•</span>
            <span className="text-theme-text-muted">{speedText}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
