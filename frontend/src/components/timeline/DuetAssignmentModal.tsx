/**
 * Duet Assignment Modal Component
 *
 * Focus-trapped dialog allowing users to bulk-assign lyric lines to singer roles
 * via range selection, alternating line patterns (1x1, 2x2), or automated
 * pause-clustering auto-split (>= 2.5s gaps), with live distribution previews.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Users, X, Shuffle, Sliders, Sparkles, Check } from 'lucide-react';
import { LyricLine, SingerRole, BulkAssignOptions } from '../../types';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export type { BulkAssignOptions };

export interface DuetAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: LyricLine[];
  onApply: (options: BulkAssignOptions) => void;
  selectedLineIndex?: number;
}

export const DuetAssignmentModal: React.FC<DuetAssignmentModalProps> = ({
  isOpen,
  onClose,
  lines,
  onApply,
  selectedLineIndex = 0,
}) => {
  const [mode, setMode] = useState<'range' | 'alternating' | 'auto'>('alternating');

  // Range options
  const [rangeScope, setRangeScope] = useState<'all' | 'custom'>('all');
  const [startLineNum, setStartLineNum] = useState<number>(1);
  const [endLineNum, setEndLineNum] = useState<number>(lines.length || 1);
  const [targetSinger, setTargetSinger] = useState<SingerRole>('singer1');

  // Alternating options
  const [pattern, setPattern] = useState<'1x1' | '2x2'>('1x1');
  const [startSinger, setStartSinger] = useState<SingerRole>('singer1');

  // Auto-suggest options
  const [pauseThreshold, setPauseThreshold] = useState<number>(2.5);
  const [autoStartSinger, setAutoStartSinger] = useState<SingerRole>('singer1');

  // Reset range defaults when lines change
  useEffect(() => {
    if (lines.length > 0) {
      setEndLineNum(lines.length);
      if (selectedLineIndex >= 0 && selectedLineIndex < lines.length) {
        setStartLineNum(selectedLineIndex + 1);
      }
    }
  }, [lines.length, selectedLineIndex]);

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
  });

  // Calculate live preview distribution
  const preview = useMemo(() => {
    const total = lines.length;
    if (total === 0) return { s1: 0, s2: 0, both: 0, s1Pct: 0, s2Pct: 0, bothPct: 0 };

    let s1 = 0;
    let s2 = 0;
    let both = 0;

    if (mode === 'range') {
      const start = rangeScope === 'all' ? 0 : Math.max(0, startLineNum - 1);
      const end = rangeScope === 'all' ? total - 1 : Math.min(total - 1, endLineNum - 1);

      lines.forEach((line, idx) => {
        let assigned: SingerRole = line.singer ?? 'singer1';
        if (idx >= start && idx <= end) {
          assigned = targetSinger;
        }
        if (assigned === 'singer2') s2++;
        else if (assigned === 'both') both++;
        else s1++;
      });
    } else if (mode === 'alternating') {
      const other: SingerRole = startSinger === 'singer1' ? 'singer2' : 'singer1';
      lines.forEach((_, idx) => {
        let assigned: SingerRole;
        if (pattern === '1x1') {
          assigned = idx % 2 === 0 ? startSinger : other;
        } else {
          const block = Math.floor(idx / 2);
          assigned = block % 2 === 0 ? startSinger : other;
        }
        if (assigned === 'singer2') s2++;
        else if (assigned === 'both') both++;
        else s1++;
      });
    } else if (mode === 'auto') {
      let current: SingerRole = autoStartSinger;
      const other: SingerRole = current === 'singer1' ? 'singer2' : 'singer1';

      lines.forEach((line, idx) => {
        if (idx === 0) {
          if (current === 'singer2') s2++;
          else if (current === 'both') both++;
          else s1++;
          return;
        }
        const prev = lines[idx - 1];
        const gap = line.start_time - prev.end_time;
        if (gap < -0.1) {
          both++;
          return;
        }
        if (gap >= pauseThreshold) {
          current = current === 'singer1' ? other : 'singer1';
        }
        if (current === 'singer2') s2++;
        else if (current === 'both') both++;
        else s1++;
      });
    }

    const s1Pct = Math.round((s1 / total) * 100);
    const s2Pct = Math.round((s2 / total) * 100);
    const bothPct = Math.round((both / total) * 100);
    return { s1, s2, both, s1Pct, s2Pct, bothPct };
  }, [
    lines,
    mode,
    rangeScope,
    startLineNum,
    endLineNum,
    targetSinger,
    pattern,
    startSinger,
    pauseThreshold,
    autoStartSinger,
  ]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) return;

    if (mode === 'range') {
      const start = rangeScope === 'all' ? 0 : Math.max(0, startLineNum - 1);
      const end =
        rangeScope === 'all' ? lines.length - 1 : Math.min(lines.length - 1, endLineNum - 1);
      onApply({
        mode: 'range',
        startLineIndex: start,
        endLineIndex: end,
        singer: targetSinger,
      });
    } else if (mode === 'alternating') {
      onApply({
        mode: 'alternating',
        pattern,
        startSinger,
      });
    } else if (mode === 'auto') {
      onApply({
        mode: 'auto',
        pauseThreshold,
        startSinger: autoStartSinger,
      });
    }
    onClose();
  };

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duet-assign-title"
      aria-describedby="duet-assign-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl space-y-4 my-0 sm:my-8 max-h-[90vh] overflow-y-auto flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-pink-400">
            <div className="p-2 rounded-xl bg-pink-500/10 border border-pink-500/20">
              <Users className="w-5 h-5 text-pink-400" />
            </div>
            <div>
              <h3 id="duet-assign-title" className="text-base font-bold text-white">
                Duet & Multi-Singer Assignment
              </h3>
              <p id="duet-assign-desc" className="text-xs text-slate-400">
                Assign lines to Singer 1, Singer 2, or Both
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-400 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Navigation Tabs */}
        <div
          className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950/70 border border-slate-800 rounded-xl"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'alternating'}
            onClick={() => setMode('alternating')}
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === 'alternating'
                ? 'bg-pink-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Alternating</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'range'}
            onClick={() => setMode('range')}
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === 'range'
                ? 'bg-pink-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Range</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'auto'}
            onClick={() => setMode('auto')}
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mode === 'auto'
                ? 'bg-pink-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Suggest</span>
          </button>
        </div>

        {/* Tab Content */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode 1: Alternating Lines */}
          {mode === 'alternating' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Alternation Pattern</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPattern('1x1')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      pattern === '1x1'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    1-by-1 (S1, S2, S1...)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPattern('2x2')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      pattern === '2x2'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    2-by-2 (S1, S1, S2, S2...)
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Starting Singer</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStartSinger('singer1')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      startSinger === 'singer1'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Start with Singer 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartSinger('singer2')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      startSinger === 'singer2'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Start with Singer 2
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Range Selection */}
          {mode === 'range' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Target Range</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRangeScope('all')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      rangeScope === 'all'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All Lines ({lines.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRangeScope('custom')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      rangeScope === 'custom'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Custom Range
                  </button>
                </div>
              </div>

              {rangeScope === 'custom' && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label
                      htmlFor="range-start-input"
                      className="text-xs text-slate-400 block mb-1"
                    >
                      From Line #
                    </label>
                    <input
                      id="range-start-input"
                      type="number"
                      min={1}
                      max={lines.length || 1}
                      value={startLineNum}
                      onChange={(e) => setStartLineNum(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="range-end-input" className="text-xs text-slate-400 block mb-1">
                      To Line #
                    </label>
                    <input
                      id="range-end-input"
                      type="number"
                      min={startLineNum}
                      max={lines.length || 1}
                      value={endLineNum}
                      onChange={(e) =>
                        setEndLineNum(
                          Math.max(startLineNum, parseInt(e.target.value) || startLineNum)
                        )
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 text-white text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Assign Role</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetSinger('singer1')}
                    className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold border transition-all text-center ${
                      targetSinger === 'singer1'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Singer 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetSinger('singer2')}
                    className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold border transition-all text-center ${
                      targetSinger === 'singer2'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Singer 2
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetSinger('both')}
                    className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold border transition-all text-center ${
                      targetSinger === 'both'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    👥 Both
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mode 3: Auto-Suggest Duet Split */}
          {mode === 'auto' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <span className="font-semibold text-pink-400">Intelligent Pause Clustering:</span>{' '}
                Detects non-vocal gaps between lyric lines (&ge; {pauseThreshold.toFixed(1)}s) to
                infer natural verse/chorus conversational turns, while assigning overlapping phrases
                to Both.
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="pause-threshold-input"
                    className="text-xs font-semibold text-slate-300"
                  >
                    Inter-Line Pause Threshold
                  </label>
                  <span className="text-xs font-mono text-pink-400 font-bold">
                    {pauseThreshold.toFixed(1)}s
                  </span>
                </div>
                <input
                  id="pause-threshold-input"
                  type="range"
                  min="1.5"
                  max="5.0"
                  step="0.5"
                  value={pauseThreshold}
                  onChange={(e) => setPauseThreshold(parseFloat(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer min-h-[44px]"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>1.5s (frequent turns)</span>
                  <span>2.5s (standard)</span>
                  <span>5.0s (stanza breaks only)</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Initial Singer</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAutoStartSinger('singer1')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      autoStartSinger === 'singer1'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Singer 1 Starts
                  </button>
                  <button
                    type="button"
                    onClick={() => setAutoStartSinger('singer2')}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                      autoStartSinger === 'singer2'
                        ? 'bg-pink-500/20 border-pink-500 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🎤 Singer 2 Starts
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Live Distribution Preview */}
          <div
            data-testid="duet-preview-summary"
            className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-2"
          >
            <div className="flex items-center justify-between text-slate-300 font-semibold">
              <span>Assignment Preview:</span>
              <span className="text-slate-500 font-mono text-[11px]">
                {lines.length} lines total
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center">
                <div className="text-[10px] text-amber-400 font-semibold">Singer 1</div>
                <div className="text-sm font-bold text-amber-300">
                  {preview.s1}{' '}
                  <span className="text-[10px] text-amber-400/80">({preview.s1Pct}%)</span>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-pink-500/10 border border-pink-500/30 text-center">
                <div className="text-[10px] text-pink-400 font-semibold">Singer 2</div>
                <div className="text-sm font-bold text-pink-300">
                  {preview.s2}{' '}
                  <span className="text-[10px] text-pink-400/80">({preview.s2Pct}%)</span>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
                <div className="text-[10px] text-emerald-400 font-semibold">Both</div>
                <div className="text-sm font-bold text-emerald-300">
                  {preview.both}{' '}
                  <span className="text-[10px] text-emerald-400/80">({preview.bothPct}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 flex items-center justify-center"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={lines.length === 0}
              data-testid="apply-duet-btn"
              className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-lg shadow-pink-600/20 focus:outline-none focus:ring-2 focus:ring-pink-400 flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Apply Assignment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
