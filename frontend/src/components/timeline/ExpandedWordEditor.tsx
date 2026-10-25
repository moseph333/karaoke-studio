/**
 * Expanded Word Editor Component
 *
 * Renders precision word-level steppers (+/-0.05s) for word start and end boundaries,
 * along with whole-word shift pills (◀/▶) for fine-grained alignment.
 */

import React from 'react';
import { LyricLine, WordTiming } from '../../types';

export interface ActiveWordLocation {
  lineId: number;
  wordIndex: number;
  word: WordTiming;
}

export interface ExpandedWordEditorProps {
  line: LyricLine;
  activeWordLoc: ActiveWordLocation | null;
  currentTime?: number;
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
}

export const ExpandedWordEditor: React.FC<ExpandedWordEditorProps> = ({
  line,
  activeWordLoc,
  currentTime,
  onWordClick,
  onNudgeWord,
  onNudgeWordBoundary,
  onUpdateWordTiming,
}) => {
  return (
    <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
      {line.words.map((w, wIdx) => {
        const isWordActive = activeWordLoc?.lineId === line.id && activeWordLoc?.wordIndex === wIdx;

        return (
          <div
            key={wIdx}
            data-active-word={isWordActive ? 'true' : undefined}
            className={`flex flex-col gap-1.5 p-2.5 rounded-lg border text-xs transition-all ${
              isWordActive
                ? 'bg-cyan-950/70 border-cyan-500 ring-1 ring-cyan-400/50 shadow-md'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                onClick={() => onWordClick(w)}
                className={`font-bold cursor-pointer truncate mr-2 ${
                  isWordActive ? 'text-cyan-300' : 'text-white hover:text-cyan-400'
                }`}
                title={`Click to seek to word: ${w.word}`}
              >
                {w.word}
              </span>
              {/* Word Shift Pill */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onNudgeWord(line.id, wIdx, -0.05)}
                  aria-label={`Nudge word ${w.word} 0.05s earlier`}
                  className="min-h-[36px] min-w-[36px] p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  title="Shift word 0.05s earlier"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => onNudgeWord(line.id, wIdx, 0.05)}
                  aria-label={`Nudge word ${w.word} 0.05s later`}
                  className="min-h-[36px] min-w-[36px] p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  title="Shift word 0.05s later"
                >
                  ▶
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
              {/* Start Time Stepper */}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? -0.2 : -0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'start_time', delta);
                  }}
                  aria-label={`Nudge start of word ${w.word} 0.05s earlier`}
                  title="Nudge earlier (-0.05s, Shift+Click for -0.20s)"
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  -
                </button>
                <input
                  type="number"
                  step="0.05"
                  value={w.start_time}
                  onChange={(e) => {
                    const rawVal = parseFloat(e.target.value);
                    if (!isNaN(rawVal)) {
                      const prevEnd = wIdx > 0 ? line.words[wIdx - 1].end_time : 0;
                      const nextStart =
                        wIdx < line.words.length - 1 ? line.words[wIdx + 1].start_time : Infinity;
                      const clamped = Math.min(w.end_time, nextStart, Math.max(prevEnd, rawVal));
                      onUpdateWordTiming(line.id, wIdx, 'start_time', clamped);
                    }
                  }}
                  aria-label={`Start time for word ${w.word}`}
                  className="w-16 h-8 sm:w-14 sm:h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? 0.2 : 0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'start_time', delta);
                  }}
                  aria-label={`Nudge start of word ${w.word} 0.05s later`}
                  title="Nudge later (+0.05s, Shift+Click for +0.20s)"
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  +
                </button>
              </div>

              <span className="text-slate-500 font-bold">to</span>

              {/* End Time Stepper */}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? -0.2 : -0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'end_time', delta);
                  }}
                  aria-label={`Nudge end of word ${w.word} 0.05s earlier`}
                  title="Nudge earlier (-0.05s, Shift+Click for -0.20s)"
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  -
                </button>
                <input
                  type="number"
                  step="0.05"
                  value={w.end_time}
                  onChange={(e) => {
                    const rawVal = parseFloat(e.target.value);
                    if (!isNaN(rawVal)) {
                      const nextStart =
                        wIdx < line.words.length - 1
                          ? line.words[wIdx + 1].start_time
                          : line.end_time || Infinity;
                      const clamped = Math.min(nextStart, Math.max(w.start_time, rawVal));
                      onUpdateWordTiming(line.id, wIdx, 'end_time', clamped);
                    }
                  }}
                  aria-label={`End time for word ${w.word}`}
                  className="w-16 h-8 sm:w-14 sm:h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    const delta = e.shiftKey ? 0.2 : 0.05;
                    onNudgeWordBoundary(line.id, wIdx, 'end_time', delta);
                  }}
                  aria-label={`Nudge end of word ${w.word} 0.05s later`}
                  title="Nudge later (+0.05s, Shift+Click for +0.20s)"
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  +
                </button>
              </div>
            </div>

            {/* Playhead Snapping Buttons (when currentTime is available) */}
            {currentTime !== undefined && Number.isFinite(currentTime) && (
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    const prevEnd = wIdx > 0 ? line.words[wIdx - 1].end_time : 0;
                    const nextStart =
                      wIdx < line.words.length - 1 ? line.words[wIdx + 1].start_time : Infinity;
                    const snappedStart = Math.min(
                      w.end_time,
                      nextStart,
                      Math.max(prevEnd, currentTime)
                    );
                    onUpdateWordTiming(
                      line.id,
                      wIdx,
                      'start_time',
                      parseFloat(snappedStart.toFixed(2))
                    );
                  }}
                  aria-label={`Snap start of word ${w.word} to playhead`}
                  title={`Snap start to playhead (${currentTime.toFixed(2)}s)`}
                  className="flex-1 py-1 px-1.5 rounded bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/50 text-[10px] font-semibold text-cyan-300 hover:text-cyan-200 transition-colors flex items-center justify-center gap-1 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  ⏱ Start to Playhead
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextStart =
                      wIdx < line.words.length - 1
                        ? line.words[wIdx + 1].start_time
                        : line.end_time || Infinity;
                    const snappedEnd = Math.min(nextStart, Math.max(w.start_time, currentTime));
                    onUpdateWordTiming(
                      line.id,
                      wIdx,
                      'end_time',
                      parseFloat(snappedEnd.toFixed(2))
                    );
                  }}
                  aria-label={`Snap end of word ${w.word} to playhead`}
                  title={`Snap end to playhead (${currentTime.toFixed(2)}s)`}
                  className="flex-1 py-1 px-1.5 rounded bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/50 text-[10px] font-semibold text-cyan-300 hover:text-cyan-200 transition-colors flex items-center justify-center gap-1 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  ⏱ End to Playhead
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
