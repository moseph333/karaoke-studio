/**
 * Tap-to-Sync Banner Component
 *
 * Sticky banner shown in the timeline editor during live Tap-to-Sync mode: the current
 * target line or word, the Line/Word mode switch, progress, the [T] hotkey hint and a
 * large TAP action.
 */

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
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
    // Text tabs: the chosen way of tapping is underlined
    'ks-display flex min-h-[44px] min-w-[44px] items-center justify-center border-b-[3px] text-[20px] transition-colors sm:min-h-[30px] sm:min-w-0',
    active
      ? 'border-theme-accent text-theme-text'
      : 'border-transparent text-theme-text-muted hover:text-theme-text',
    focusRing
  );

const count = 'tabular-nums text-sm text-theme-text-muted';

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
      // Tap sync is on, so its band is lit: a yellow rule above and below
      className="sticky top-0 z-20 space-y-2 border-y-2 border-theme-accent bg-theme-bg py-3 motion-safe:animate-fade-in"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="ks-display text-[24px] text-theme-accent">
                Live Tap-to-Sync Mode
              </span>

              <div
                role="group"
                aria-label="Tap-to-sync mode selection"
                className="inline-flex items-center gap-4"
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

              <span className={count}>
                Line {targetIndex + 1} of {totalLines}
              </span>
              {syncMode === 'word' && targetLine && (
                <span data-testid="word-progress-badge" className={count}>
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
                            'px-1.5 py-0.5 text-base transition-colors',
                            isTarget
                              ? 'bg-theme-accent font-bold text-theme-accent-text'
                              : isPast
                                ? 'text-theme-text-muted'
                                : 'text-theme-text'
                          )}
                        >
                          {w.word}
                        </span>
                      );
                    })}
                  </div>
                  {targetWords[targetWordIndex] && (
                    <p className="text-sm text-theme-text-muted">
                      Active word:{' '}
                      <span
                        className="font-semibold text-theme-text"
                        data-testid="active-word-label"
                      >
                        "{targetWords[targetWordIndex].word}"
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-0.5 max-w-md truncate text-base font-semibold text-theme-text sm:max-w-lg">
                  All words synced!
                </p>
              )
            ) : (
              <p className="mt-0.5 max-w-md truncate text-base font-semibold text-theme-text sm:max-w-lg">
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
              'ks-display flex min-h-[48px] flex-1 touch-manipulation select-none items-center justify-center gap-2.5 bg-theme-accent px-6 text-[26px] font-black text-theme-accent-text transition-colors hover:bg-theme-accent-hover disabled:opacity-50 sm:min-h-[52px] sm:flex-initial',
              focusRing
            )}
          >
            <span>{syncMode === 'word' ? 'TAP WORD' : 'TAP NOW'}</span>
            <span className="sr-only">TAP NOW</span>
            <kbd className="hidden border border-theme-accent-text px-1.5 py-0.5 font-mono text-xs font-semibold sm:inline-block">
              T
            </kbd>
          </button>
          <button
            type="button"
            data-testid="exit-tap-mode-btn"
            onClick={onExit}
            aria-label="Exit tap to sync mode"
            className={cn(
              'ks-display flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 px-2 text-[20px] text-theme-text-muted transition-colors hover:text-theme-text',
              focusRing
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>
      <p className="text-sm text-theme-text-muted">
        {syncMode === 'word'
          ? 'Play song and tap [T] when vocalist sings each word. Timings stay monotonic and non-overlapping.'
          : 'Play song and tap when vocalist starts each line. Word timings are recalculated automatically.'}
      </p>
    </div>
  );
};
