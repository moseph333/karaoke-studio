/**
 * Pitch Transposition Control Component
 *
 * Provides semitone pitch shifting steppers (-12 to +12 semitones) and an instant
 * key reset control to restore the original song key.
 */

import React from 'react';
import { Sliders } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export interface PitchTranspositionControlProps {
  semitones: number;
  onSemitoneChange: (delta: number) => void;
  onResetPitch: () => void;
}

export const PitchTranspositionControl: React.FC<PitchTranspositionControlProps> = ({
  semitones,
  onSemitoneChange,
  onResetPitch,
}) => {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          Pitch Transposition
        </span>
        <span
          className={`font-mono font-bold ${semitones === 0 ? 'text-slate-300' : 'text-cyan-400'}`}
        >
          {semitones === 0 ? '0 (Original)' : `${semitones > 0 ? '+' : ''}${semitones} semitones`}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <Tooltip content="Lower key by 1 semitone (-12 min)" position="top" className="flex-1">
          <button
            type="button"
            onClick={() => onSemitoneChange(-1)}
            aria-label="Decrease pitch by one semitone"
            className="w-full min-h-[44px] py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            -1
          </button>
        </Tooltip>

        <Tooltip content="Reset pitch to original key (0 semitones)" position="top">
          <button
            type="button"
            onClick={onResetPitch}
            aria-label="Reset pitch to original key"
            className="px-2.5 min-h-[44px] py-2.5 rounded-md bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 text-xs font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            Reset
          </button>
        </Tooltip>

        <Tooltip content="Raise key by 1 semitone (+12 max)" position="top" className="flex-1">
          <button
            type="button"
            onClick={() => onSemitoneChange(1)}
            aria-label="Increase pitch by one semitone"
            className="w-full min-h-[44px] py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm font-bold flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            +1
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
