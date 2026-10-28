/**
 * Duet Assignment Modal Component
 *
 * Bulk-assigns lyric lines to singer roles by alternating pattern (1x1, 2x2), a line
 * range, or automatic pause clustering (gaps >= the threshold), with a live preview of
 * the resulting split.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Users, Shuffle, Sliders, Sparkles, Check } from 'lucide-react';
import { LyricLine, SingerRole, BulkAssignOptions } from '../../types';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { SegmentedControl, type SegmentedOption } from '../ui/SegmentedControl';
import { Tabs } from '../ui/Tabs';
import { SINGER_CONFIG } from '../stage/singers';
import { cn } from '../../utils/cn';

export type { BulkAssignOptions };

type DuetMode = 'range' | 'alternating' | 'auto';

const singerOption = (role: SingerRole, label: string): SegmentedOption<SingerRole> => {
  const Icon = SINGER_CONFIG[role].Icon;
  return { value: role, label, icon: <Icon className="h-3.5 w-3.5" aria-hidden="true" /> };
};

const PREVIEW_TONES: Record<SingerRole, string> = {
  singer1: 'border-theme-sung/35 bg-theme-sung/10 [&_svg]:text-theme-sung',
  singer2: 'border-theme-secondary/40 bg-theme-secondary/10 [&_svg]:text-theme-secondary',
  both: 'border-theme-success/35 bg-theme-success/10 [&_svg]:text-theme-success',
};

const groupLabel = 'text-xs font-semibold text-theme-text';

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
  const [mode, setMode] = useState<DuetMode>('alternating');

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

  const numberInput =
    'w-full min-h-[44px] rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3 py-2 text-base tabular-nums text-theme-text focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-sm';
  const thresholdPct = ((pauseThreshold - 1.5) / (5.0 - 1.5)) * 100;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="duet-assign-title"
      descriptionId="duet-assign-desc"
      size="lg"
      showDragHandle
    >
      <DialogHeader
        title="Duet & Multi-Singer Assignment"
        titleId="duet-assign-title"
        description="Assign lines to Singer 1, Singer 2, or Both"
        descriptionId="duet-assign-desc"
        icon={<Users className="h-5 w-5" />}
        onClose={onClose}
      />

      <Tabs<DuetMode>
        ariaLabel="Assignment mode"
        value={mode}
        onChange={setMode}
        fullWidth
        getTabId={(id) => `duet-mode-${id}`}
        items={[
          {
            id: 'alternating',
            label: 'Alternating',
            icon: <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />,
            controls: 'duet-mode-panel',
          },
          {
            id: 'range',
            label: 'Range',
            icon: <Sliders className="h-3.5 w-3.5" aria-hidden="true" />,
            controls: 'duet-mode-panel',
          },
          {
            id: 'auto',
            label: 'Auto-Suggest',
            icon: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />,
            controls: 'duet-mode-panel',
          },
        ]}
        tabClassName="text-xs"
      />

      <form onSubmit={handleSubmit} className="mt-4">
        <div
          id="duet-mode-panel"
          role="tabpanel"
          aria-labelledby={`duet-mode-${mode}`}
          className="space-y-4"
        >
          {mode === 'alternating' && (
            <>
              <div className="space-y-1.5">
                <span className={groupLabel}>Alternation Pattern</span>
                <SegmentedControl<'1x1' | '2x2'>
                  ariaLabel="Alternation pattern"
                  value={pattern}
                  onChange={setPattern}
                  fullWidth
                  tone="neutral"
                  size="sm"
                  options={[
                    { value: '1x1', label: '1-by-1 (S1, S2, S1...)' },
                    { value: '2x2', label: '2-by-2 (S1, S1, S2, S2...)' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <span className={groupLabel}>Starting Singer</span>
                <SegmentedControl<SingerRole>
                  ariaLabel="Starting singer"
                  value={startSinger}
                  onChange={setStartSinger}
                  fullWidth
                  tone="neutral"
                  size="sm"
                  options={[
                    singerOption('singer1', 'Start with Singer 1'),
                    singerOption('singer2', 'Start with Singer 2'),
                  ]}
                />
              </div>
            </>
          )}

          {mode === 'range' && (
            <>
              <div className="space-y-1.5">
                <span className={groupLabel}>Target Range</span>
                <SegmentedControl<'all' | 'custom'>
                  ariaLabel="Target range"
                  value={rangeScope}
                  onChange={setRangeScope}
                  fullWidth
                  tone="neutral"
                  size="sm"
                  options={[
                    { value: 'all', label: `All Lines (${lines.length})` },
                    { value: 'custom', label: 'Custom Range' },
                  ]}
                />
              </div>

              {rangeScope === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="range-start-input"
                      className="mb-1 block text-xs text-theme-text-muted"
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
                      className={numberInput}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="range-end-input"
                      className="mb-1 block text-xs text-theme-text-muted"
                    >
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
                      className={numberInput}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className={groupLabel}>Assign Role</span>
                <SegmentedControl<SingerRole>
                  ariaLabel="Assign role"
                  value={targetSinger}
                  onChange={setTargetSinger}
                  fullWidth
                  tone="neutral"
                  size="sm"
                  options={[
                    singerOption('singer1', 'Singer 1'),
                    singerOption('singer2', 'Singer 2'),
                    singerOption('both', 'Both'),
                  ]}
                />
              </div>
            </>
          )}

          {mode === 'auto' && (
            <>
              <div className="rounded-theme-md border border-theme-border-subtle bg-theme-bg/60 p-3 text-xs leading-relaxed text-theme-text-muted">
                <span className="font-semibold text-theme-highlight">
                  Intelligent Pause Clustering:
                </span>{' '}
                Detects non-vocal gaps between lyric lines (&ge; {pauseThreshold.toFixed(1)}s) to
                infer natural verse/chorus conversational turns, while assigning overlapping phrases
                to Both.
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="pause-threshold-input" className={groupLabel}>
                    Inter-Line Pause Threshold
                  </label>
                  <span className="font-mono text-xs font-bold tabular-nums text-theme-highlight">
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
                  className="ks-range min-h-[44px]"
                  style={{ '--ks-range-fill': `${thresholdPct}%` } as React.CSSProperties}
                />
                <div className="flex justify-between font-mono text-[10px] text-theme-text-muted">
                  <span>1.5s (frequent turns)</span>
                  <span>2.5s (standard)</span>
                  <span>5.0s (stanza breaks only)</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className={groupLabel}>Initial Singer</span>
                <SegmentedControl<SingerRole>
                  ariaLabel="Initial singer"
                  value={autoStartSinger}
                  onChange={setAutoStartSinger}
                  fullWidth
                  tone="neutral"
                  size="sm"
                  options={[
                    singerOption('singer1', 'Singer 1 Starts'),
                    singerOption('singer2', 'Singer 2 Starts'),
                  ]}
                />
              </div>
            </>
          )}
        </div>

        <div
          data-testid="duet-preview-summary"
          className="mt-4 space-y-2 rounded-theme-md border border-theme-border-subtle bg-theme-bg/60 p-3 text-xs"
        >
          <div className="flex items-center justify-between font-semibold text-theme-text">
            <span>Assignment Preview:</span>
            <span className="font-mono text-[11px] text-theme-text-muted">
              {lines.length} lines total
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['singer1', 'Singer 1', preview.s1, preview.s1Pct],
                ['singer2', 'Singer 2', preview.s2, preview.s2Pct],
                ['both', 'Both', preview.both, preview.bothPct],
              ] as const
            ).map(([role, label, count, pct]) => {
              const Icon = SINGER_CONFIG[role].Icon;
              return (
                <div
                  key={role}
                  className={cn('rounded-theme-md border p-2 text-center', PREVIEW_TONES[role])}
                >
                  <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-theme-text-muted">
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {label}
                  </div>
                  <div className="text-sm font-bold tabular-nums text-theme-text">
                    {count}{' '}
                    <span className="text-[10px] font-medium text-theme-text-muted">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" fullWidth="mobile" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="gradient"
            fullWidth="mobile"
            disabled={lines.length === 0}
            data-testid="apply-duet-btn"
            leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
          >
            Apply Assignment
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
