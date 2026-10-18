/**
 * Processing View Component
 *
 * Displays the audio processing pipeline progress screen with active engine heartbeat,
 * dynamic stage details, progress bar, elapsed/eta timers, and terminal state cards.
 */

import React from 'react';
import { Sparkles, AlertCircle, Clock, Activity, XCircle } from 'lucide-react';
import { ProjectState } from '../types';

export interface ProcessingViewProps {
  project: ProjectState;
  onCancelProcess: () => void;
  onResetProject: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  project,
  onCancelProcess,
  onResetProject,
}) => {
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

  if (project.status === 'cancelled') {
    return (
      <div className="max-w-md mx-auto py-8 sm:py-16 text-center space-y-4">
        <div className="p-3 w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center">
          <XCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Track Processing Cancelled</h2>
        <p className="text-xs text-slate-400">
          The processing job was aborted. You can search or select a new song anytime.
        </p>
        <button
          type="button"
          onClick={onResetProject}
          className="min-h-[40px] px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
        >
          Search Another Song
        </button>
      </div>
    );
  }

  if (project.status === 'error') {
    return (
      <div className="max-w-md mx-auto py-8 sm:py-16 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Track Processing Failed</h2>
        <p className="text-xs text-red-300 font-mono bg-red-950/40 p-4 rounded-xl border border-red-800/60 break-words">
          {project.error || 'An unexpected error occurred during processing.'}
        </p>
        <button
          type="button"
          onClick={onResetProject}
          className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
        >
          Try Another Track
        </button>
      </div>
    );
  }

  return (
    <div
      className="max-w-xl mx-auto py-8 sm:py-16 text-center space-y-6"
      role="status"
      aria-live="polite"
    >
      <div className="relative w-24 h-24 mx-auto">
        <div className="w-full h-full border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin motion-reduce:animate-none"></div>
        <Sparkles
          className="absolute inset-0 m-auto w-8 h-8 text-cyan-400 animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>

      {/* Live Heartbeat Badge */}
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span>Engine Active • {getHeartbeatText(project.heartbeat)}</span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-white capitalize font-['Montserrat']">
          {project.status.replace('_', ' ')}...
        </h2>
        <p className="text-xs text-slate-300 mt-2 font-mono max-w-md mx-auto bg-slate-950/60 py-2.5 px-3.5 rounded-xl border border-slate-800 break-words">
          {project.status_detail ||
            (project.status === 'downloading'
              ? 'Fetching high-fidelity audio and cover art...'
              : project.status === 'separating'
                ? 'Isolating vocals and backing instrumental track with Demucs AI...'
                : project.status === 'fetching_lyrics'
                  ? 'Retrieving synchronized lyrics from LRCLIB database...'
                  : project.status === 'aligning'
                    ? 'Running forced acoustic alignment for word-by-word timing...'
                    : project.status === 'mixing'
                      ? 'Synthesizing master stereo mix...'
                      : 'Processing audio track...')}
        </p>
      </div>

      {/* Progress Bar & Timers */}
      <div className="max-w-md mx-auto space-y-2">
        <div className="w-full bg-slate-950 border border-slate-800 h-3 rounded-full overflow-hidden p-0.5 shadow-inner">
          <div
            className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500 shadow-md shadow-cyan-500/30"
            style={{ width: `${Math.max(5, project.progress)}%` }}
          ></div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 text-[11px] sm:text-xs text-slate-400 px-1 font-mono">
          <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
            <Activity className="w-3.5 h-3.5" />
            {project.progress}% Complete
          </span>
          <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-500" />
              Elapsed: {formatTimer(project.elapsed_seconds)}
            </span>
            <span className="text-slate-200">
              Est. remaining:{' '}
              {project.eta_seconds !== undefined && project.eta_seconds !== null
                ? `~${formatTimer(project.eta_seconds)}`
                : 'Calculating...'}
            </span>
          </div>
        </div>
      </div>

      {/* Cancel & Return to Search */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onCancelProcess}
          className="min-h-[40px] px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-md"
        >
          <XCircle className="w-3.5 h-3.5 text-red-400" />
          Cancel & Return to Search
        </button>
      </div>
    </div>
  );
};
