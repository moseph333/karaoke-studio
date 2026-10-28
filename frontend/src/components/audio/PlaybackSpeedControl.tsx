/**
 * Playback Speed Control Component
 *
 * Compact speed selector (0.5x – 1.5x) with radiogroup semantics and roving focus.
 */

import React, { useRef } from 'react';
import { Gauge } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5] as const;

export interface PlaybackSpeedControlProps {
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  className?: string;
}

export const PlaybackSpeedControl: React.FC<PlaybackSpeedControlProps> = ({
  playbackRate,
  onPlaybackRateChange,
  className = '',
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = PLAYBACK_SPEEDS.findIndex((r) => Math.abs(playbackRate - r) < 0.01);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
      next = Math.min(PLAYBACK_SPEEDS.length - 1, index + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, index - 1);
    if (next >= 0 && next !== index) {
      e.preventDefault();
      e.stopPropagation();
      onPlaybackRateChange(PLAYBACK_SPEEDS[next]);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle p-0.5',
        className
      )}
    >
      <span className="flex items-center pl-1.5 pr-0.5 text-theme-text-muted" aria-hidden="true">
        <Gauge className="h-3.5 w-3.5" />
      </span>
      <div role="radiogroup" aria-label="Playback speed" className="flex items-center gap-0.5">
        {PLAYBACK_SPEEDS.map((rate, index) => {
          const isSelected = index === selectedIndex;
          const label = rate === 1.0 ? '1.0x (Normal)' : `${rate}x`;
          return (
            <Tooltip key={rate} content={`Playback speed: ${label}`} position="top">
              <button
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Playback speed ${rate}x`}
                tabIndex={isSelected || (selectedIndex < 0 && rate === 1.0) ? 0 : -1}
                onClick={() => onPlaybackRateChange(rate)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={cn(
                  'min-h-[36px] min-w-[36px] md:min-h-[30px] rounded-theme-md px-2 font-mono text-[11px] font-semibold tabular-nums transition-colors',
                  isSelected
                    ? 'bg-theme-accent text-theme-accent-text shadow-theme-sm'
                    : 'text-theme-text-muted hover:bg-theme-surface-raised hover:text-theme-text',
                  focusRing
                )}
              >
                {rate}x
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};
