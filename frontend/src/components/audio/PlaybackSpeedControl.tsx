/**
 * Playback Speed Control Component
 *
 * Provides speed selector buttons (0.5x, 0.75x, 1.0x, 1.25x, 1.5x)
 * with radio group semantics, active styling, and touch targets >= 36px.
 */

import React from 'react';
import { Gauge } from 'lucide-react';
import { Tooltip } from '../Tooltip';

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
  return (
    <div
      className={`flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/60 border border-slate-800 ${className}`}
    >
      <div className="flex items-center gap-1 pl-2 pr-1 text-slate-400">
        <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-[11px] font-mono font-semibold hidden sm:inline">Speed</span>
      </div>
      <div role="radiogroup" aria-label="Playback speed" className="flex items-center gap-1">
        {PLAYBACK_SPEEDS.map((rate) => {
          const isSelected = Math.abs(playbackRate - rate) < 0.01;
          const label = rate === 1.0 ? '1.0x (Normal)' : `${rate}x`;
          return (
            <Tooltip key={rate} content={`Playback speed: ${label}`} position="top">
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Playback speed ${rate}x`}
                onClick={() => onPlaybackRateChange(rate)}
                className={`px-2.5 py-1 min-h-[36px] min-w-[36px] text-xs font-mono font-bold rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                  isSelected
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                }`}
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
