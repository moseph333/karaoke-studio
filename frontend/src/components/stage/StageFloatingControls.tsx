/**
 * Stage Floating Controls
 *
 * Auto-hiding playback bar for the fullscreen TV stage: play/pause, scrubber, time,
 * key steppers and stage volume. View toggles stay in the StageToolbar.
 */

import React from 'react';
import { Minus, Pause, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { Slider } from '../ui/Slider';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';
import { formatTime } from '../../utils/format';

export interface StageFloatingControlsProps {
  visible: boolean;
  isPlaying: boolean;
  onTogglePlay?: () => void;
  time: number;
  duration: number;
  onSeek?: (time: number) => void;
  semitones: number;
  onPitchDown: () => void;
  onPitchUp: () => void;
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
}

const chip =
  'flex shrink-0 items-center gap-1 rounded-theme-md border border-white/10 bg-white/5 px-1 py-1';
const stepper = cn(
  'flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[calc(var(--theme-radius-md)-2px)] text-white/80 transition-colors hover:bg-white/10 hover:text-white',
  focusRing
);

export const StageFloatingControls: React.FC<StageFloatingControlsProps> = ({
  visible,
  isPlaying,
  onTogglePlay,
  time,
  duration,
  onSeek,
  semitones,
  onPitchDown,
  onPitchUp,
  volume,
  muted,
  onToggleMute,
  onVolumeChange,
}) => (
  <div
    data-testid="stage-floating-controls"
    className={cn(
      'relative z-30 mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 rounded-theme-xl border border-white/15 bg-black/55 px-3 py-2.5 text-white shadow-theme-lg backdrop-blur-xl transition-opacity duration-300 sm:flex-nowrap sm:px-4',
      visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
    )}
  >
    <button
      type="button"
      data-testid="stage-play-pause-btn"
      aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
      onClick={() => onTogglePlay?.()}
      className={cn(
        'flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-gradient-accent text-theme-accent-text shadow-theme-glow transition-transform active:scale-95',
        focusRing
      )}
    >
      {isPlaying ? (
        <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
      ) : (
        <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
      )}
    </button>

    <div className="order-first flex w-full min-w-[140px] items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
      <Slider
        label="Playback progress scrubber"
        testId="stage-scrubber"
        value={time}
        min={0}
        max={duration || 100}
        step={0.1}
        onChange={(v) => onSeek?.(v)}
        valueText={(v) => `${formatTime(v)} of ${formatTime(duration)}`}
        tone="sung"
      />
    </div>

    <div
      data-testid="stage-time-display"
      className="shrink-0 font-mono text-xs font-semibold tabular-nums text-white/80 sm:text-sm"
    >
      {formatTime(time)} / {formatTime(duration)}
    </div>

    <div className={chip} title="Key">
      <button
        type="button"
        data-testid="stage-pitch-down"
        aria-label="Lower pitch by 1 semitone"
        onClick={onPitchDown}
        className={stepper}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        data-testid="stage-pitch-display"
        className="min-w-[44px] select-none text-center font-mono text-xs font-bold tabular-nums text-theme-sung"
      >
        {semitones === 0 ? '0 st' : `${semitones > 0 ? '+' : ''}${semitones} st`}
      </span>
      <button
        type="button"
        data-testid="stage-pitch-up"
        aria-label="Raise pitch by 1 semitone"
        onClick={onPitchUp}
        className={stepper}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>

    <div className={cn(chip, 'pr-2')}>
      <button
        type="button"
        data-testid="stage-volume-btn"
        aria-label={muted ? 'Unmute master audio' : 'Mute master audio'}
        onClick={onToggleMute}
        className={stepper}
      >
        {muted || volume === 0 ? (
          <VolumeX className="h-4 w-4 text-theme-danger" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <Slider
        label="Stage master volume"
        testId="stage-volume-slider"
        value={muted ? 0 : volume}
        min={0}
        max={1}
        step={0.05}
        onChange={onVolumeChange}
        className="w-16 sm:w-24"
      />
    </div>
  </div>
);
