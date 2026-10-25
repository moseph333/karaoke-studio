/* eslint-disable react-refresh/only-export-components */
/**
 * Processing View Component
 *
 * Displays the audio processing pipeline progress screen with active engine heartbeat,
 * dynamic 5-stage pipeline stepper, progress bar, elapsed/eta timers, 2-step cancel confirmation,
 * network reconnecting banner, and semantic theme tokens across all themes.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  AlertCircle,
  Clock,
  Activity,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { ProjectState } from '../types';

export interface PipelineStage {
  id: string;
  label: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'intake', label: 'Audio Intake & Download' },
  { id: 'demucs', label: 'Demucs Vocal Separation' },
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
  return 0; // 'queued', 'downloading', or initial intake
};

export interface ProcessingViewProps {
  project: ProjectState;
  onCancelProcess: () => void;
  onResetProject: () => void;
  onRetryPolling?: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  project,
  onCancelProcess,
  onResetProject,
  onRetryPolling,
}) => {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const formatTimer = (seconds?: number | null) => {
    if (seconds === undefined || seconds === null || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getHeartbeatText = (lastHeartbeat?: number) => {
    if (!lastHeartbeat) return 'Active';
    const diffSec = Math.max(0, Math.round((Date.now() - lastHeartbeat) / 1000));
    if (diffSec < 2) return 'Pulse just now';
    return `Pulse ${diffSec}s ago`;
  };

  const isHeartbeatStalled = Boolean(project.heartbeat && Date.now() - project.heartbeat > 15000);

  const isReconnecting = Boolean(project?.status_detail?.toLowerCase().includes('reconnecting'));

  const currentStageIndex = getActivePipelineStage(project?.status, project?.status_detail);

  if (project?.status === 'cancelled') {
    return (
      <div className="max-w-md mx-auto py-8 sm:py-16 text-center space-y-4 font-theme-body">
        <div className="p-3 w-12 h-12 rounded-theme-pill bg-amber-500/10 border-theme border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center shadow-theme-sm">
          <XCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-theme-text font-theme-heading">
          Track Processing Cancelled
        </h2>
        <p className="text-xs text-theme-text-muted font-theme-body">
          The processing job was aborted. You can search or select a new song anytime.
        </p>
        <button
          type="button"
          onClick={onResetProject}
          className="min-h-[40px] px-4 py-2 rounded-theme-md bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text border-theme border-theme-border text-xs font-bold transition-all shadow-theme-sm font-theme-heading"
        >
          Search Another Song
        </button>
      </div>
    );
  }

  if (project?.status === 'error') {
    return (
      <div className="max-w-md mx-auto py-8 sm:py-16 text-center space-y-4 font-theme-body">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-bold text-theme-text font-theme-heading">
          Track Processing Failed
        </h2>
        <p className="text-xs text-red-300 font-mono bg-red-950/40 p-4 rounded-theme-md border-theme border-red-800/60 break-words shadow-theme-sm">
          {project?.error || 'An unexpected error occurred during processing.'}
        </p>
        <button
          type="button"
          onClick={onResetProject}
          className="min-h-[40px] px-4 py-2 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border-theme border-theme-border-subtle text-theme-text text-xs font-semibold font-theme-heading shadow-theme-sm transition-colors"
        >
          Try Another Track
        </button>
      </div>
    );
  }

  return (
    <div
      className="max-w-xl mx-auto py-8 sm:py-16 text-center space-y-6 font-theme-body"
      role="status"
      aria-live="polite"
    >
      {/* Central Animated Spinner & Icon */}
      <div className="relative w-24 h-24 mx-auto">
        <div className="w-full h-full border-4 border-theme-border-subtle border-t-theme-accent rounded-full animate-spin motion-reduce:animate-none"></div>
        <Sparkles
          className="absolute inset-0 m-auto w-8 h-8 text-theme-accent animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>

      {/* Live Heartbeat Health Indicator */}
      <div>
        {isHeartbeatStalled ? (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-theme-pill bg-amber-500/15 border-theme border-amber-500/40 text-amber-400 text-xs font-medium shadow-theme-sm font-theme-body">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
            <span>Engine slow / waiting for background worker</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-theme-pill bg-emerald-500/10 border-theme border-emerald-500/30 text-emerald-400 text-xs font-medium shadow-theme-sm font-theme-body">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Engine Active • {getHeartbeatText(project?.heartbeat)}</span>
          </div>
        )}
      </div>

      {/* Reconnecting Alert Banner (if disconnected) */}
      {isReconnecting && (
        <div
          role="alert"
          className="p-3.5 rounded-theme-md bg-amber-500/15 border-theme border-amber-500/40 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-theme-sm max-w-md mx-auto"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="text-left font-theme-body font-medium">
              Network connection interrupted. Reconnecting to server...
            </span>
          </div>
          {onRetryPolling && (
            <button
              type="button"
              onClick={onRetryPolling}
              className="px-2.5 py-1 rounded-theme-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition-colors shadow-theme-sm font-theme-heading"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Stage Status & Dynamic Detail */}
      <div>
        <h2 className="text-2xl font-bold text-theme-text capitalize font-theme-heading">
          {(project?.status || 'queued').replace('_', ' ')}...
        </h2>
        <p className="text-xs text-theme-text-muted mt-2 font-mono max-w-md mx-auto bg-theme-surface py-2.5 px-3.5 rounded-theme-md border-theme border-theme-border-subtle break-words shadow-theme-sm">
          {project?.status_detail ||
            (project?.status === 'downloading'
              ? 'Fetching high-fidelity audio and cover art...'
              : project?.status === 'separating'
                ? 'Isolating vocals and backing instrumental track with Demucs AI...'
                : project?.status === 'fetching_lyrics'
                  ? 'Retrieving synchronized lyrics from LRCLIB database...'
                  : project?.status === 'aligning'
                    ? 'Running forced acoustic alignment for word-by-word timing...'
                    : project?.status === 'mixing'
                      ? 'Synthesizing master stereo mix...'
                      : 'Processing audio track...')}
        </p>
      </div>

      {/* Visual 5-Stage Pipeline Stepper */}
      <div className="w-full max-w-lg mx-auto py-2" aria-label="Processing Stages">
        <ol className="grid grid-cols-5 gap-1 sm:gap-2">
          {PIPELINE_STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIndex;
            const isActive = idx === currentStageIndex;

            return (
              <li
                key={stage.id}
                className="flex flex-col items-center text-center gap-1.5"
                aria-current={isActive ? 'step' : undefined}
              >
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-theme-pill flex items-center justify-center text-xs font-bold transition-all border-theme shadow-theme-sm ${
                    isCompleted
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                      : isActive
                        ? 'bg-theme-accent text-theme-accent-text border-theme-border shadow-theme-glow animate-pulse'
                        : 'bg-theme-surface-subtle text-theme-text-muted border-theme-border-subtle'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2
                      className="w-4 h-4 text-emerald-400"
                      aria-label={`Completed: ${stage.label}`}
                    />
                  ) : isActive ? (
                    <Loader2
                      className="w-4 h-4 animate-spin text-theme-accent-text"
                      aria-label={`Active: ${stage.label}`}
                    />
                  ) : (
                    <span className="text-[10px] sm:text-xs">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={`text-[9px] sm:text-[11px] leading-tight font-theme-body line-clamp-2 ${
                    isActive
                      ? 'font-bold text-theme-text font-theme-heading'
                      : isCompleted
                        ? 'text-theme-text font-medium'
                        : 'text-theme-text-muted'
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Progress Bar & Timers */}
      <div className="max-w-md mx-auto space-y-2">
        <div className="w-full bg-theme-surface border-theme border-theme-border-subtle h-3 rounded-theme-pill overflow-hidden p-0.5 shadow-inner">
          <div
            className="bg-theme-accent h-full rounded-theme-pill transition-all duration-500 shadow-theme-sm"
            style={{ width: `${Math.max(5, project?.progress || 0)}%` }}
          ></div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 text-[11px] sm:text-xs text-theme-text-muted px-1 font-mono">
          <span className="flex items-center gap-1.5 text-theme-accent font-semibold">
            <Activity className="w-3.5 h-3.5" />
            {project?.progress ?? 0}% Complete
          </span>
          <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-theme-text-muted" />
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
      </div>

      {/* Cancel Separation: 2-step confirmation prompt */}
      <div className="pt-2">
        {showCancelConfirm ? (
          <div
            role="alertdialog"
            aria-labelledby="cancel-confirm-title"
            className="p-4 rounded-theme-md bg-theme-surface border-theme border-theme-border shadow-theme-md max-w-sm mx-auto space-y-3"
          >
            <p
              id="cancel-confirm-title"
              className="text-xs sm:text-sm font-semibold text-theme-text font-theme-body"
            >
              Cancel separation? In-progress work will be lost.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onCancelProcess}
                className="min-h-[36px] px-3.5 py-1.5 rounded-theme-sm bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors shadow-theme-sm font-theme-heading"
              >
                Confirm Cancel
              </button>
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="min-h-[36px] px-3.5 py-1.5 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border-theme border-theme-border-subtle text-theme-text text-xs font-medium transition-colors font-theme-body"
              >
                Keep Processing
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCancelConfirm(true)}
            className="min-h-[40px] px-4 py-2.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface border-theme border-theme-border-subtle hover:border-red-500/50 text-theme-text-muted hover:text-red-400 text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-theme-sm font-theme-heading"
          >
            <XCircle className="w-3.5 h-3.5 text-red-400" />
            <span>Cancel &amp; Return to Search</span>
          </button>
        )}
      </div>
    </div>
  );
};
