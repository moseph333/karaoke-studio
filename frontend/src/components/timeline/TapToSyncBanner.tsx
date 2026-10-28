/**
 * Tap-to-Sync Banner Component
 *
 * Sticky banner shown in the timeline editor during live Tap-to-Sync mode: the current
 * target line or word, the Line/Word mode switch, progress, the [T] hotkey hint and a
 * large TAP action.
 */

import React, { useMemo } from 'react';
import { Radio, X } from 'lucide-react';
import { LyricLine, WordTiming } from '../../types';
import { recalculateWordTimings } from '../../utils/lyrics';
import { TapSyncMode } from '../../utils/tapSync';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

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

const modeButton = (active: boolean) =>
  cn(
    'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[calc(var(--theme-radius-md)-2px)] px-3 py-2 text-xs font-semibold transition-colors sm:min-h-[28px] sm:min-w-0 sm:px-2.5 sm:py-0.5 sm:text-[11px]',
    active
      ? 'bg-theme-warning font-bold text-theme-text-inverse shadow-theme-sm'
      : 'text-theme-text-muted hover:text-theme-text',
    focusRing
  );

const pill = 'rounded-theme-pill border px-2 py-0.5 font-mono text-[11px] tabular-nums';

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
      className="sticky top-0 z-20 space-y-2 rounded-theme-lg border border-theme-warning/40 bg-theme-surface-raised/95 p-3 shadow-theme-lg backdrop-blur-md motion-safe:animate-fade-in sm:p-3.5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-theme-md border border-theme-warning/40 bg-theme-warning/15 p-2 text-theme-warning">
            <Radio className="h-5 w-5 motion-safe:animate-pulse" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-theme-warning">
                Live Tap-to-Sync Mode
              </span>

              <div
                role="group"
                aria-label="Tap-to-sync mode selection"
                className="inline-flex items-center rounded-theme-md border border-theme-border-subtle bg-theme-bg p-0.5"
              >
                <button
                  type="button"
                  data-testid="tap-mode-line-btn"
                  aria-label="Line sync mode"
                  aria-pressed={syncMode === 'line'}
                  onClick={() => onModeChange?.('line')}
                  className={modeButton(syncMode === 'line')}
                >
                  Line Sync
                </button>
                <button
                  type="button"
                  data-testid="tap-mode-word-btn"
                  aria-label="Word sync mode"
                  aria-pressed={syncMode === 'word'}
                  onClick={() => onModeChange?.('word')}
                  className={modeButton(syncMode === 'word')}
                >
                  Word Sync
                </button>
              </div>

              <span
                className={cn(pill, 'border-theme-border-subtle bg-theme-bg text-theme-text-muted')}
              >
                Line {targetIndex + 1} of {totalLines}
              </span>
              {syncMode === 'word' && targetLine && (
                <span
                  data-testid="word-progress-badge"
                  className={cn(
                    pill,
                    'border-theme-warning/40 bg-theme-warning/15 text-theme-warning'
                  )}
                >
                  Word {Math.min(targetWordIndex + 1, targetWords.length)} of {targetWords.length}
                </span>
              )}
            </div>

            {syncMode === 'word' ? (
              targetLine ? (
                <div className="mt-1 space-y-1">
                  <div
                    data-testid="tap-target-line-words"
                    className="flex max-w-md flex-wrap items-center gap-1.5 text-sm sm:max-w-xl"
                  >
                    {targetWords.map((w, idx) => {
                      const isTarget = idx === targetWordIndex;
                      const isPast = idx < targetWordIndex;
                      return (
                        <span
                          key={idx}
                          data-testid={isTarget ? 'tap-target-word-active' : undefined}
                          data-active-target-word={isTarget ? 'true' : undefined}
                          className={cn(
                            'rounded-theme-sm px-1.5 py-0.5 text-xs transition-colors sm:text-sm',
                            isTarget
                              ? 'bg-theme-warning font-black text-theme-text-inverse ring-2 ring-theme-warning/50'
                              : isPast
                                ? 'font-medium text-theme-text-muted line-through opacity-60'
                                : 'font-medium text-theme-text'
                          )}
                        >
                          {w.word}
                        </span>
                      );
                    })}
                  </div>
                  {targetWords[targetWordIndex] && (
                    <p className="font-mono text-[11px] text-theme-warning">
                      Active word:{' '}
                      <span className="font-bold underline" data-testid="active-word-label">
                        "{targetWords[targetWordIndex].word}"
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-0.5 max-w-md truncate text-sm font-semibold text-theme-text sm:max-w-lg">
                  All words synced!
                </p>
              )
            ) : (
              <p className="mt-0.5 max-w-md truncate text-sm font-semibold text-theme-text sm:max-w-lg">
                {targetLine ? `"${targetLine.text}"` : 'All lines synced!'}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
          <button
            type="button"
            data-testid="tap-now-btn"
            onClick={onTap}
            disabled={!targetLine}
            className={cn(
              'flex min-h-[48px] flex-1 touch-manipulation select-none items-center justify-center gap-2 rounded-theme-lg bg-gradient-accent px-6 py-3.5 text-sm font-black uppercase tracking-wide text-theme-accent-text shadow-theme-glow transition-transform active:scale-95 disabled:opacity-50 sm:min-h-[52px] sm:flex-initial sm:py-3',
              focusRing
            )}
          >
            <span>{syncMode === 'word' ? 'TAP WORD' : 'TAP NOW'}</span>
            <span className="sr-only">TAP NOW</span>
            <kbd className="hidden rounded-theme-sm border border-white/30 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] sm:inline-block">
              T
            </kbd>
          </button>
          <button
            type="button"
            data-testid="exit-tap-mode-btn"
            onClick={onExit}
            aria-label="Exit tap to sync mode"
            className={cn(
              'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-theme-lg bg-theme-surface-subtle px-3 py-2 text-xs font-semibold text-theme-text-muted transition-colors hover:bg-theme-surface hover:text-theme-text',
              focusRing
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>
      <p className="text-[11px] text-theme-text-muted">
        {syncMode === 'word'
          ? 'Play song and tap [T] when vocalist sings each word. Timings stay monotonic and non-overlapping.'
          : 'Play song and tap when vocalist starts each line. Word timings are recalculated automatically.'}
      </p>
    </div>
  );
};
