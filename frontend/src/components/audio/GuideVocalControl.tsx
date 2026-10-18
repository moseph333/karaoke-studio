/**
 * Guide Vocal Control Component
 *
 * Renders a slider and percentage display for blending the original vocal track
 * (0% to 50%) into the instrumental playback as a singing reference.
 */

import React from 'react';
import { Mic } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export interface GuideVocalControlProps {
  guideVolume: number;
  onGuideVolumeChange: (val: number) => void;
}

export const GuideVocalControl: React.FC<GuideVocalControlProps> = ({
  guideVolume,
  onGuideVolumeChange,
}) => {
  return (
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
      <Tooltip content="Adjust guide vocal blend (0%–50%)" position="top" className="w-full">
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.05}
          value={guideVolume}
          onChange={(e) => onGuideVolumeChange(parseFloat(e.target.value))}
          aria-label="Guide vocal volume level"
          aria-valuemin={0}
          aria-valuemax={50}
          aria-valuenow={Math.round(guideVolume * 100)}
          aria-valuetext={`${Math.round(guideVolume * 100)}% guide vocal`}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </Tooltip>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-slate-500">Muted (0%)</span>
        <span className="text-[10px] text-slate-500">Subtle (20%)</span>
        <span className="text-[10px] text-slate-500">Loud (50%)</span>
      </div>
    </div>
  );
};
