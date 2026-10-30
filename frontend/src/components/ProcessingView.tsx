/* eslint-disable react-refresh/only-export-components */
/**
 * Processing View Component
 *
 * The pipeline progress screen: a progress ring, the current stage and its detail, the
 * engine heartbeat, a 5-stage stepper, elapsed/remaining timers, a reconnect banner with
 * Retry, and a two-step cancel. Also renders the cancelled and failed end states.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Music,
  RefreshCw,
  XCircle,
  Info,
} from 'lucide-react';
import { ProjectState } from '../types';
import { ProgressRing } from './ui/Progress';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { presetInfo, stemsLabel } from '../utils/quality';
import { useNow } from '../hooks/useNow';

export interface PipelineStage {
  id: string;
  label: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'intake', label: 'Audio Intake & Download' },
  { id: 'demucs', label: 'AI Vocal Separation' },
  { id: 'chords', label: 'Vocal Range & Chords' },
  { id: 'lyrics', label: 'Lyric Fetch & Alignment' },
  { id: 'mixing', label: 'Master Stereo Mixing' },
];

export const getActivePipelineStage = (status?: string, statusDetail?: string): number => {
  const s = (status || 'queued').toLowerCase();
  const detail = (statusDetail || '').toLowerCase();
  if (s === 'mixing') return 4;
  if (s === 'fetching_lyrics' || s === 'aligning') return 3;
  if (detail.includes('chord') || detail.includes('range')) return 2;
  if (s === 'separating') return 1;
  return 0; // 'queued', 'processing', 'downloading', or initial intake
};

const DEFAULT_DETAIL: Record<string, string> = {
  processing: 'Preparing audio track...',
  downloading: 'Fetching high-fidelity audio and cover art...',
  separating: 'Isolating the vocals from the backing track...',
  fetching_lyrics: 'Retrieving synchronized lyrics from LRCLIB database...',
  aligning: 'Running forced acoustic alignment for word-by-word timing...',
  mixing: 'Synthesizing master stereo mix...',
};

export interface ProcessingViewProps {
  project: ProjectState;
  onCancelProcess: () => void;
  onResetProject: () => void;
  onRetryPolling?: () => void;
  /** Polling has failed repeatedly; when omitted it is inferred from the status detail. */
  isReconnecting?: boolean;
}

const cardCls =
  'relative overflow-hidden rounded-theme-xl border border-theme-border-subtle bg-theme-surface p-5 text-center shadow-theme-lg sm:p-8';

const formatTimer = (seconds?: number | null) => {
  if (seconds === undefined || seconds === null || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const getHeartbeatText = (lastHeartbeat: number | undefined, now: number) => {
  if (!lastHeartbeat) return 'Active';
  const diffSec = Math.max(0, Math.round((now - lastHeartbeat) / 1000));
  if (diffSec < 2) return 'Pulse just now';
  return `Pulse ${diffSec}s ago`;
};

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  project,
  onCancelProcess,
  onResetProject,
  onRetryPolling,
  isReconnecting: isReconnectingProp,
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // The confirmation replaces the Cancel button: move focus to its safe choice, and back to
  // Cancel when the user keeps processing
  const keepProcessingRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmWasShownRef = useRef(false);
  useEffect(() => {
    if (showCancelConfirm) {
      confirmWasShownRef.current = true;
      keepProcessingRef.current?.focus();
    } else if (confirmWasShownRef.current) {
      confirmWasShownRef.current = false;
      cancelButtonRef.current?.focus();
    }
  }, [showCancelConfirm]);

  // Advances the heartbeat label and stall check between polls (only while processing)
  const now = useNow(1000, project.status !== 'cancelled' && project.status !== 'error');
  const isHeartbeatStalled = Boolean(project.heartbeat && now - project.heartbeat > 15000);
  const isReconnecting =
    isReconnectingProp ?? Boolean(project?.status_detail?.toLowerCase().includes('reconnecting'));
  const currentStageIndex = getActivePipelineStage(project?.status, project?.status_detail);
  const progress = Math.max(0, Math.min(100, project?.progress ?? 0));
  const stemsEngine = project.separation
    ? stemsLabel(project.separation)
    : project.separation_quality
      ? presetInfo(project.separation_quality).label
      : null;
  const isDownloadingModel =
    /download/i.test(project?.status_detail ?? '') &&
    /model|weights/i.test(project?.status_detail ?? '');

  if (project?.status === 'cancelled') {
    return (
      <div className="mx-auto max-w-md py-8 font-theme-body sm:py-16">
        <div className={cn(cardCls, 'space-y-4')}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-theme-pill bg-theme-warning/15 text-theme-warning">
            <XCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2
            tabIndex={-1}
            data-view-heading
            className="font-theme-heading text-xl font-bold text-theme-text focus:outline-none"
          >
            Track Processing Cancelled
          </h2>
          <p className="text-sm text-theme-text-muted">
            The processing job was aborted. You can search or select a new song anytime.
          </p>
          <button
            type="button"
            onClick={onResetProject}
            className={cn(
              'min-h-[40px] rounded-theme-md bg-gradient-accent px-4 py-2 font-theme-heading text-sm font-semibold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110',
              focusRing
            )}
          >
            Search Another Song
          </button>
        </div>
      </div>
    );
  }

  if (project?.status === 'error') {
    return (
      <div className="mx-auto max-w-md py-8 font-theme-body sm:py-16">
        <div className={cn(cardCls, 'space-y-4')}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-theme-pill bg-theme-danger/15 text-theme-danger">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2
            tabIndex={-1}
            data-view-heading
            className="font-theme-heading text-xl font-bold text-theme-text focus:outline-none"
          >
            Track Processing Failed
          </h2>
          <p
            role="alert"
            className="break-words rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-4 text-left font-mono text-xs text-theme-danger"
          >
            {project?.error || 'An unexpected error occurred during processing.'}
          </p>
          <button
            type="button"
            onClick={onResetProject}
            className={cn(
              'min-h-[40px] rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised px-4 py-2 font-theme-heading text-sm font-semibold text-theme-text transition-colors hover:border-theme-border',
              focusRing
            )}
          >
            Try Another Track
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl py-4 font-theme-body sm:py-10">
      <div className={cardCls}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-stage opacity-70"
        />
        <div className="relative space-y-6">
          {(project.title || project.thumbnail_url) && (
            <div className="mx-auto flex max-w-sm items-center justify-center gap-3 text-left">
              {project.thumbnail_url ? (
                <img
                  src={project.thumbnail_url}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-theme-md object-cover shadow-theme-sm"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-theme-md bg-theme-surface-raised text-theme-text-muted">
                  <Music className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-theme-heading text-sm font-semibold text-theme-text">
                  {project.title || 'Untitled track'}
                </p>
                {project.artist && (
                  <p className="truncate text-xs text-theme-text-muted">{project.artist}</p>
                )}
              </div>
            </div>
          )}

          <ProgressRing value={progress} size={128} stroke={9} label="Processing progress">
            <span className="flex flex-col items-center">
              <span className="font-theme-heading text-2xl font-bold tabular-nums text-theme-text">
                {Math.round(progress)}%
              </span>
              <Loader2
                className="mt-0.5 h-4 w-4 text-theme-highlight animate-spin"
                aria-hidden="true"
              />
            </span>
          </ProgressRing>

          <div className="space-y-2">
            {/* Only the stage is announced: the detail below changes with every separation
                chunk, which would keep a screen reader talking for minutes */}
            <div role="status" aria-live="polite">
              <h2
                tabIndex={-1}
                data-view-heading
                className="font-theme-heading text-2xl font-bold capitalize text-theme-text focus:outline-none"
              >
                {(project?.status || 'queued').replace('_', ' ')}...
              </h2>
            </div>
            <p className="mx-auto max-w-md break-words rounded-theme-md border border-theme-border-subtle bg-theme-bg/70 px-3.5 py-2.5 font-mono text-xs text-theme-text-muted">
              {project?.status_detail ||
                DEFAULT_DETAIL[project?.status || ''] ||
                'Processing audio track...'}
            </p>
          </div>

          {stemsEngine && (
            <p className="text-xs text-theme-text-muted" data-testid="processing-stems-engine">
              Stems: <span className="font-semibold text-theme-text">{stemsEngine}</span>
            </p>
          )}
          {isDownloadingModel && (
            <p
              data-testid="processing-model-download"
              className="mx-auto flex max-w-md items-start gap-2 rounded-theme-md border border-theme-info/35 bg-theme-info/10 p-3 text-left text-xs text-theme-info"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              First run on this server: the model is being downloaded once and kept for later songs.
              This can take a few minutes.
            </p>
          )}

          <div>
            {isHeartbeatStalled ? (
              <div className="inline-flex items-center gap-2 rounded-theme-pill border border-theme-warning/40 bg-theme-warning/15 px-3.5 py-1.5 text-xs font-medium text-theme-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Engine slow / waiting for background worker</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-theme-pill border border-theme-success/35 bg-theme-success/10 px-3.5 py-1.5 text-xs font-medium text-theme-success">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-theme-success opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-theme-success" />
                </span>
                <span>Engine Active • {getHeartbeatText(project?.heartbeat, now)}</span>
              </div>
            )}
          </div>

          {isReconnecting && (
            <div
              role="alert"
              className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-theme-md border border-theme-warning/40 bg-theme-warning/15 p-3.5 text-left text-xs text-theme-warning"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-medium">
                  Network connection interrupted. Reconnecting to server...
                </span>
              </div>
              {onRetryPolling && (
                <button
                  type="button"
                  onClick={onRetryPolling}
                  className={cn(
                    'inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-theme-md bg-theme-warning px-3 font-theme-heading text-xs font-bold text-theme-text-inverse transition-[filter] hover:brightness-110',
                    focusRing
                  )}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
              )}
            </div>
          )}

          <ol
            aria-label="Processing Stages"
            className="mx-auto grid max-w-lg grid-cols-5 gap-1 sm:gap-2"
          >
            {PIPELINE_STAGES.map((stage, idx) => {
              const isCompleted = idx < currentStageIndex;
              const isActive = idx === currentStageIndex;
              return (
                <li
                  key={stage.id}
                  className="relative flex flex-col items-center gap-1.5 text-center"
                  aria-current={isActive ? 'step' : undefined}
                >
                  {idx > 0 && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute right-1/2 top-3.5 -z-0 mr-4 h-0.5 w-[calc(100%-2rem)] rounded-full sm:top-4',
                        idx <= currentStageIndex ? 'bg-theme-accent/70' : 'bg-theme-border-subtle'
                      )}
                    />
                  )}
                  <div
                    className={cn(
                      'relative flex h-7 w-7 items-center justify-center rounded-theme-pill border text-xs font-bold transition-colors sm:h-8 sm:w-8',
                      isCompleted
                        ? 'border-theme-success/50 bg-theme-success/15 text-theme-success'
                        : isActive
                          ? 'border-transparent bg-gradient-accent text-theme-accent-text shadow-theme-glow'
                          : 'border-theme-border-subtle bg-theme-surface-subtle text-theme-text-muted'
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" aria-label={`Completed: ${stage.label}`} />
                    ) : isActive ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-label={`Active: ${stage.label}`}
                      />
                    ) : (
                      <span className="text-[10px] sm:text-xs">{idx + 1}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'line-clamp-2 text-[9px] leading-tight sm:text-[11px]',
                      isActive
                        ? 'font-theme-heading font-bold text-theme-text'
                        : isCompleted
                          ? 'font-medium text-theme-text'
                          : 'text-theme-text-muted'
                    )}
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mx-auto flex max-w-md flex-col justify-between gap-1.5 px-1 font-mono text-[11px] text-theme-text-muted sm:flex-row sm:items-center sm:gap-4 sm:text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-theme-highlight">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              {project?.progress ?? 0}% Complete
            </span>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-4">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Elapsed: {formatTimer(project?.elapsed_seconds)}
              </span>
              <span className="text-theme-text">
                Est. remaining:{' '}
                {project?.eta_seconds !== undefined && project?.eta_seconds !== null
                  ? `~${formatTimer(project.eta_seconds)}`
                  : 'Calculating...'}
              </span>
            </div>
          </div>

          <div className="pt-1">
            {showCancelConfirm ? (
              <div
                role="alertdialog"
                aria-labelledby="cancel-confirm-title"
                className="mx-auto max-w-sm space-y-3 rounded-theme-lg border border-theme-border bg-theme-surface-raised p-4 shadow-theme-md"
              >
                <p id="cancel-confirm-title" className="text-sm font-semibold text-theme-text">
                  Cancel separation? In-progress work will be lost.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onCancelProcess}
                    className={cn(
                      'min-h-[36px] rounded-theme-md bg-theme-danger px-3.5 py-1.5 font-theme-heading text-xs font-bold text-white transition-[filter] hover:brightness-110',
                      focusRing
                    )}
                  >
                    Confirm Cancel
                  </button>
                  <button
                    ref={keepProcessingRef}
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className={cn(
                      'min-h-[36px] rounded-theme-md border border-theme-border-subtle bg-theme-surface px-3.5 py-1.5 text-xs font-medium text-theme-text transition-colors hover:border-theme-border',
                      focusRing
                    )}
                  >
                    Keep Processing
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className={cn(
                  'inline-flex min-h-[40px] items-center gap-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle px-4 py-2.5 font-theme-heading text-xs font-semibold text-theme-text-muted transition-colors hover:border-theme-danger/50 hover:text-theme-danger',
                  focusRing
                )}
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cancel &amp; Return to Search</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
