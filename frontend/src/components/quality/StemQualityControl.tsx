/**
 * Stem Quality Control (Mix panel)
 *
 * Which model made the song's stems, a way to re-make them at another quality, and the
 * progress of a re-separation running in the background (with Cancel).
 */

import React from 'react';
import { AlertTriangle, Layers, Sparkles, X } from 'lucide-react';
import type { SeparationInfo, SeparationJob } from '../../types';
import { formatTimeLeft, stemsLabel } from '../../utils/quality';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/Progress';
import { Tooltip } from '../Tooltip';

export interface StemQualityControlProps {
  separation?: SeparationInfo | null;
  job?: SeparationJob | null;
  onImprove?: () => void;
  onCancel?: () => void;
  /** Another job (lyric re-alignment, processing) is using the song. */
  busyReason?: string | null;
}

const isActive = (job?: SeparationJob | null) =>
  Boolean(job && (job.status === 'queued' || job.status === 'running'));

export const StemQualityControl: React.FC<StemQualityControlProps> = ({
  separation,
  job,
  onImprove,
  onCancel,
  busyReason,
}) => {
  const active = isActive(job);
  const failed = job?.status === 'error';
  const fallback = separation?.fallback_reason;
  const timeLeft = formatTimeLeft(job?.eta_seconds);

  return (
    <section
      aria-labelledby="stem-quality-heading"
      className="space-y-2"
      data-testid="stem-quality"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="stem-quality-heading"
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-theme-text-muted"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Stems
          </h3>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-medium text-theme-text">
            <span className="truncate" data-testid="stem-quality-label">
              {stemsLabel(separation)}
            </span>
            {fallback && (
              <Tooltip content={`Fell back from the requested quality: ${fallback}`} portal>
                <span
                  role="img"
                  aria-label={`Fell back from the requested quality: ${fallback}`}
                  className="inline-flex shrink-0 text-theme-warning"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Tooltip>
            )}
          </p>
        </div>
        {onImprove && !active && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onImprove}
            disabled={Boolean(busyReason)}
            title={busyReason ?? 'Re-make the stems with another model'}
            aria-label="Improve stem separation"
            className="shrink-0"
          >
            Improve
          </Button>
        )}
      </div>

      {active && job && (
        <div className="space-y-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-theme-text">
              {job.label ? `Re-making with ${job.label}` : 'Re-making the stems'}
            </span>
            <span className="shrink-0 tabular-nums text-theme-text-muted">
              {Math.round(job.progress)}%{timeLeft ? ` · ${timeLeft}` : ''}
            </span>
          </div>
          <ProgressBar value={job.progress} label="Stem re-separation progress" size="sm" />
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
                aria-label="Cancel stem re-separation"
                className="shrink-0"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {failed && job && (
        <p className="text-xs text-theme-danger" data-testid="stem-quality-error">
          {job.detail}
          {job.error ? ` (${job.error})` : ''}
        </p>
      )}
    </section>
  );
};
