/**
 * Vocal Split Control (Mix panel)
 *
 * Whether the song's vocals have been split into lead and backing parts, a way to split
 * them, and the progress of a split running in the background (with Cancel).
 */

import React from 'react';
import { Split, Users, X } from 'lucide-react';
import type { VocalSplitCapability, VocalSplitInfo, VocalSplitJob } from '../../types';
import { isJobActive } from '../../utils/jobs';
import { formatTimeLeft } from '../../utils/quality';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/Progress';

export interface VocalSplitControlProps {
  /** How the song's lead and backing parts were made; unset when it has none. */
  split?: VocalSplitInfo | null;
  job?: VocalSplitJob | null;
  /** What the server says about running the split; unknown while it loads. */
  capability?: VocalSplitCapability | null;
  onSplit?: () => void;
  onCancel?: () => void;
  /** Another job (re-separation, lyric re-alignment, a render) is using the song. */
  busyReason?: string | null;
  /** The level controls of the parts, shown once the vocals are split. */
  children?: React.ReactNode;
}

export const VocalSplitControl: React.FC<VocalSplitControlProps> = ({
  split,
  job,
  capability,
  onSplit,
  onCancel,
  busyReason,
  children,
}) => {
  const active = isJobActive(job);
  const failed = job?.status === 'error';
  const timeLeft = formatTimeLeft(job?.eta_seconds);
  const unavailable =
    capability && !capability.available ? capability.reason || 'unavailable' : null;
  const blocked =
    busyReason ?? (unavailable ? `This server cannot split vocals: ${unavailable}` : null);

  return (
    <section aria-labelledby="vocal-split-heading" className="space-y-2" data-testid="vocal-split">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3
            id="vocal-split-heading"
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-theme-text-muted"
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Backing vocals
          </h3>
          <p className="mt-0.5 text-sm font-medium text-theme-text" data-testid="vocal-split-label">
            {split ? 'Split from the lead' : 'In one stem with the lead'}
          </p>
        </div>
        {onSplit && !split && !active && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Split className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onSplit}
            disabled={Boolean(blocked)}
            title={
              blocked ?? 'Separate the backing vocals from the lead, to keep either in the mix'
            }
            aria-label="Split lead and backing vocals"
            className="shrink-0"
          >
            Split
          </Button>
        )}
      </div>

      {!split && !active && unavailable && (
        <p className="text-xs text-theme-text-muted" data-testid="vocal-split-unavailable">
          This server cannot split vocals: {unavailable}
        </p>
      )}

      {active && job && (
        <div className="space-y-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-theme-text">
              Splitting lead and backing vocals
            </span>
            <span className="shrink-0 tabular-nums text-theme-text-muted">
              {Math.round(job.progress)}%{timeLeft ? ` · ${timeLeft}` : ''}
            </span>
          </div>
          <ProgressBar value={job.progress} label="Vocal split progress" size="sm" />
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-theme-text-muted" title={job.detail}>
              {job.detail}
            </p>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={onCancel}
                aria-label="Cancel vocal split"
                className="shrink-0"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {failed && job && !split && (
        <p className="text-xs text-theme-danger" data-testid="vocal-split-error">
          {job.detail}
          {job.error ? ` (${job.error})` : ''}
        </p>
      )}

      {split && children}
    </section>
  );
};
