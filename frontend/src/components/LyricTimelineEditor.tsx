import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LyricLine } from '../types';
import {
  Edit3,
  Check,
  ChevronRight,
  FastForward,
  Rewind,
  AlertTriangle,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { LyricDisplay } from './LyricDisplay';

export interface LyricTimelineEditorProps {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  isPlaying?: boolean;
  onSeek: (time: number) => void;
  onSaveLines: (updatedLines: LyricLine[]) => Promise<void | boolean> | void;
  albumArtUrl?: string;
  themeSungColor?: string;
  themeUnsungColor?: string;
  onDirtyChange?: (isDirty: boolean) => void;
}

const sanitizeTimestamp = (val: number): number => {
  return isNaN(val) ? 0 : Math.max(0, parseFloat(val.toFixed(3)));
};

const formatLineTime = (t: number): string => {
  const rounded = parseFloat(t.toFixed(3));
  const str = rounded.toFixed(2);
  if (str.endsWith('0')) {
    return rounded.toFixed(1);
  }
  return str;
};

export const LyricTimelineEditor: React.FC<LyricTimelineEditorProps> = ({
  lines,
  currentTime,
  duration,
  isPlaying = false,
  onSeek,
  onSaveLines,
  albumArtUrl,
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  onDirtyChange,
}) => {
  const { toast } = useToast();
  const [editableLines, setEditableLines] = useState<LyricLine[]>(lines);
  const [initialLines, setInitialLines] = useState<LyricLine[]>(lines);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  const discardModalRef = useFocusTrap<HTMLDivElement>({
    isOpen: showDiscardModal,
    onClose: () => setShowDiscardModal(false),
  });

  // Compute dirty state via deep JSON equality
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(editableLines) !== JSON.stringify(initialLines);
  }, [editableLines, initialLines]);

  // Synchronize when parent `lines` change, but ONLY if no active unsaved changes
  const prevLinesRef = useRef(lines);
  useEffect(() => {
    if (prevLinesRef.current !== lines) {
      prevLinesRef.current = lines;
      if (!hasUnsavedChanges) {
        setEditableLines(lines);
        setInitialLines(lines);
      }
    }
  }, [lines, hasUnsavedChanges]);

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  // Browser unload guard
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved lyric timing changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // Find currently active line for list item highlight
  const activeLineIndex = editableLines.findIndex(
    (l) => currentTime >= l.start_time - 1.5 && currentTime <= l.end_time + 1.0
  );
  const currentLine = activeLineIndex >= 0 ? editableLines[activeLineIndex] : null;

  // Handle nudging an entire line by offset seconds
  const nudgeLine = (lineId: number, offset: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;

      const minStart = Math.min(l.start_time, ...l.words.map((w) => w.start_time));
      const effectiveOffset = offset < 0 ? Math.max(offset, -minStart) : offset;

      const newStart = sanitizeTimestamp(l.start_time + effectiveOffset);
      const newEnd = Math.max(newStart, sanitizeTimestamp(l.end_time + effectiveOffset));
      const newWords = l.words.map((w) => {
        const wStart = sanitizeTimestamp(w.start_time + effectiveOffset);
        const wEnd = Math.max(wStart, sanitizeTimestamp(w.end_time + effectiveOffset));
        return { ...w, start_time: wStart, end_time: wEnd };
      });

      return { ...l, start_time: newStart, end_time: newEnd, words: newWords };
    });
    setEditableLines(updated);
  };

  // Handle nudging a specific word boundary ('start_time' or 'end_time')
  const nudgeWordBoundary = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;

        const proposed = targetWord.start_time + delta;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, proposed))
        );
      } else {
        const minAllowed = targetWord.start_time;
        const proposed = targetWord.end_time + delta;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, proposed));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle nudging an entire word (both start and end)
  const nudgeWord = (lineId: number, wordIndex: number, delta: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      const dur = sanitizeTimestamp(targetWord.end_time - targetWord.start_time);
      const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
      const nextWordStart =
        wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;

      const proposedStart = targetWord.start_time + delta;
      const clampedStart = sanitizeTimestamp(
        Math.min(nextWordStart, Math.max(prevWordStart, proposedStart))
      );
      targetWord.start_time = clampedStart;
      targetWord.end_time = sanitizeTimestamp(clampedStart + dur);

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle editing a single word timing with monotonic clamping
  const updateWordTiming = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => {
    const safeValue = sanitizeTimestamp(value);
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, safeValue))
        );
      } else {
        const minAllowed = targetWord.start_time;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, safeValue));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Save changes with async guard
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveLines(editableLines);
      setInitialLines(editableLines);
      toast.success('Lyric timing changes saved');
    } catch (err) {
      console.error('Failed to save lyric timings:', err);
      toast.error('Failed to save lyric timings');
    } finally {
      setIsSaving(false);
    }
  };

  // Discard changes and revert to initialLines
  const handleConfirmDiscard = () => {
    setEditableLines(initialLines);
    setShowDiscardModal(false);
    toast.info('Lyric edits discarded');
  };

  return (
    <div className="space-y-6">
      {/* 1. Live Karaoke Stage Preview (Feature 43: LyricDisplay) */}
      <LyricDisplay
        lines={editableLines}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        onSeek={onSeek}
        albumArtUrl={albumArtUrl}
        themeSungColor={themeSungColor}
        themeUnsungColor={themeUnsungColor}
      />

      {/* 2. Visual Timeline & Precision Word Editor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-cyan-400" />
              Word-by-Word Timeline Editor
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any line to jump audio. Nudge words or lines to fine-tune sync with the beat.
            </p>
          </div>
          {hasUnsavedChanges && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(true)}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Timing Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Scrollable list of lines */}
        <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
          {editableLines.map((line) => {
            const isCurrentlyActive = currentLine?.id === line.id;
            const isExpanded = selectedLineId === line.id;

            return (
              <div
                key={line.id}
                className={`p-3 rounded-xl border transition-all ${
                  isCurrentlyActive
                    ? 'bg-cyan-950/40 border-cyan-500/70 shadow-md'
                    : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onSeek(line.start_time);
                      setSelectedLineId(isExpanded ? null : line.id);
                    }}
                    aria-label={`Select line: ${line.text} (${formatLineTime(line.start_time)}s to ${formatLineTime(line.end_time)}s)`}
                    className="flex items-center gap-3 cursor-pointer flex-1 overflow-hidden text-left bg-transparent border-0 p-0 focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded"
                  >
                    <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded shrink-0">
                      {formatLineTime(line.start_time)}s - {formatLineTime(line.end_time)}s
                    </span>
                    <span
                      className={`text-sm font-semibold truncate ${
                        isCurrentlyActive ? 'text-cyan-300 font-bold' : 'text-slate-200'
                      }`}
                    >
                      {line.text}
                    </span>
                  </button>

                  {/* Nudge & Expand Controls (Feature 44: Dual-Step Line Nudging) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Coarse Earlier: -0.2s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, -0.2)}
                      aria-label={`Nudge line ${line.id} 0.2s earlier`}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Coarse nudge 0.2s earlier"
                    >
                      <Rewind className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    {/* Fine Earlier: -0.05s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, -0.05)}
                      aria-label={`Nudge line ${line.id} 0.05s earlier`}
                      className="px-1.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-cyan-400 font-mono text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Fine nudge 0.05s earlier"
                    >
                      -0.05s
                    </button>

                    {/* Fine Later: +0.05s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, 0.05)}
                      aria-label={`Nudge line ${line.id} 0.05s later`}
                      className="px-1.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-cyan-400 font-mono text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Fine nudge 0.05s later"
                    >
                      +0.05s
                    </button>

                    {/* Coarse Later: +0.2s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, 0.2)}
                      aria-label={`Nudge line ${line.id} 0.2s later`}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Coarse nudge 0.2s later"
                    >
                      <FastForward className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    {/* Expand / Collapse */}
                    <button
                      type="button"
                      onClick={() => setSelectedLineId(isExpanded ? null : line.id)}
                      aria-label={
                        isExpanded
                          ? `Collapse word timings for line ${line.id}`
                          : `Expand word timings for line ${line.id}`
                      }
                      aria-expanded={isExpanded}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400 ml-1"
                      title="Expand word timings"
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                {/* Expanded Word-Level Timing Inputs (Feature 44: Word Steppers & Whole-Word Shift) */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {line.words.map((w, wIdx) => (
                      <div
                        key={wIdx}
                        className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            onClick={() => onSeek(w.start_time)}
                            className="font-bold text-white cursor-pointer hover:text-cyan-400 truncate mr-2"
                            title={`Click to seek to word: ${w.word}`}
                          >
                            {w.word}
                          </span>
                          {/* Word Shift Pill */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => nudgeWord(line.id, wIdx, -0.05)}
                              aria-label={`Nudge word ${w.word} 0.05s earlier`}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              title="Shift word 0.05s earlier"
                            >
                              ◀
                            </button>
                            <button
                              type="button"
                              onClick={() => nudgeWord(line.id, wIdx, 0.05)}
                              aria-label={`Nudge word ${w.word} 0.05s later`}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
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
                              onClick={() => nudgeWordBoundary(line.id, wIdx, 'start_time', -0.05)}
                              aria-label={`Nudge start of word ${w.word} 0.05s earlier`}
                              className="w-5 h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              step="0.05"
                              value={w.start_time}
                              onChange={(e) =>
                                updateWordTiming(
                                  line.id,
                                  wIdx,
                                  'start_time',
                                  parseFloat(e.target.value)
                                )
                              }
                              aria-label={`Start time for word ${w.word}`}
                              className="w-14 h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            />
                            <button
                              type="button"
                              onClick={() => nudgeWordBoundary(line.id, wIdx, 'start_time', 0.05)}
                              aria-label={`Nudge start of word ${w.word} 0.05s later`}
                              className="w-5 h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            >
                              +
                            </button>
                          </div>

                          <span className="text-slate-500 font-bold">to</span>

                          {/* End Time Stepper */}
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => nudgeWordBoundary(line.id, wIdx, 'end_time', -0.05)}
                              aria-label={`Nudge end of word ${w.word} 0.05s earlier`}
                              className="w-5 h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              step="0.05"
                              value={w.end_time}
                              onChange={(e) =>
                                updateWordTiming(
                                  line.id,
                                  wIdx,
                                  'end_time',
                                  parseFloat(e.target.value)
                                )
                              }
                              aria-label={`End time for word ${w.word}`}
                              className="w-14 h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            />
                            <button
                              type="button"
                              onClick={() => nudgeWordBoundary(line.id, wIdx, 'end_time', 0.05)}
                              aria-label={`Nudge end of word ${w.word} 0.05s later`}
                              className="w-5 h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Discard Changes Confirmation Modal (Feature 45: Focus Trapped) */}
      {showDiscardModal && (
        <div
          ref={discardModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-dialog-title"
          aria-describedby="discard-dialog-desc"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <h3 id="discard-dialog-title" className="text-base font-bold text-white">
                Discard Unsaved Timing Changes?
              </h3>
            </div>
            <p id="discard-dialog-desc" className="text-xs text-slate-300 leading-relaxed">
              You have made modifications to lyric timing boundaries that have not been saved to the
              server. Discarding will revert all line and word timings back to the last saved state.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 focus:outline-none focus:ring-2 focus:ring-rose-400"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
