/**
 * Pitch Transposition Control Component
 *
 * Provides semitone pitch shifting steppers (-12 to +12 semitones), instant key reset,
 * vocal range analysis summary badge, and launcher for the Smart Key Recommender modal.
 */

import React from 'react';
import { Sliders, Sparkles, Mic } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { VocalRangeData } from '../../types';

export interface PitchTranspositionControlProps {
  semitones: number;
  onSemitoneChange: (delta: number) => void;
  onResetPitch: () => void;
  vocalRange?: VocalRangeData | null;
  onOpenRecommender?: () => void;
  onAnalyzeVocalRange?: () => void;
  isAnalyzingRange?: boolean;
  isMixPending?: boolean;
  appliedSemitones?: number;
}

export const PitchTranspositionControl: React.FC<PitchTranspositionControlProps> = ({
  semitones,
  onSemitoneChange,
  onResetPitch,
  vocalRange,
  onOpenRecommender,
  onAnalyzeVocalRange,
  isAnalyzingRange = false,
  isMixPending,
  appliedSemitones,
}) => {
  const isPending =
    isMixPending !== undefined
      ? isMixPending
      : appliedSemitones !== undefined
        ? semitones !== appliedSemitones
        : semitones !== 0;

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-theme-surface/80 bg-slate-950/60 border border-theme-border/80 border-slate-800/80">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-theme-text-muted text-slate-400 flex items-center gap-1.5 font-medium">
          <Sliders className="w-3.5 h-3.5 text-theme-accent text-cyan-400" aria-hidden="true" />
          Pitch Transposition
        </span>
        <div className="flex items-center gap-2">
          {isPending && (
            <span
              data-testid="pitch-pending-mix-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-semibold tracking-wide"
              title="Key transposition is queued. Click 'Apply Audio Mix' below to re-process audio."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
              Pending Mix / Click Apply
            </span>
          )}
          <span
            className={`font-mono font-bold ${
              semitones === 0 ? 'text-theme-text-muted text-slate-300' : 'text-theme-accent text-cyan-400'
            }`}
          >
            {semitones === 0 ? '0 (Original)' : `${semitones > 0 ? '+' : ''}${semitones} semitones`}
          </span>
        </div>
      </div>

      {/* Steppers */}
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

      {/* Vocal Range Summary Badge & Recommender Launcher (>=44px touch target) */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 mt-1 border-t border-slate-800/60 text-xs">
        {vocalRange && vocalRange.is_voiced && vocalRange.lowest_note && vocalRange.highest_note ? (
          <div
            className="flex items-center gap-1.5 text-slate-300 text-[11px] min-w-0"
            title={`Sung range: ${vocalRange.lowest_note} to ${vocalRange.highest_note}, Estimated Key: ${vocalRange.estimated_key}`}
          >
            <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="font-mono text-cyan-300 font-semibold truncate">
              {vocalRange.lowest_note}–{vocalRange.highest_note}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400 truncate">{vocalRange.estimated_key}</span>
          </div>
        ) : vocalRange && !vocalRange.is_voiced ? (
          <span className="text-slate-500 italic text-[11px]">No vocals detected</span>
        ) : (
          <span className="text-slate-500 text-[11px]">Range unanalyzed</span>
        )}

        <button
          type="button"
          onClick={onOpenRecommender || onAnalyzeVocalRange}
          disabled={isAnalyzingRange}
          aria-label={
            vocalRange ? 'Open Smart Key Recommender' : 'Analyze vocal range or open recommender'
          }
          className="min-h-[44px] px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          <span>{isAnalyzingRange ? 'Analyzing...' : 'Smart Recommender'}</span>
        </button>
      </div>
    </div>
  );
};
