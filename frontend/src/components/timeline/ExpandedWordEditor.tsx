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
                  onClick={() => onNudgeWordBoundary(line.id, wIdx, 'start_time', -0.05)}
                  aria-label={`Nudge start of word ${w.word} 0.05s earlier`}
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  -
                </button>
                <input
                  type="number"
                  step="0.05"
                  value={w.start_time}
                  onChange={(e) =>
                    onUpdateWordTiming(line.id, wIdx, 'start_time', parseFloat(e.target.value))
                  }
                  aria-label={`Start time for word ${w.word}`}
                  className="w-16 h-8 sm:w-14 sm:h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => onNudgeWordBoundary(line.id, wIdx, 'start_time', 0.05)}
                  aria-label={`Nudge start of word ${w.word} 0.05s later`}
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
                  onClick={() => onNudgeWordBoundary(line.id, wIdx, 'end_time', -0.05)}
                  aria-label={`Nudge end of word ${w.word} 0.05s earlier`}
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  -
                </button>
                <input
                  type="number"
                  step="0.05"
                  value={w.end_time}
                  onChange={(e) =>
                    onUpdateWordTiming(line.id, wIdx, 'end_time', parseFloat(e.target.value))
                  }
                  aria-label={`End time for word ${w.word}`}
                  className="w-16 h-8 sm:w-14 sm:h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => onNudgeWordBoundary(line.id, wIdx, 'end_time', 0.05)}
                  aria-label={`Nudge end of word ${w.word} 0.05s later`}
                  className="w-8 h-8 sm:w-6 sm:h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
