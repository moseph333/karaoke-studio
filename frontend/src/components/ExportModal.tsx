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
  Music,
  Loader2,
  AlignLeft,
} from 'lucide-react';
import { ProjectState, VisualTheme, SyncDisplayMode } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ExportSubtitleSection } from './export/ExportSubtitleSection';
import { ExportAudioSection } from './export/ExportAudioSection';
import { ExportYouTubeKit } from './export/ExportYouTubeKit';
import { Tooltip } from './Tooltip';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';

export interface ExportModalProps {
  project: ProjectState;
  isOpen: boolean;
  onClose: () => void;
  onCancelRender?: () => void;
  onStartRender?: (options?: {
    includeVisualizer?: boolean;
    includeCountdown?: boolean;
    includeChords?: boolean;
    syncMode?: SyncDisplayMode;
  }) => void;
  selectedTheme?: VisualTheme;
  aspectRatio?: '16:9' | '9:16' | string;
  activeSemitones?: number;
  syncMode?: SyncDisplayMode;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  onChangeSyncMode?: (mode: SyncDisplayMode) => void;
  primaryColor?: string;
  secondaryColor?: string;
  fontSizeScale?: number;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  isOpen,
  onClose,
  onCancelRender,
  onStartRender,
  selectedTheme,
  aspectRatio = '16:9',
  activeSemitones,
  syncMode,
  onSyncModeChange,
  onChangeSyncMode,
  primaryColor,
  secondaryColor,
  fontSizeScale,
}) => {
  const { toast } = useToast();
  const [_tick, setTick] = useState(0);
  const [includeVisualizer, setIncludeVisualizer] = useState(false);
  const [includeCountdown] = useState(true);
  const [includeChords, setIncludeChords] = useState(false);
  const [downloadingChordSheet, setDownloadingChordSheet] = useState(false);
  const [chordSheetError, setChordSheetError] = useState<string | null>(null);
  const [renderSyncMode, setRenderSyncMode] = useState<SyncDisplayMode>(syncMode || 'word');

  useEffect(() => {
    if (syncMode) {
      setRenderSyncMode(syncMode);
    }
  }, [syncMode]);

  const handleSyncModeChange = (mode: SyncDisplayMode) => {
    setRenderSyncMode(mode);
    onSyncModeChange?.(mode);
    onChangeSyncMode?.(mode);
  };

  const semitones = activeSemitones ?? project?.semitones ?? 0;

  const handleStartRenderClick = async () => {
    if (onStartRender) {
      const renderOptions: {
        includeVisualizer?: boolean;
        includeCountdown?: boolean;
        includeChords?: boolean;
        syncMode?: SyncDisplayMode;
      } = {
        includeVisualizer,
        includeCountdown,
      };
      if (includeChords) {
        renderOptions.includeChords = true;
      }
      if (syncMode || renderSyncMode !== 'word') {
        renderOptions.syncMode = renderSyncMode;
      }
      onStartRender(renderOptions);
      return;
    }

    try {
      const renderPayload: Record<string, unknown> = {
        semitones: semitones,
        guide_volume: project.guide_volume || 0,
        aspect_ratio: aspectRatio,
        include_visualizer: includeVisualizer,
        include_countdown: includeCountdown,
        ...(includeChords ? { include_chords: true } : {}),
        style_config: {
          ...(selectedTheme ? { theme_id: selectedTheme.id } : {}),
          ...(primaryColor ? { primary_color: primaryColor } : {}),
          ...(secondaryColor ? { secondary_color: secondaryColor } : {}),
          ...(fontSizeScale !== undefined ? { font_size_scale: fontSizeScale } : {}),
          ...(syncMode || renderSyncMode !== 'word' ? { sync_mode: renderSyncMode } : {}),
        },
      };
      if (syncMode || renderSyncMode !== 'word') {
        renderPayload.sync_mode = renderSyncMode;
      }

      await apiFetch(`/api/project/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderPayload),
      });
    } catch (err) {
      console.error('Render request failed:', err);
    }
  };

  const handleDownloadChordSheet = async () => {
    try {
      setDownloadingChordSheet(true);
      setChordSheetError(null);

      const url = `/api/project/${project.id}/export/chord-sheet?semitones=${encodeURIComponent(
        semitones
      )}`;
      const res = await apiFetch(url);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to download chord sheet');
      }

      const blob = await res.blob();
      let filename = `${project.artist || 'Karaoke'} - ${project.title || 'Track'} (Chord Sheet).txt`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition) {
        const rfcMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (rfcMatch && rfcMatch[1]) {
          try {
            filename = decodeURIComponent(rfcMatch[1]);
          } catch {
            filename = rfcMatch[1];
          }
        } else {
          const stdMatch = disposition.match(/filename="?([^";]+)"?/i);
          if (stdMatch && stdMatch[1]) {
            filename = stdMatch[1];
          }
        }
      }

      if (
        typeof window !== 'undefined' &&
        window.URL &&
        typeof window.URL.createObjectURL === 'function'
      ) {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Download started!');
        if (typeof window.URL.revokeObjectURL === 'function') {
          setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
          }, 1500);
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Download started!');
      }
    } catch (err: unknown) {
      console.error('Download chord sheet failed:', err);
      setChordSheetError(err instanceof Error ? err.message : 'Failed to download chord sheet');
    } finally {
      setDownloadingChordSheet(false);
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      aria-describedby="export-modal-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-theme-surface border border-theme-border rounded-t-2xl sm:rounded-theme-xl rounded-b-none sm:rounded-b-theme-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-theme-lg p-4 sm:p-6 relative flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        <Tooltip
          content="Close export dialog"
          position="bottom"
          className="absolute top-3 right-3 sm:top-5 sm:right-5"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-theme-pill bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </Tooltip>

        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-theme-border-subtle pr-12">
          <div className="p-2.5 rounded-theme-md bg-theme-accent/10 text-theme-accent border border-theme-accent/30 shrink-0">
            <Film className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="export-modal-title"
              className="text-lg sm:text-xl font-bold text-theme-text font-theme-heading truncate sm:whitespace-normal"
            >
              Export & YouTube Package
            </h2>
            <p
              id="export-modal-desc"
              className="text-xs text-theme-text-muted font-theme-body truncate"
            >
              {project.title} • {project.artist}
            </p>
          </div>
        </div>

        {/* Dedicated Standalone Subtitle Export Section (Always Available) */}
        <ExportSubtitleSection
          project={project}
          selectedTheme={selectedTheme}
          aspectRatio={aspectRatio}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          fontSizeScale={fontSizeScale}
          activeSemitones={semitones}
          syncMode={
            syncMode !== undefined || renderSyncMode !== 'word' ? renderSyncMode : undefined
          }
          onSyncModeChange={handleSyncModeChange}
        />

        {/* Dedicated Standalone Chord & Lyric Sheet Download Section */}
        <div className="p-3.5 sm:p-5 rounded-theme-lg bg-theme-bg border border-theme-border-subtle mb-6 space-y-3.5 shadow-theme-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Music className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true" />
              <h3 className="text-sm sm:text-base font-bold text-theme-text font-theme-heading truncate">
                Musician Chord & Lyric Sheet
              </h3>
            </div>
            {project?.chords && project.chords.length > 0 && (
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-theme-pill shrink-0">
                {project.chords.length} chords
              </span>
            )}
          </div>
          <p className="text-xs text-theme-text-muted font-theme-body">
            Export an aligned, plain-text/Markdown chord and lyric lead sheet transposed to your
            active key ({semitones >= 0 ? `+${semitones}` : semitones} st) for guitar, piano, and
            live performance.
          </p>

          <div>
            <Tooltip
              content="Download transposed chord & lyric sheet"
              position="top"
              className="w-full sm:w-auto"
            >
              <button
                type="button"
                data-testid="download-chord-sheet-btn"
                onClick={handleDownloadChordSheet}
                disabled={downloadingChordSheet}
                aria-label="Download Chord & Lyric Sheet"
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised active:bg-theme-surface border border-theme-border-subtle hover:border-amber-500/50 text-theme-text font-semibold text-xs sm:text-sm transition-all flex items-center justify-between sm:justify-start gap-3 shadow-theme-sm disabled:opacity-50 disabled:cursor-not-allowed font-theme-heading"
              >
                <div className="flex items-center gap-2.5 min-w-0 text-left">
                  {downloadingChordSheet ? (
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                  ) : (
                    <Music className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="font-bold text-xs sm:text-sm text-theme-text block">
                      Download Chord & Lyric Sheet
                    </span>
                    <span className="text-[10px] text-theme-text-muted block truncate font-theme-body">
                      Aligned Chords • {semitones >= 0 ? `+${semitones}` : semitones} st • UTF-8
                    </span>
                  </div>
                </div>
                <Download className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          {chordSheetError && (
            <div
              role="alert"
              className="text-xs text-red-400 bg-red-950/40 border border-red-800/60 p-2.5 rounded-theme-md font-mono break-words"
            >
              {chordSheetError}
            </div>
          )}
        </div>

        {/* Dedicated Standalone Audio Stem Downloads (Always Available) */}
        <ExportAudioSection project={project} />

        {/* 1. Idle Video State (Before Video Render Started) */}
        {isIdle && (
          <div className="p-5 rounded-theme-lg bg-theme-bg border border-theme-border-subtle text-center space-y-4 shadow-theme-sm">
            <div className="p-3 w-12 h-12 rounded-theme-pill bg-theme-accent/10 border border-theme-accent/30 text-theme-accent mx-auto flex items-center justify-center shadow-theme-sm">
              <Film className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-base font-bold text-theme-text font-theme-heading">
                Full Video Render
              </h3>
              <p className="text-xs text-theme-text-muted font-theme-body mt-1">
                Synthesize a 1080p60 MP4 karaoke video with progressive subtitle wipe animations,
                visual theme, and high-fidelity audio.
              </p>
            </div>

            {/* Render Option Toggles */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
              <label
                data-testid="toggle-export-visualizer-container"
                className="flex items-center gap-3 cursor-pointer select-none min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-theme-md bg-theme-surface border border-theme-border-subtle hover:border-theme-border transition-colors w-full sm:w-auto justify-center sm:justify-start shadow-theme-sm"
              >
                <input
                  type="checkbox"
                  data-testid="toggle-export-visualizer"
                  checked={includeVisualizer}
                  onChange={(e) => setIncludeVisualizer(e.target.checked)}
                  className="min-h-[44px] min-w-[44px] w-5 h-5 rounded border-theme-border-subtle bg-theme-surface-subtle text-theme-accent focus:ring-theme-accent cursor-pointer"
                  aria-label="Include Audio Visualizer"
                />
                <span className="text-xs sm:text-sm font-medium text-theme-text font-theme-body">
                  Include Audio Visualizer
                </span>
              </label>

              <label
                data-testid="include-chords-video-container"
                className="flex items-center gap-3 cursor-pointer select-none min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-theme-md bg-theme-surface border border-theme-border-subtle hover:border-theme-border transition-colors w-full sm:w-auto justify-center sm:justify-start shadow-theme-sm"
              >
                <input
                  type="checkbox"
                  data-testid="include-chords-video-checkbox"
                  checked={includeChords}
                  onChange={(e) => setIncludeChords(e.target.checked)}
                  className="min-h-[44px] min-w-[44px] w-5 h-5 rounded border-theme-border-subtle bg-theme-surface-subtle text-purple-500 focus:ring-purple-400 cursor-pointer"
                  aria-label="Burn Chords into Video"
                />
                <span className="text-xs sm:text-sm font-medium text-theme-text font-theme-body">
                  Burn Chords into Video
                </span>
              </label>
            </div>

            {/* Video Render Sync Mode Selector */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="text-xs text-theme-text-muted font-medium font-theme-body">
                Sync Display:
              </span>
              <div
                data-testid="export-sync-mode-selector"
                role="group"
                aria-label="Video render synchronization mode"
                className="inline-flex p-1 rounded-theme-md bg-theme-surface border border-theme-border-subtle shadow-theme-sm"
              >
                <button
                  type="button"
                  data-testid="export-sync-mode-word"
                  aria-pressed={renderSyncMode === 'word'}
                  aria-label="Word Sweep video render"
                  onClick={() => handleSyncModeChange('word')}
                  className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-theme-sm text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-theme-accent font-theme-heading ${
                    renderSyncMode === 'word'
                      ? 'bg-theme-accent text-theme-accent-text font-bold shadow-theme-sm'
                      : 'text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  Word Sweep (\kf)
                </button>
                <button
                  type="button"
                  data-testid="export-sync-mode-line"
                  aria-pressed={renderSyncMode === 'line'}
                  aria-label="Line-by-Line video render"
                  onClick={() => handleSyncModeChange('line')}
                  className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-theme-sm text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-theme-accent font-theme-heading ${
                    renderSyncMode === 'line'
                      ? 'bg-theme-accent text-theme-accent-text font-bold shadow-theme-sm'
                      : 'text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  Line-by-Line (Solid)
                </button>
              </div>
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
                  className="min-h-[44px] px-5 py-2.5 rounded-theme-md bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-bold text-xs sm:text-sm transition-all shadow-theme-sm border border-theme-border inline-flex items-center justify-center gap-2 w-full sm:w-auto font-theme-heading"
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
                  onClick={() => toast.success('Download started!')}
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
