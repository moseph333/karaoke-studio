/* eslint-disable react-refresh/only-export-components */
/**
 * Processing View Component
 *
 * The screen a song is made on: its name, how far along it is as one large numeral over a
 * bar, the step it is on in plain words with the server's detail under it, the time so far
 * and left, the four steps as a numbered line, what to expect of the result, a tip for the
 * wait, and a two-step cancel. Nothing is said while things work; a notice appears only
 * when the server has gone quiet or the connection is lost (with Retry). Also renders the
 * cancelled and failed end states: what happened in plain words (`utils/processingErrors`),
 * the raw error under "Technical details", and a button that starts the song again.
 */

import React from 'react';
import { AlertTriangle, Check, Info, Music } from 'lucide-react';
import { ProjectState } from '../types';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/Progress';
import { InlineConfirm } from './ui/InlineConfirm';
import { ProcessingExpectations } from './ProcessingExpectations';
import { ProcessingTips } from './ProcessingTips';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { formatTimer } from '../utils/format';
import { explainProcessingError, isUploadedSong } from '../utils/processingErrors';
import { presetInfo, stemsLabel } from '../utils/quality';
import { useNow } from '../hooks/useNow';

export interface PipelineStage {
  id: string;
  label: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'intake', label: 'Get the audio' },
  { id: 'demucs', label: 'Remove the vocals' },
  { id: 'lyrics', label: 'Find and time the lyrics' },
  { id: 'mixing', label: 'Mix' },
];

// Vocal range and chords are no longer a step: they are analysed while the studio opens
export const getActivePipelineStage = (status?: string): number => {
  const s = (status || 'queued').toLowerCase();
  if (s === 'mixing') return 3;
  if (s === 'fetching_lyrics' || s === 'aligning') return 2;
  if (s === 'separating') return 1;
  return 0; // 'queued', 'processing', 'downloading', or initial intake
};

/** What the song is doing now, as the screen's heading. */
const STATUS_HEADING: Record<string, string> = {
  queued: 'Waiting to start',
  processing: 'Getting ready',
  downloading: 'Getting the audio',
  separating: 'Removing the vocals',
  fetching_lyrics: 'Finding the lyrics',
  aligning: 'Timing the words',
  mixing: 'Mixing',
};

/** Shown under the heading until the server sends a detail of its own. */
const DEFAULT_DETAIL: Record<string, string> = {
  processing: 'Preparing the audio.',
  downloading: 'Downloading the audio and cover art.',
  separating: 'Separating the vocals from the backing track.',
  fetching_lyrics: 'Looking for lyrics with timings.',
  aligning: 'Matching each word to the moment it is sung.',
  mixing: 'Making the first mix.',
};

/** No word from the server for this long counts as quiet. */
const QUIET_AFTER_MS = 15000;

export interface ProcessingViewProps {
  project: ProjectState;
  onCancelProcess: () => void;
  onResetProject: () => void;
  onRetryPolling?: () => void;
  /** Polling has failed repeatedly; when omitted it is inferred from the status detail. */
  isReconnecting?: boolean;
  /** Starts a failed or cancelled song again. Left out for songs that cannot be restarted
   * from here (an uploaded file has to be sent again). */
  onRetry?: () => void;
  /** The retry request is on its way. */
  isRetrying?: boolean;
}

const endHeadingCls =
  'ks-display text-[44px] font-black leading-[0.9] focus:outline-none sm:text-[72px]';

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  project,
  onCancelProcess,
  onResetProject,
  onRetryPolling,
  isReconnecting: isReconnectingProp,
  onRetry,
  isRetrying = false,
}) => {
  // Advances the quiet-server check between polls (only while processing)
  const now = useNow(1000, project.status !== 'cancelled' && project.status !== 'error');
  const isServerQuiet = Boolean(project.heartbeat && now - project.heartbeat > QUIET_AFTER_MS);
  const isReconnecting =
    isReconnectingProp ?? Boolean(project?.status_detail?.toLowerCase().includes('reconnecting'));
  const currentStageIndex = getActivePipelineStage(project?.status);
  const progress = Math.max(0, Math.min(100, project?.progress ?? 0));
  const stemsEngine = project.separation
    ? stemsLabel(project.separation)
    : project.separation_quality
      ? presetInfo(project.separation_quality).label
      : null;
  const isDownloadingModel =
    /download/i.test(project?.status_detail ?? '') &&
    /model|weights/i.test(project?.status_detail ?? '');

  const uploadAgain = isUploadedSong(project) && (
    <p className="text-base text-theme-text-muted">
      This song came from a file: choose New Song and upload it again.
    </p>
  );
  const endActions = (retryLabel: string) => (
    <div className="flex flex-wrap items-center gap-3">
      {onRetry && (
        <Button variant="primary" size="lg" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Starting…' : retryLabel}
        </Button>
      )}
      <Button variant={onRetry ? 'secondary' : 'primary'} size="lg" onClick={onResetProject}>
        New Song
      </Button>
    </div>
  );

  if (project?.status === 'cancelled') {
    return (
      <div className="max-w-3xl space-y-5 pb-10 font-theme-body">
        <h1 tabIndex={-1} data-view-heading className={cn(endHeadingCls, 'text-theme-text')}>
          Track Processing Cancelled
        </h1>
        <p className="border-t-2 border-theme-border pt-4 text-[19px] text-theme-text">
          Processing was stopped before the song was finished, so there is nothing to open yet.
          {onRetry ? ' Start it again, or pick another song.' : ''}
        </p>
        {uploadAgain}
        {endActions('Start again')}
      </div>
    );
  }

  if (project?.status === 'error') {
    const explanation = explainProcessingError(project.error, {
      uploaded: isUploadedSong(project),
    });
    return (
      <div className="max-w-3xl space-y-5 pb-10 font-theme-body">
        <h1 tabIndex={-1} data-view-heading className={cn(endHeadingCls, 'text-theme-danger')}>
          Track Processing Failed
        </h1>
        <div
          role="alert"
          className="space-y-1.5 text-pretty border-t-2 border-theme-border pt-4"
          data-testid="failure-reason"
        >
          <p className="text-[19px] font-semibold text-theme-text">{explanation.summary}</p>
          <p className="text-base text-theme-text-muted">{explanation.advice}</p>
        </div>
        {uploadAgain}
        {endActions('Try again')}
        <details>
          <summary
            className={cn(
              'inline-flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-theme-text-muted hover:text-theme-text md:min-h-[32px]',
              focusRing
            )}
          >
            Technical details
          </summary>
          {/* The server's own words, set apart from ours by the monospace face */}
          <p className="mt-1 break-words border-l-2 border-theme-danger pl-3 font-mono text-xs text-theme-text-muted">
            {project?.error || 'An unexpected error occurred during processing.'}
          </p>
        </details>
      </div>
    );
  }

  const status = project?.status || 'queued';
  const hasEta = project?.eta_seconds !== undefined && project?.eta_seconds !== null;

  return (
    <div className="space-y-6 pb-10 font-theme-body">
      {(project.title || project.thumbnail_url) && (
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {project.thumbnail_url ? (
            <img
              src={project.thumbnail_url}
              alt=""
              className="h-12 w-12 shrink-0 object-cover sm:h-16 sm:w-16"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-theme-surface-raised text-theme-text-muted sm:h-16 sm:w-16">
              <Music className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="ks-display truncate text-[34px] font-black text-theme-text sm:text-[56px]">
              {project.title || 'Untitled track'}
            </p>
            {project.artist && (
              <p className="truncate text-sm text-theme-text-muted">{project.artist}</p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 border-t-2 border-theme-border pt-5">
        <div className="flex flex-col gap-x-10 gap-y-3 sm:flex-row sm:items-end">
          {/* The bar below carries the value for screen readers */}
          <p
            aria-hidden="true"
            data-testid="processing-percent"
            className="ks-display shrink-0 text-[clamp(96px,18vw,180px)] font-black leading-[0.8] tabular-nums text-theme-text"
          >
            {Math.round(progress)}%
          </p>
          <div className="min-w-0 flex-1 space-y-1.5 sm:pb-1">
            {/* Only the step is announced: the detail below changes with every separation
                chunk, which would keep a screen reader talking for minutes */}
            <div role="status" aria-live="polite">
              <h1
                tabIndex={-1}
                data-view-heading
                className="ks-display text-[36px] font-black text-theme-text focus:outline-none sm:text-[56px]"
              >
                {STATUS_HEADING[status] ?? status.replace(/_/g, ' ')}
              </h1>
            </div>
            <p className="max-w-2xl break-words text-base text-theme-text-muted">
              {project?.status_detail || DEFAULT_DETAIL[status] || 'Working on the song.'}
            </p>
            <div className="flex flex-col justify-between gap-x-8 gap-y-1 text-sm tabular-nums text-theme-text sm:flex-row sm:items-center sm:justify-start">
              <span>{formatTimer(project?.elapsed_seconds)} so far</span>
              <span>
                {hasEta
                  ? `About ${formatTimer(project.eta_seconds ?? 0)} left`
                  : 'Working out the time left'}
              </span>
              {stemsEngine && (
                <span className="text-theme-text-muted" data-testid="processing-stems-engine">
                  Stems: <span className="text-theme-text">{stemsEngine}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <ProgressBar value={progress} label="Processing progress" className="h-3" />

        <ol
          aria-label="Processing Stages"
          className="flex flex-col gap-x-10 gap-y-1 sm:flex-row sm:flex-wrap"
        >
          {PIPELINE_STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIndex;
            const isActive = idx === currentStageIndex;
            return (
              <li
                key={stage.id}
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'ks-display flex items-center gap-2 text-[22px] sm:text-[26px]',
                  isActive
                    ? 'text-theme-accent'
                    : isCompleted
                      ? 'text-theme-text'
                      : 'text-theme-text-muted'
                )}
              >
                <span aria-hidden="true" className="tabular-nums">
                  {idx + 1}.
                </span>
                <span>{stage.label}</span>
                {isCompleted && (
                  <Check className="h-5 w-5 shrink-0" aria-label={`Completed: ${stage.label}`} />
                )}
              </li>
            );
          })}
        </ol>

        {isDownloadingModel && (
          <p
            data-testid="processing-model-download"
            className="flex max-w-2xl items-start gap-2 text-sm text-theme-text-muted"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            First run on this server: the model is being downloaded once and kept for later songs.
            This can take a few minutes.
          </p>
        )}
        {isServerQuiet && (
          <p
            data-testid="processing-server-quiet"
            className="flex items-start gap-2 text-sm font-semibold text-theme-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>No update from the server for a while. It may be busy with another song.</span>
          </p>
        )}
        {isReconnecting && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-theme-warning"
          >
            <span className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Network connection interrupted. Reconnecting to server...</span>
            </span>
            {onRetryPolling && (
              <Button variant="secondary" size="sm" onClick={onRetryPolling}>
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-x-12 gap-y-6 border-t border-theme-border-subtle pt-5 lg:grid-cols-2">
        <ProcessingExpectations />
        <div className="space-y-4">
          <ProcessingTips />
          <InlineConfirm
            message="Cancel separation? In-progress work will be lost."
            confirmLabel="Confirm Cancel"
            keepLabel="Keep Processing"
            onConfirm={onCancelProcess}
            renderTrigger={(trigger) => (
              <button
                ref={trigger.ref}
                type="button"
                onClick={trigger.onClick}
                className={cn(
                  'ks-display inline-flex min-h-[44px] items-center text-[22px] text-theme-text-muted underline decoration-1 underline-offset-4 transition-colors hover:text-theme-danger',
                  focusRing
                )}
              >
                Cancel &amp; Return to Search
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
};
