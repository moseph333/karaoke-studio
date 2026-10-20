/**
 * Export Modal Component
 *
 * Orchestrates video rendering lifecycle (queued, rendering, error, completed),
 * preview player, video download, YouTube studio launch, and mounts standalone
 * subtitle export and YouTube metadata kit subcomponents.
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  X,
  Film,
  Sparkles,
  Youtube,
  Clock,
  Activity,
  XCircle,
} from 'lucide-react';
import { ProjectState, VisualTheme } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ExportSubtitleSection } from './export/ExportSubtitleSection';
import { ExportAudioSection } from './export/ExportAudioSection';
import { ExportYouTubeKit } from './export/ExportYouTubeKit';
import { Tooltip } from './Tooltip';
import { apiFetch } from '../api';

export interface ExportModalProps {
  project: ProjectState;
  isOpen: boolean;
  onClose: () => void;
  onCancelRender?: () => void;
  onStartRender?: (options?: { includeVisualizer?: boolean; includeCountdown?: boolean }) => void;
  selectedTheme?: VisualTheme;
  aspectRatio?: '16:9' | '9:16' | string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  isOpen,
  onClose,
  onCancelRender,
  onStartRender,
  selectedTheme,
  aspectRatio = '16:9',
}) => {
  const [_tick, setTick] = useState(0);
  const [includeVisualizer, setIncludeVisualizer] = useState(false);
  const [includeCountdown] = useState(true);

  const handleStartRenderClick = async () => {
    if (onStartRender) {
      onStartRender({ includeVisualizer, includeCountdown });
      return;
    }

    try {
      await apiFetch(`/api/project/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semitones: project.semitones || 0,
          guide_volume: project.guide_volume || 0,
          aspect_ratio: aspectRatio,
          include_visualizer: includeVisualizer,
          include_countdown: includeCountdown,
          style_config: selectedTheme ? { theme_id: selectedTheme.id } : undefined,
        }),
      });
    } catch (err) {
      console.error('Render request failed:', err);
    }
  };

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
  });

  // Re-render every second while rendering to keep heartbeat and elapsed timer live
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const isRendering = project.render_status === 'queued' || project.render_status === 'rendering';
  const isCompleted = project.render_status === 'completed';
  const isError = project.render_status === 'error';
  const isIdle = !isRendering && !isCompleted && !isError;

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

  const yt = project.youtube_package;

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      aria-describedby="export-modal-desc"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-4 sm:p-6 relative">
        <Tooltip
          content="Close export dialog"
          position="bottom"
          className="absolute top-3 right-3 sm:top-5 sm:right-5"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </Tooltip>

        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800 pr-12">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shrink-0">
            <Film className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="export-modal-title"
              className="text-lg sm:text-xl font-bold text-white truncate sm:whitespace-normal"
            >
              Export & YouTube Package
            </h2>
            <p id="export-modal-desc" className="text-xs text-slate-400 truncate">
              {project.title} • {project.artist}
            </p>
          </div>
        </div>

        {/* Dedicated Standalone Subtitle Export Section (Always Available) */}
        <ExportSubtitleSection
          project={project}
          selectedTheme={selectedTheme}
          aspectRatio={aspectRatio}
        />

        {/* Dedicated Standalone Audio Stem Downloads (Always Available) */}
        <ExportAudioSection project={project} />

        {/* 1. Idle Video State (Before Video Render Started) */}
        {isIdle && (
          <div className="p-5 rounded-2xl bg-slate-950/40 border border-slate-800/60 text-center space-y-4">
            <div className="p-3 w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mx-auto flex items-center justify-center">
              <Film className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-base font-bold text-white">Full Video Render</h3>
              <p className="text-xs text-slate-400 mt-1">
                Synthesize a 1080p60 MP4 karaoke video with progressive subtitle wipe animations,
                visual theme, and high-fidelity audio.
              </p>
            </div>

            {/* Render Option Toggles */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
              <label
                data-testid="toggle-export-visualizer-container"
                className="flex items-center gap-3 cursor-pointer select-none min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors w-full sm:w-auto justify-center sm:justify-start"
              >
                <input
                  type="checkbox"
                  data-testid="toggle-export-visualizer"
                  checked={includeVisualizer}
                  onChange={(e) => setIncludeVisualizer(e.target.checked)}
                  className="min-h-[44px] min-w-[44px] w-5 h-5 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-400 focus:ring-offset-slate-900 cursor-pointer"
                  aria-label="Include Audio Visualizer"
                />
                <span className="text-xs sm:text-sm font-medium text-slate-300">
                  Include Audio Visualizer
                </span>
              </label>
            </div>

            <div className="pt-2">
              <Tooltip
                content="Render 1080p60 MP4 video"
                position="top"
                className="w-full sm:w-auto"
              >
                <button
                  type="button"
                  onClick={handleStartRenderClick}
                  aria-label="Start video render"
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-cyan-500/20 inline-flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                  <Film className="w-4 h-4" />
                  Render 1080p Video
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* 2. Rendering In-Progress State */}
        {isRendering && (
          <div className="py-10 text-center space-y-6" role="status" aria-live="polite">
            <div className="relative w-20 h-20 mx-auto">
              <div className="w-full h-full border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin motion-reduce:animate-none"></div>
              <Sparkles
                className="absolute inset-0 m-auto w-7 h-7 text-cyan-400 animate-pulse motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>

            {/* Heartbeat Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>FFmpeg Encoder Active • {getHeartbeatText(project.render_heartbeat)}</span>
            </div>

            <div>
              <h3 className="text-xl font-bold text-white font-['Montserrat']">
                Rendering High-Definition Karaoke Video...
              </h3>
              <p className="text-xs text-slate-300 mt-2 font-mono max-w-md mx-auto bg-slate-950/60 py-2 px-3 rounded-xl border border-slate-800">
                {project.render_detail ||
                  'Synthesizing word-by-word progressive wipe subtitles, ambient visuals, and master audio with FFmpeg.'}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="max-w-md mx-auto space-y-2">
              <div className="w-full bg-slate-950 border border-slate-800 h-3 rounded-full overflow-hidden p-0.5 shadow-inner">
                <div
                  className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full rounded-full transition-all duration-300 shadow-lg shadow-cyan-500/30"
                  style={{ width: `${Math.max(5, project.render_progress || 5)}%` }}
                ></div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 px-1 font-mono">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <Activity className="w-3.5 h-3.5" />
                  {project.render_progress || 5}% Complete
                </span>
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    Elapsed: {formatTimer(project.render_elapsed_seconds)}
                  </span>
                  <span className="text-slate-200">
                    Est. remaining:{' '}
                    {project.render_eta_seconds !== undefined && project.render_eta_seconds !== null
                      ? `~${formatTimer(project.render_eta_seconds)}`
                      : 'Calculating...'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cancel Render Option */}
            <div className="pt-2">
              <button
                type="button"
                onClick={onCancelRender}
                className="px-4 py-2 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all inline-flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                Cancel Render
              </button>
            </div>
          </div>
        )}

        {/* 2. Error State */}
        {isError && (
          <div className="p-6 bg-red-950/40 border border-red-800/60 rounded-2xl text-center space-y-3">
            <h3 className="text-base font-bold text-red-400">Rendering Encountered an Error</h3>
            <p className="text-xs text-red-300 font-mono">
              {project.render_error || 'Unknown rendering error'}
            </p>
          </div>
        )}

        {/* 3. Completed State: Video Player + YouTube Kit */}
        {isCompleted && (
          <div className="space-y-6">
            {/* Video Player */}
            {project.video_url && (
              <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-xl">
                <video
                  src={project.video_url}
                  crossOrigin="use-credentials"
                  controls
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Download Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <div>
                <h4 className="text-sm font-bold text-white">Your Video Is Ready!</h4>
                <p className="text-xs text-slate-400">
                  High-bitrate 1080p60 MP4 with AAC 320kbps stereo audio.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                <a
                  href={project.video_url}
                  download={`${project.artist || 'Karaoke'} - ${project.title || 'Track'}.mp4`}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto"
                >
                  <Download className="w-4 h-4" />
                  Download Video (.mp4)
                </a>
                <a
                  href="https://studio.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm transition-all flex items-center justify-center gap-1.5 shadow-md shadow-red-600/20 min-h-[44px] w-full sm:w-auto"
                >
                  <Youtube className="w-4 h-4" />
                  Open YouTube Studio
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* YouTube Ready-To-Copy Metadata Kit */}
            {yt && <ExportYouTubeKit youtubePackage={yt} />}
          </div>
        )}
      </div>
    </div>
  );
};
