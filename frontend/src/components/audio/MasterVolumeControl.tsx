/**
 * Master Volume Control Component
 *
 * Renders master volume slider, mute toggle button, and visual volume percentage.
 * Supports keyboard accessibility, touch targets, and mute state restoration.
 */

import React from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export interface MasterVolumeControlProps {
  volume: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onVolumeSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const MasterVolumeControl: React.FC<MasterVolumeControlProps> = ({
  volume,
  isMuted,
  onToggleMute,
  onVolumeSliderChange,
}) => {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-slate-400 font-medium">
          <Tooltip
            content={isMuted || volume === 0 ? 'Unmute audio' : 'Mute audio'}
            hotkey="M"
            position="top"
          >
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted || volume === 0 ? 'Unmute audio' : 'Mute audio'}
              aria-pressed={isMuted || volume === 0}
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
          </Tooltip>
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
      <Tooltip content="Adjust master playback volume" position="top" className="w-full">
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
          aria-valuenow={isMuted || volume === 0 ? 0 : Math.round(volume * 100)}
          aria-valuetext={isMuted || volume === 0 ? 'Muted' : `${Math.round(volume * 100)}%`}
          className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-all ${
            isMuted || volume === 0
              ? 'bg-slate-800 accent-slate-500 opacity-60'
              : 'bg-slate-800 accent-cyan-400 hover:accent-cyan-300'
          }`}
        />
      </Tooltip>
      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
};
