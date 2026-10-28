/**
 * Batch Offset Modal Component
 *
 * Shifts timestamps for every lyric line, or from the selected line onward, by a typed
 * or preset number of seconds.
 */

import React, { useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';

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
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="batch-offset-title"
      descriptionId="batch-offset-desc"
      size="md"
      showDragHandle
    >
      <DialogHeader
        title="Batch Timestamp Offset"
        titleId="batch-offset-title"
        description="Shift line and word timings forward or backward"
        descriptionId="batch-offset-desc"
        icon={<Clock className="h-5 w-5" />}
        onClose={onClose}
      />

      <form onSubmit={handleSubmit}>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-theme-text">Apply Scope</span>
            <SegmentedControl<'all' | 'selected'>
              ariaLabel="Apply scope"
              value={scope}
              onChange={setScope}
              fullWidth
              tone="neutral"
              size="sm"
              options={[
                { value: 'all', label: `All Lines (${totalLines})` },
                { value: 'selected', label: `From Line #${selectedLineIndex + 1} Onward` },
              ]}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="delta-offset-input" className="text-xs font-semibold text-theme-text">
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
                className="min-h-[44px] w-full rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3.5 py-2.5 pr-12 text-base tabular-nums text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-sm"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-theme-text-muted">
                sec
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_OFFSETS.map((preset) => {
                const label = preset > 0 ? `+${preset}s` : `${preset}s`;
                const active = parseFloat(deltaInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDeltaInput(preset.toString())}
                    aria-pressed={active}
                    className={cn(
                      'min-h-[36px] rounded-theme-md border px-2.5 py-1 font-mono text-xs font-medium tabular-nums transition-colors',
                      active
                        ? 'border-theme-accent/60 bg-theme-accent/15 text-theme-highlight'
                        : 'border-theme-border-subtle bg-theme-surface-raised text-theme-text-muted hover:text-theme-text',
                      focusRing
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1 rounded-theme-md border border-theme-border-subtle bg-theme-bg/60 p-3 text-[11px] text-theme-text-muted">
            <p className="flex items-center gap-1.5 font-medium text-theme-text">
              <ShieldCheck className="h-3.5 w-3.5 text-theme-success" aria-hidden="true" />
              Automatic Safeguards:
            </p>
            <p>• Timestamps are strictly clamped at 0.0s (no negative times).</p>
            <p>• Word boundary monotonicity and minimum 10ms token durations are preserved.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" fullWidth="mobile" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gradient" fullWidth="mobile" disabled={!isValidDelta}>
            Apply Offset
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
