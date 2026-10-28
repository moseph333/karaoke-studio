/**
 * Sync Job Banner
 *
 * Shown above the timeline while the lyrics are re-aligned in the background (progress and
 * Cancel), and when a finished re-alignment is waiting because the editor holds unsaved
 * edits: the user chooses between loading the new timing and keeping their edits.
 */

import React from 'react';
import { CheckCircle2, Wand2, X } from 'lucide-react';
import type { SyncJob } from '../../types';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/Progress';

export interface SyncJobBannerProps {
  job?: SyncJob | null;
  onCancel?: () => void;
  /** A finished re-alignment the editor has not loaded yet (unsaved edits). */
  hasReadyResult?: boolean;
  onLoadResult?: () => void;
  onKeepEdits?: () => void;
}

export const SyncJobBanner: React.FC<SyncJobBannerProps> = ({
  job,
  onCancel,
  hasReadyResult = false,
  onLoadResult,
  onKeepEdits,
}) => {
  const active = Boolean(job && (job.status === 'queued' || job.status === 'running'));

  if (active && job) {
    return (
      <div
        data-testid="sync-job-banner"
        className="space-y-1.5 rounded-theme-lg border border-theme-accent/35 bg-theme-accent/10 p-2.5"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 font-semibold text-theme-text">
            <Wand2 className="h-3.5 w-3.5 shrink-0 text-theme-highlight" aria-hidden="true" />
            <span className="truncate">Re-aligning the lyrics in the background</span>
          </span>
          <span className="shrink-0 tabular-nums text-theme-text-muted">
            {Math.round(job.progress)}%
          </span>
        </div>
        <ProgressBar value={job.progress} label="Lyric re-alignment progress" size="sm" />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] text-theme-text-muted" title={job.detail}>
            {job.detail || 'Waiting for other jobs to finish…'}
          </p>
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={onCancel}
              aria-label="Cancel lyric re-alignment"
              className="shrink-0"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (hasReadyResult) {
    return (
      <div
        data-testid="sync-job-ready"
        className="flex flex-wrap items-center justify-between gap-2 rounded-theme-lg border border-theme-success/35 bg-theme-success/10 p-2.5 text-xs"
      >
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-theme-text">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-theme-success" aria-hidden="true" />
          The re-aligned lyrics are ready. Loading them replaces your unsaved edits.
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onKeepEdits}>
            Keep my edits
          </Button>
          <Button variant="primary" size="sm" onClick={onLoadResult}>
            Load re-aligned lyrics
          </Button>
        </span>
      </div>
    );
  }

  return null;
};
