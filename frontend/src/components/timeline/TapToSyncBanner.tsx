/**
 * Tap-to-Sync Banner Component
 *
 * Sticky active banner rendered in the timeline editor during live Tap-to-Sync mode,
 * displaying current target line text, hotkey badge [T], and prominent TAP NOW action.
 */

import React from 'react';
import { Radio, X, Sparkles } from 'lucide-react';
import { LyricLine } from '../../types';

export interface TapToSyncBannerProps {
  isActive: boolean;
  targetLine: LyricLine | null;
  targetIndex: number;
  totalLines: number;
  onTap: () => void;
  onExit: () => void;
}

export const TapToSyncBanner: React.FC<TapToSyncBannerProps> = ({
  isActive,
  targetLine,
  targetIndex,
  totalLines,
  onTap,
  onExit,
}) => {
  if (!isActive) return null;

  return (
    <div
      data-testid="tap-to-sync-banner"
      className="sticky top-0 z-20 bg-gradient-to-r from-amber-500/20 via-cyan-500/20 to-indigo-500/20 border border-cyan-500/40 backdrop-blur-md rounded-2xl p-3 sm:p-4 shadow-xl space-y-2 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Left: Info & Target Line Preview */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Live Tap-to-Sync Mode
              </span>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-mono">
                Line {targetIndex + 1} of {totalLines}
              </span>
            </div>
            <p className="text-sm font-semibold text-white truncate max-w-md sm:max-w-lg mt-0.5">
              {targetLine ? `"${targetLine.text}"` : 'All lines synced!'}
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0 justify-end">
          <button
            type="button"
            data-testid="tap-now-btn"
            onClick={onTap}
            disabled={!targetLine}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-black text-sm uppercase tracking-wide flex items-center gap-2 shadow-lg shadow-cyan-500/25 transition-all transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50"
          >
            <span>TAP NOW</span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-950/40 text-[10px] font-mono text-slate-950 border border-slate-950/30">
              T
            </kbd>
          </button>
          <button
            type="button"
            data-testid="exit-tap-mode-btn"
            onClick={onExit}
            aria-label="Exit tap to sync mode"
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Play song and tap when vocalist starts each line. Word timings are recalculated
        automatically.
      </p>
    </div>
  );
};
