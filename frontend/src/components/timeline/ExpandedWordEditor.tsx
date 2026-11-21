/**
 * Expanded Word Editor Component
 *
 * Renders precision word-level steppers (+/-0.05s) for word start and end boundaries,
 * whole-word shift buttons, and snap-to-playhead actions for fine-grained alignment.
 */

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Scissors } from 'lucide-react';
import { LyricLine, WordTiming } from '../../types';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

export interface ActiveWordLocation {
  lineId: number;
  wordIndex: number;
  word: WordTiming;
}

export interface ExpandedWordEditorProps {
  line: LyricLine;
  activeWordLoc: ActiveWordLocation | null;
  currentTime?: number;
  /** Live playback clock; snapping falls back to `currentTime` when omitted. */
  getCurrentTime?: () => number;
  onWordClick: (w: WordTiming) => void;
  onNudgeWord: (lineId: number, wordIndex: number, delta: number) => void;
  onNudgeWordBoundary: (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => void;
  onUpdateWordTiming: (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => void;
  /** Splits the line after a word; offered on every word but the last. */
  onSplitAfterWord?: (lineId: number, wordIndex: number) => void;
}

const shiftButton = cn(
  'flex min-h-[44px] min-w-[44px] items-center justify-center bg-theme-surface-raised p-2 text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text md:min-h-[30px] md:min-w-[30px] md:p-1',
  focusRing
);

const stepButton = (edge: 'l' | 'r') =>
  cn(
    'flex h-8 w-8 min-h-[44px] min-w-[44px] items-center justify-center bg-theme-surface-raised text-sm font-bold text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text sm:h-6 sm:w-6 sm:min-h-0 sm:min-w-0',
    edge === 'l' ? '' : '',
    focusRing
  );

const timeInput =
  'h-8 w-16 min-h-[44px] border-y border-theme-border-subtle bg-theme-bg p-0.5 text-center text-xs tabular-nums text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-focus sm:h-6 sm:w-14 sm:min-h-0';

/**
 * A word boundary typed in seconds. What is typed stays a draft and is committed, clamped to
 * the neighbouring words, on Enter or when the field loses focus; Escape restores the value.
 * (Committing every keystroke clamped "12.75" to the neighbour after its first digit and
 * added an undo step per character.) The arrow keys still step and apply at once: 0.05 s,
 * with Shift 0.20 s, like the nudge buttons.
 */
const WordTimeInput: React.FC<{
  value: number;
  label: string;
  clamp: (seconds: number) => number;
  onCommit: (seconds: number) => void;
}> = ({ value, label, clamp, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const typed = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(typed)) onCommit(clamp(typed));
  };

  return (
    <input
      type="number"
      step="0.05"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const typed = draft === null ? NaN : parseFloat(draft);
          const base = Number.isFinite(typed) ? typed : value;
          const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.2 : 0.05);
          setDraft(null);
          onCommit(clamp(Math.round((base + step) * 100) / 100));
        }
      }}
      aria-label={label}
      className={timeInput}
    />
  );
};

const snapButton = cn(
  'flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-1 border border-theme-accent px-2 py-1.5 text-xs font-semibold text-theme-text transition-colors sm:min-h-0 sm:min-w-0',
  focusRing
);

export const ExpandedWordEditor: React.FC<ExpandedWordEditorProps> = ({
  line,
  activeWordLoc,
  currentTime,
  getCurrentTime,
  onWordClick,
  onNudgeWord,
  onNudgeWordBoundary,
  onUpdateWordTiming,
  onSplitAfterWord,
}) => {
  const playhead = () => {
    const live = getCurrentTime?.();
    return typeof live === 'number' && Number.isFinite(live) ? live : (currentTime ?? 0);
  };
  // A word ends no later than the next one starts. The last word has no such limit: the line
  // ends where its last word does, so capping it at `line.end_time` would only let it shrink
  const endLimit = (wordIndex: number) =>
    wordIndex < line.words.length - 1 ? line.words[wordIndex + 1].start_time : Infinity;
  const hasTimeProp = currentTime !== undefined && Number.isFinite(currentTime);
  // The live clock is read on click; a `currentTime` prop is also shown in the tooltips
  const canSnap = hasTimeProp || getCurrentTime !== undefined;
  const shownPlayhead = hasTimeProp ? ` (${currentTime.toFixed(2)}s)` : '';

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 border-t border-theme-border-subtle/70 pt-2.5 @md:grid-cols-2 @3xl:grid-cols-3">
      {line.words.map((w, wIdx) => {
        const isWordActive = activeWordLoc?.lineId === line.id && activeWordLoc?.wordIndex === wIdx;

        return (
          <div
            key={wIdx}
            data-testid="word-timing-card"
            data-active-word={isWordActive ? 'true' : undefined}
            className={cn(
              'flex flex-col gap-1.5 border p-2.5 text-xs transition-colors',
              isWordActive
                ? 'border-theme-accent ring-1 ring-theme-accent/30'
                : 'border-theme-border-subtle bg-theme-surface'
            )}
          >
            <div className="flex items-center justify-between">
              <span
                onClick={() => onWordClick(w)}
                className={cn(
                  'mr-2 min-w-0 cursor-pointer truncate font-semibold',
                  isWordActive ? 'text-theme-text' : 'text-theme-text hover:text-theme-accent'
                )}
                title={`Click to seek to word: ${w.word}`}
              >
                {w.word}
              </span>
              {/* Whole-word shift, and splitting the line after this word */}
              <div className="flex items-center gap-1">
                {onSplitAfterWord && wIdx < line.words.length - 1 && (
                  <button
                    type="button"
                    onClick={() => onSplitAfterWord(line.id, wIdx)}
                    aria-label={`Split line ${line.id} after word ${wIdx + 1}, ${w.word}`}
                    data-testid={`split-after-word-${line.id}-${wIdx}`}
                    className={shiftButton}
                    title="Split the line after this word"
                  >
                    <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNudgeWord(line.id, wIdx, -0.05)}
                  aria-label={`Nudge word ${w.word} 0.05s earlier`}
                  className={shiftButton}
                  title="Shift word 0.05s earlier"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onNudgeWord(line.id, wIdx, 0.05)}
                  aria-label={`Nudge word ${w.word} 0.05s later`}
                  className={shiftButton}
                  title="Shift word 0.05s later"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums text-xs sm:flex-nowrap">
              {/* Start boundary */}
              <div className="flex items-center gap-px">
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? -0.2 : -0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'start_time', delta);
                  }}
                  aria-label={`Nudge start of word ${w.word} 0.05s earlier`}
                  title="Nudge earlier (-0.05s, Shift+Click for -0.20s)"
                  className={stepButton('l')}
                >
                  -
                </button>
                <WordTimeInput
                  value={w.start_time}
                  label={`Start time for word ${w.word}`}
                  clamp={(seconds) => {
                    const prevEnd = wIdx > 0 ? line.words[wIdx - 1].end_time : 0;
                    const nextStart =
                      wIdx < line.words.length - 1 ? line.words[wIdx + 1].start_time : Infinity;
                    return Math.min(w.end_time, nextStart, Math.max(prevEnd, seconds));
                  }}
                  onCommit={(seconds) => onUpdateWordTiming(line.id, wIdx, 'start_time', seconds)}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? 0.2 : 0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'start_time', delta);
                  }}
                  aria-label={`Nudge start of word ${w.word} 0.05s later`}
                  title="Nudge later (+0.05s, Shift+Click for +0.20s)"
                  className={stepButton('r')}
                >
                  +
                </button>
              </div>

              <span className="font-sans text-theme-text-muted">to</span>

              {/* End boundary */}
              <div className="flex items-center gap-px">
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? -0.2 : -0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'end_time', delta);
                  }}
                  aria-label={`Nudge end of word ${w.word} 0.05s earlier`}
                  title="Nudge earlier (-0.05s, Shift+Click for -0.20s)"
                  className={stepButton('l')}
                >
                  -
                </button>
                <WordTimeInput
                  value={w.end_time}
                  label={`End time for word ${w.word}`}
                  clamp={(seconds) => {
                    return Math.min(endLimit(wIdx), Math.max(w.start_time, seconds));
                  }}
                  onCommit={(seconds) => onUpdateWordTiming(line.id, wIdx, 'end_time', seconds)}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? 0.2 : 0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'end_time', delta);
                  }}
                  aria-label={`Nudge end of word ${w.word} 0.05s later`}
                  title="Nudge later (+0.05s, Shift+Click for +0.20s)"
                  className={stepButton('r')}
                >
                  +
                </button>
              </div>
            </div>

            {/* Snap boundaries to the playhead (shown when the playback clock is known) */}
            {canSnap && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-theme-border-subtle/70 pt-1.5 sm:flex-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    const prevEnd = wIdx > 0 ? line.words[wIdx - 1].end_time : 0;
                    const nextStart =
                      wIdx < line.words.length - 1 ? line.words[wIdx + 1].start_time : Infinity;
                    const snappedStart = Math.min(
                      w.end_time,
                      nextStart,
                      Math.max(prevEnd, playhead())
                    );
                    onUpdateWordTiming(
                      line.id,
                      wIdx,
                      'start_time',
                      parseFloat(snappedStart.toFixed(2))
                    );
                  }}
                  aria-label={`Snap start of word ${w.word} to playhead`}
                  title={`Snap start to playhead${shownPlayhead}`}
                  className={snapButton}
                >
                  <Crosshair className="h-3 w-3" aria-hidden="true" />
                  Start to Playhead
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const snappedEnd = Math.min(endLimit(wIdx), Math.max(w.start_time, playhead()));
                    onUpdateWordTiming(
                      line.id,
                      wIdx,
                      'end_time',
                      parseFloat(snappedEnd.toFixed(2))
                    );
                  }}
                  aria-label={`Snap end of word ${w.word} to playhead`}
                  title={`Snap end to playhead${shownPlayhead}`}
                  className={snapButton}
                >
                  <Crosshair className="h-3 w-3" aria-hidden="true" />
                  End to Playhead
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
