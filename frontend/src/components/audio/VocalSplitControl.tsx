/**
 * Vocal Split Control (Mix panel)
 *
 * One split of the song's vocals: lead and backing vocals, or the male and the female voice
 * of the lead. Whether the song has it, a way to make it, and the progress of the split
 * running in the background (with Cancel). Once the vocals are split, its children (the
 * levels of the parts) take the button's place.
 */

import React from 'react';
import { Split, X } from 'lucide-react';
import type {
  VocalSplitCapability,
  VocalSplitInfo,
  VocalSplitJob,
  VocalSplitKind,
} from '../../types';
import { isJobActive } from '../../utils/jobs';
import { formatTimeLeft } from '../../utils/quality';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/Progress';

export interface VocalSplitControlProps {
  kind?: VocalSplitKind;
  /** How the song's parts of this kind were made; unset when it has none. */
  split?: VocalSplitInfo | null;
  /** The song's vocal split job, when it is of this kind. */
  job?: VocalSplitJob | null;
  /** What the server says about running the split; unknown while it loads. */
  capability?: VocalSplitCapability | null;
  onSplit?: () => void;
  onCancel?: () => void;
  /** Another job (re-separation, lyric re-alignment, a render) is using the song. */
  busyReason?: string | null;
  /** Inside another section of the panel: a smaller heading, one level down. */
  nested?: boolean;
  /** The level controls of the parts, shown once the vocals are split. */
  children?: React.ReactNode;
}

const WORDS: Record<
  VocalSplitKind,
  {
    testId: string;
    heading: string;
    split: string;
    unsplit: string;
    action: string;
    why: string;
    running: string;
    progress: string;
    cancel: string;
  }
> = {
  lead_backing: {
    testId: 'vocal-split',
    heading: 'Backing vocals',
    split: 'Split from the lead',
    unsplit: 'In one stem with the lead',
    action: 'Split lead and backing vocals',
    why: 'Separate the backing vocals from the lead, to keep either in the mix',
    running: 'Splitting lead and backing vocals',
    progress: 'Vocal split progress',
    cancel: 'Cancel vocal split',
  },
  male_female: {
    testId: 'voice-split',
    heading: 'Male and female voices',
    split: 'Each voice has its own stem',
    unsplit: 'For a man and a woman who sing at the same time',
    action: 'Split male and female voices',
    why: 'Separate a male and a female voice, to keep either in the mix',
    running: 'Splitting male and female voices',
    progress: 'Voice split progress',
    cancel: 'Cancel voice split',
  },
};

export const VocalSplitControl: React.FC<VocalSplitControlProps> = ({
  kind = 'lead_backing',
  split,
  job,
  capability,
  onSplit,
  onCancel,
  busyReason,
  nested = false,
  children,
}) => {
  const words = WORDS[kind];
  const active = isJobActive(job);
  const failed = job?.status === 'error';
  const timeLeft = formatTimeLeft(job?.eta_seconds);
  const unavailable =
    capability && !capability.available ? capability.reason || 'unavailable' : null;
  const cannot = unavailable ? `This server cannot split vocals: ${unavailable}` : null;
  const blocked = busyReason ?? cannot;
  const headingId = `${words.testId}-heading`;
  const Heading = nested ? 'h4' : 'h3';

  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid={words.testId}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <Heading id={headingId} className="text-sm font-semibold text-theme-text">
            {words.heading}
          </Heading>
          <p
            className={cn('mt-0.5 text-theme-text-muted', nested ? 'text-xs' : 'text-sm')}
            data-testid={`${words.testId}-label`}
          >
            {split ? words.split : words.unsplit}
          </p>
        </div>
        {onSplit && !split && !active && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Split className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onSplit}
            disabled={Boolean(blocked)}
            title={blocked ?? words.why}
            aria-label={words.action}
            className="shrink-0"
          >
            Split
          </Button>
        )}
      </div>

      {!split && !active && cannot && (
        <p className="text-xs text-theme-text-muted" data-testid={`${words.testId}-unavailable`}>
          {cannot}
        </p>
      )}

      {active && job && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-theme-text">{words.running}</span>
            <span className="shrink-0 tabular-nums text-theme-text-muted">
              {Math.round(job.progress)}%{timeLeft ? ` · ${timeLeft}` : ''}
            </span>
          </div>
          <ProgressBar value={job.progress} label={words.progress} size="sm" />
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-theme-text-muted" title={job.detail}>
              {job.detail}
            </p>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={onCancel}
                aria-label={words.cancel}
                className="shrink-0"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {failed && job && !split && (
        <p className="text-xs text-theme-danger" data-testid={`${words.testId}-error`}>
          {job.detail}
          {job.error ? ` (${job.error})` : ''}
        </p>
      )}

      {split && children}
    </section>
  );
};
