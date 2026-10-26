/**
 * Batch Offset Modal Component
 *
 * Focus-trapped dialog allowing users to uniformly shift timestamps across all
 * lyric lines or from the currently selected line onward, with preset quick buttons.
 */

import React, { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface BatchOffsetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyOffset: (deltaSeconds: number, fromLineIndex: number) => void;
  selectedLineIndex?: number;
  totalLines: number;
}

const PRESET_OFFSETS = [-1.0, -0.5, -0.1, 0.1, 0.5, 1.0];

export const BatchOffsetModal: React.FC<BatchOffsetModalProps> = ({
  isOpen,
  onClose,
  onApplyOffset,
  selectedLineIndex = 0,
  totalLines,
}) => {
  const [deltaInput, setDeltaInput] = useState<string>('0.5');
  const [scope, setScope] = useState<'all' | 'selected'>('all');

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const delta = parseFloat(deltaInput);
    if (!Number.isFinite(delta) || isNaN(delta) || delta === 0) return;

    const fromIndex = scope === 'selected' ? selectedLineIndex : 0;
    onApplyOffset(delta, fromIndex);
    onClose();
  };

  const parsedDelta = parseFloat(deltaInput);
  const isValidDelta = Number.isFinite(parsedDelta) && !isNaN(parsedDelta) && parsedDelta !== 0;

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-offset-title"
      aria-describedby="batch-offset-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-cyan-400">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <Clock className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 id="batch-offset-title" className="text-base font-bold text-white">
                Batch Timestamp Offset
              </h3>
              <p id="batch-offset-desc" className="text-xs text-slate-400">
                Shift line and word timings forward or backward
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Scope Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Apply Scope</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                  scope === 'all'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                All Lines ({totalLines})
              </button>
              <button
                type="button"
                onClick={() => setScope('selected')}
                className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                  scope === 'selected'
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                From Line #{selectedLineIndex + 1} Onward
              </button>
            </div>
          </div>

          {/* Time Offset Input & Presets */}
          <div className="space-y-2">
            <label htmlFor="delta-offset-input" className="text-xs font-semibold text-slate-300">
              Offset Delta (seconds)
            </label>
            <div className="relative">
              <input
                id="delta-offset-input"
                type="number"
                step="0.05"
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
                placeholder="+0.5 or -1.0"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-white text-sm outline-none transition-all"
              />
              <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">sec</span>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_OFFSETS.map((preset) => {
                const label = preset > 0 ? `+${preset}s` : `${preset}s`;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDeltaInput(preset.toString())}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono font-medium transition-colors border border-slate-700/60"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info & Constraints Note */}
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <p className="text-slate-300 font-medium">Automatic Safeguards:</p>
            <p>• Timestamps are strictly clamped at 0.0s (no negative times).</p>
            <p>• Word boundary monotonicity and minimum 10ms token durations are preserved.</p>
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValidDelta}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-600/20 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              Apply Offset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
