/**
 * Master Volume Control Component
 *
 * Compact mute toggle + volume slider used by the transport dock. Supports keyboard
 * accessibility, 44px touch targets on mobile and mute state restoration.
 */

import React from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

export interface MasterVolumeControlProps {
  volume: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onVolumeSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

export const MasterVolumeControl: React.FC<MasterVolumeControlProps> = ({
  volume,
  isMuted,
  onToggleMute,
  onVolumeSliderChange,
  className,
}) => {
  const silent = isMuted || volume === 0;
  const pct = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div data-testid="master-volume-control" className={cn('flex items-center gap-1', className)}>
      <Tooltip content={silent ? 'Unmute audio' : 'Mute audio'} hotkey="M" position="top">
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={silent ? 'Unmute audio' : 'Mute audio'}
          aria-pressed={silent}
          className={cn(
            'inline-flex min-h-[44px] min-w-[44px] md:min-h-[36px] md:min-w-[36px] items-center justify-center rounded-theme-md transition-colors hover:bg-theme-surface-subtle',
            silent ? 'text-theme-danger' : 'text-theme-text-muted hover:text-theme-text',
            focusRing
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Adjust master playback volume" position="top" className="w-24 lg:w-28">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={onVolumeSliderChange}
          aria-label="Master volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={silent ? 0 : pct}
          aria-valuetext={silent ? 'Muted' : `${pct}%`}
          style={
            {
              '--ks-range-fill': `${silent ? 0 : pct}%`,
              '--ks-range-color': silent
                ? 'rgb(var(--theme-text-muted-rgb))'
                : 'rgb(var(--theme-accent-rgb))',
            } as React.CSSProperties
          }
          className={cn('ks-range min-h-[44px] md:min-h-[28px] w-full', silent && 'opacity-70')}
        />
      </Tooltip>
      <span
        className={cn(
          'hidden w-10 shrink-0 text-right font-mono text-[11px] tabular-nums xl:inline',
          silent ? 'text-theme-danger' : 'text-theme-text-muted'
        )}
      >
        {silent ? 'Muted' : `${pct}%`}
      </span>
    </div>
  );
};
