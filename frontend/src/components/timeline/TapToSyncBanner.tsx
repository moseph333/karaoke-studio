/**
 * Tap-to-Sync Banner Component
 *
 * Sticky active banner rendered in the timeline editor during live Tap-to-Sync mode,
 * displaying current target line and word context, mode switcher (Line Sync vs. Word Sync),
 * hotkey badge [T], and prominent TAP NOW action.
 */

import React, { useMemo } from 'react';
import { Radio, X, Sparkles } from 'lucide-react';
import { LyricLine, WordTiming } from '../../types';
import { recalculateWordTimings } from '../../utils/lyrics';
import { TapSyncMode } from '../../utils/tapSync';

export interface TapToSyncBannerProps {
  isActive: boolean;
  targetLine: LyricLine | null;
  targetIndex: number;
  totalLines: number;
  onTap: () => void;
  onExit: () => void;
  syncMode?: TapSyncMode;
  onModeChange?: (mode: TapSyncMode) => void;
  targetWordIndex?: number;
}

export const TapToSyncBanner: React.FC<TapToSyncBannerProps> = ({
  isActive,
  targetLine,
  targetIndex,
  totalLines,
  onTap,
  onExit,
  syncMode = 'line',
  onModeChange,
  targetWordIndex = 0,
}) => {
  const targetWords: WordTiming[] = useMemo(() => {
    if (!targetLine) return [];
    if (targetLine.words && targetLine.words.length > 0) return targetLine.words;
    return recalculateWordTimings(targetLine.text, targetLine.start_time, targetLine.end_time);
  }, [targetLine]);

  if (!isActive) return null;

  return (
    <div
      data-testid="tap-to-sync-banner"
      className="sticky top-0 z-20 bg-gradient-to-r from-amber-500/20 via-cyan-500/20 to-indigo-500/20 border border-cyan-500/40 backdrop-blur-md rounded-2xl p-3 sm:p-4 shadow-xl space-y-2 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Left: Info & Target Line / Word Preview */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 shrink-0">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Live Tap-to-Sync Mode
              </span>

              {/* Mode Switcher (Line vs Word) */}
              <div
                role="group"
                aria-label="Tap-to-sync mode selection"
                className="inline-flex items-center rounded-lg bg-slate-900/90 border border-slate-700 p-0.5"
              >
                <button
                  type="button"
                  data-testid="tap-mode-line-btn"
                  aria-label="Line sync mode"
                  aria-pressed={syncMode === 'line'}
                  onClick={() => onModeChange?.('line')}
                  className={`px-3 py-2 sm:px-2.5 sm:py-0.5 rounded text-xs sm:text-[11px] font-semibold transition-all min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-0 flex items-center justify-center ${
                    syncMode === 'line'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Line Sync
                </button>
                <button
                  type="button"
                  data-testid="tap-mode-word-btn"
                  aria-label="Word sync mode"
                  aria-pressed={syncMode === 'word'}
                  onClick={() => onModeChange?.('word')}
                  className={`px-3 py-2 sm:px-2.5 sm:py-0.5 rounded text-xs sm:text-[11px] font-semibold transition-all min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-0 flex items-center justify-center ${
                    syncMode === 'word'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Word Sync
                </button>
              </div>

              {/* Progress Badges */}
              <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-mono">
                Line {targetIndex + 1} of {totalLines}
              </span>
              {syncMode === 'word' && targetLine && (
                <span
                  data-testid="word-progress-badge"
                  className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-mono"
                >
                  Word {Math.min(targetWordIndex + 1, targetWords.length)} of {targetWords.length}
                </span>
              )}
            </div>

            {/* Target Display: Line text or Word sequence with active highlight */}
            {syncMode === 'word' ? (
              targetLine ? (
                <div className="mt-1 space-y-1">
                  <div
                    data-testid="tap-target-line-words"
                    className="flex flex-wrap items-center gap-1.5 text-sm max-w-md sm:max-w-xl"
                  >
                    {targetWords.map((w, idx) => {
                      const isTarget = idx === targetWordIndex;
                      const isPast = idx < targetWordIndex;
                      return (
                        <span
                          key={idx}
                          data-testid={isTarget ? 'tap-target-word-active' : undefined}
                          data-active-target-word={isTarget ? 'true' : undefined}
                          className={`px-1.5 py-0.5 rounded transition-all text-xs sm:text-sm ${
                            isTarget
                              ? 'bg-amber-400 text-slate-950 font-black shadow-md ring-2 ring-amber-300 scale-105 animate-pulse'
                              : isPast
                                ? 'text-slate-400 line-through opacity-60 font-medium'
                                : 'text-slate-200 font-medium'
                          }`}
                        >
                          {w.word}
                        </span>
                      );
                    })}
                  </div>
                  {targetWords[targetWordIndex] && (
                    <p className="text-[11px] text-amber-300/90 font-mono">
                      Active word:{' '}
                      <span
                        className="font-bold text-amber-300 underline"
                        data-testid="active-word-label"
                      >
                        "{targetWords[targetWordIndex].word}"
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm font-semibold text-white truncate max-w-md sm:max-w-lg mt-0.5">
                  All words synced!
                </p>
              )
            ) : (
              <p className="text-sm font-semibold text-white truncate max-w-md sm:max-w-lg mt-0.5">
                {targetLine ? `"${targetLine.text}"` : 'All lines synced!'}
              </p>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0 justify-end w-full sm:w-auto">
          <button
            type="button"
            data-testid="tap-now-btn"
            onClick={onTap}
            disabled={!targetLine}
            className="flex-1 sm:flex-initial min-h-[48px] sm:min-h-[52px] px-6 py-3.5 sm:py-3 rounded-xl bg-gradient-to-r from-amber-500 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 transition-all transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-50 touch-manipulation select-none"
          >
            <span>{syncMode === 'word' ? 'TAP WORD' : 'TAP NOW'}</span>
            <span className="sr-only">TAP NOW</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-950/40 text-[10px] font-mono text-slate-950 border border-slate-950/30">
              T
            </kbd>
          </button>
          <button
            type="button"
            data-testid="exit-tap-mode-btn"
            onClick={onExit}
            aria-label="Exit tap to sync mode"
            className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 shrink-0"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        {syncMode === 'word'
          ? 'Play song and tap [T] when vocalist sings each word. Timings stay monotonic and non-overlapping.'
          : 'Play song and tap when vocalist starts each line. Word timings are recalculated automatically.'}
      </p>
    </div>
  );
};
