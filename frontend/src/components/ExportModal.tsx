/**
 * Export Modal Component
 *
 * The export hub, ordered by what people export most: the karaoke video (render options,
 * live progress, preview and download), then subtitles, audio stems, the musician chord
 * sheet and the YouTube metadata kit.
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  Film,
  Sparkles,
  Youtube,
  Clock,
  Activity,
  XCircle,
  Music,
  Loader2,
  AlignLeft,
  AlertCircle,
} from 'lucide-react';
import { ProjectState, VisualTheme, SyncDisplayMode } from '../types';
import { ExportSubtitleSection } from './export/ExportSubtitleSection';
import { ExportAudioSection } from './export/ExportAudioSection';
import { ExportYouTubeKit } from './export/ExportYouTubeKit';
import { ExportCheckOption } from './export/ExportCheckOption';
import {
  EXPORT_DOWNLOAD_BTN,
  EXPORT_ERROR,
  EXPORT_HEADING,
  EXPORT_PILL,
  EXPORT_SECTION,
} from './export/exportStyles';
import { Tooltip } from './Tooltip';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';
import { Dialog, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/Progress';
import { SegmentedControl } from './ui/SegmentedControl';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';

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
  /** Duet sung colors from the Look panel (sent only when provided). */
  singer2Color?: string;
  bothColor?: string;
  /** Preset backdrop the renderer uses when there is no artwork or custom background. */
  backgroundColor?: string;
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
  singer2Color,
  bothColor,
  backgroundColor,
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
  const [videoAspect, setVideoAspect] = useState<number | null>(null);

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
          ...(singer2Color ? { singer2_color: singer2Color } : {}),
          ...(bothColor ? { both_color: bothColor } : {}),
          ...(backgroundColor ? { background_color: backgroundColor } : {}),
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

  // Re-render every second while open to keep heartbeat and elapsed timers live
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    setVideoAspect(null);
  }, [project.video_url]);

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
  // Size the preview from the rendered file once known; until then trust the format setting.
  const previewAspect = videoAspect ?? (aspectRatio === '9:16' ? 9 / 16 : 16 / 9);
  const isPortraitPreview = previewAspect < 1;
  const keyLabel = semitones >= 0 ? `+${semitones}` : `${semitones}`;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="export-modal-title"
      descriptionId="export-modal-desc"
      size="3xl"
      showDragHandle
    >
      <DialogHeader
        title="Export & YouTube Package"
        titleId="export-modal-title"
        description={`${project.title} • ${project.artist}`}
        descriptionId="export-modal-desc"
        icon={<Film className="h-5 w-5" />}
        onClose={onClose}
        closeLabel="Close export dialog"
      />

      <div className="space-y-5">
        {/* 1. Karaoke video */}
        <section aria-labelledby="export-video-heading" className={EXPORT_SECTION}>
          <div className="flex items-center justify-between gap-2">
            <h3 id="export-video-heading" className={EXPORT_HEADING}>
              <Film className="h-5 w-5 text-theme-highlight" aria-hidden="true" />
              {isRendering
                ? 'Rendering High-Definition Karaoke Video...'
                : isCompleted
                  ? 'Your Video Is Ready!'
                  : isError
                    ? 'Rendering Encountered an Error'
                    : 'Full Video Render'}
            </h3>
            <span
              className={cn(
                EXPORT_PILL,
                'border-theme-border-subtle font-mono font-normal text-theme-text-muted'
              )}
            >
              {aspectRatio === '9:16' ? '9:16 Shorts' : '16:9'} · 1080p60
            </span>
          </div>

          {isIdle && (
            <div className="space-y-4">
              <p className="text-xs text-theme-text-muted">
                Synthesize a 1080p60 MP4 karaoke video with progressive subtitle wipe animations,
                visual theme, and high-fidelity audio.
              </p>

              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <ExportCheckOption
                  label="Include Audio Visualizer"
                  checked={includeVisualizer}
                  onChange={setIncludeVisualizer}
                  testId="toggle-export-visualizer"
                  containerTestId="toggle-export-visualizer-container"
                />
                <ExportCheckOption
                  label="Burn Chords into Video"
                  checked={includeChords}
                  onChange={setIncludeChords}
                  testId="include-chords-video-checkbox"
                  containerTestId="include-chords-video-container"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-theme-text-muted">Sync Display:</span>
                <SegmentedControl<SyncDisplayMode>
                  ariaLabel="Video render synchronization mode"
                  testId="export-sync-mode-selector"
                  value={renderSyncMode}
                  onChange={handleSyncModeChange}
                  tone="neutral"
                  size="sm"
                  options={[
                    {
                      value: 'word',
                      label: 'Word Sweep (\\kf)',
                      ariaLabel: 'Word Sweep video render',
                      testId: 'export-sync-mode-word',
                      icon: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />,
                    },
                    {
                      value: 'line',
                      label: 'Line-by-Line (Solid)',
                      ariaLabel: 'Line-by-Line video render',
                      testId: 'export-sync-mode-line',
                      icon: <AlignLeft className="h-3.5 w-3.5" aria-hidden="true" />,
                    },
                  ]}
                  optionClassName="min-w-[44px]"
                />
              </div>

              <Tooltip
                content="Render 1080p60 MP4 video"
                position="top"
                className="w-full sm:w-auto"
              >
                <Button
                  variant="gradient"
                  fullWidth="mobile"
                  onClick={handleStartRenderClick}
                  aria-label="Start video render"
                  leftIcon={<Film className="h-4 w-4" aria-hidden="true" />}
                >
                  Render 1080p Video
                </Button>
              </Tooltip>
            </div>
          )}

          {isRendering && (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="inline-flex items-center gap-2 rounded-theme-pill border border-theme-success/35 bg-theme-success/10 px-3.5 py-1.5 text-xs font-medium text-theme-success">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-theme-success opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-theme-success" />
                </span>
                <span>FFmpeg Encoder Active • {getHeartbeatText(project.render_heartbeat)}</span>
              </div>
              <p className="break-words rounded-theme-md border border-theme-border-subtle bg-theme-surface px-3 py-2 font-mono text-xs text-theme-text-muted">
                {project.render_detail ||
                  'Synthesizing word-by-word progressive wipe subtitles, ambient visuals, and master audio with FFmpeg.'}
              </p>
              <div className="space-y-2">
                <ProgressBar
                  value={Math.max(5, project.render_progress || 5)}
                  label="Video render progress"
                  tone="gradient"
                />
                <div className="flex flex-col justify-between gap-2 px-1 font-mono text-xs text-theme-text-muted sm:flex-row sm:items-center">
                  <span className="flex items-center gap-1.5 text-theme-highlight">
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                    {project.render_progress || 5}% Complete
                  </span>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Elapsed: {formatTimer(project.render_elapsed_seconds)}
                    </span>
                    <span className="text-theme-text">
                      Est. remaining:{' '}
                      {project.render_eta_seconds !== undefined &&
                      project.render_eta_seconds !== null
                        ? `~${formatTimer(project.render_eta_seconds)}`
                        : 'Calculating...'}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={onCancelRender}
                leftIcon={<XCircle className="h-3.5 w-3.5 text-theme-danger" aria-hidden="true" />}
              >
                Cancel Render
              </Button>
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-2.5 rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-3.5 text-left">
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-theme-danger"
                aria-hidden="true"
              />
              <p className="break-words font-mono text-xs text-theme-danger">
                {project.render_error || 'Unknown rendering error'}
              </p>
            </div>
          )}

          {isCompleted && (
            <div className="space-y-4">
              {project.video_url && (
                <div
                  className={cn(
                    'w-full overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-black shadow-theme-md',
                    isPortraitPreview && 'mx-auto max-w-xs'
                  )}
                  style={{ aspectRatio: previewAspect }}
                >
                  <video
                    src={project.video_url}
                    crossOrigin="use-credentials"
                    controls
                    className="h-full w-full object-contain"
                    onLoadedMetadata={(e) => {
                      const { videoWidth, videoHeight } = e.currentTarget;
                      if (videoWidth > 0 && videoHeight > 0)
                        setVideoAspect(videoWidth / videoHeight);
                    }}
                  />
                </div>
              )}
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-xs text-theme-text-muted">
                  High-bitrate 1080p60 MP4 with AAC 320kbps stereo audio.
                </p>
                <div className="flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                  <a
                    href={project.video_url}
                    download={`${project.artist || 'Karaoke'} - ${project.title || 'Track'}.mp4`}
                    onClick={() => toast.success('Download started!')}
                    className={cn(
                      'flex min-h-[44px] w-full items-center justify-center gap-2 rounded-theme-md bg-gradient-accent px-5 py-2.5 text-sm font-bold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110 sm:w-auto',
                      focusRing
                    )}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download Video (.mp4)
                  </a>
                  <a
                    href="https://studio.youtube.com"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised px-4 py-2.5 text-sm font-medium text-theme-text transition-colors hover:border-theme-border sm:w-auto',
                      focusRing
                    )}
                  >
                    <Youtube className="h-4 w-4 text-theme-danger" aria-hidden="true" />
                    Open YouTube Studio
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 2. Subtitles */}
        <ExportSubtitleSection
          project={project}
          selectedTheme={selectedTheme}
          aspectRatio={aspectRatio}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          singer2Color={singer2Color}
          bothColor={bothColor}
          fontSizeScale={fontSizeScale}
          activeSemitones={semitones}
          syncMode={
            syncMode !== undefined || renderSyncMode !== 'word' ? renderSyncMode : undefined
          }
          onSyncModeChange={handleSyncModeChange}
        />

        {/* 3. Audio stems */}
        <ExportAudioSection project={project} />

        {/* 4. Chord & lyric sheet */}
        <section aria-labelledby="export-chord-sheet-heading" className={EXPORT_SECTION}>
          <div className="flex items-center justify-between gap-2">
            <h3 id="export-chord-sheet-heading" className={cn(EXPORT_HEADING, 'truncate')}>
              <Music className="h-5 w-5 shrink-0 text-theme-warning" aria-hidden="true" />
              Musician Chord & Lyric Sheet
            </h3>
            {project?.chords && project.chords.length > 0 && (
              <span
                className={cn(
                  EXPORT_PILL,
                  'border-theme-warning/30 bg-theme-warning/10 text-theme-warning'
                )}
              >
                {project.chords.length} chords
              </span>
            )}
          </div>
          <p className="text-xs text-theme-text-muted">
            Export an aligned, plain-text/Markdown chord and lyric lead sheet transposed to your
            active key ({keyLabel} st) for guitar, piano, and live performance.
          </p>
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
              className={cn(
                EXPORT_DOWNLOAD_BTN,
                'hover:border-theme-warning/50 sm:w-auto sm:justify-start'
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5 text-left">
                {downloadingChordSheet ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 text-theme-warning animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Music className="h-4 w-4 shrink-0 text-theme-warning" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-theme-text sm:text-sm">
                    Download Chord & Lyric Sheet
                  </span>
                  <span className="block truncate text-[10px] text-theme-text-muted">
                    Aligned Chords • {keyLabel} st • UTF-8
                  </span>
                </div>
              </div>
              <Download className="h-4 w-4 shrink-0 text-theme-warning" aria-hidden="true" />
            </button>
          </Tooltip>
          {chordSheetError && (
            <div role="alert" className={EXPORT_ERROR}>
              {chordSheetError}
            </div>
          )}
        </section>

        {/* 5. YouTube metadata kit (after a completed render) */}
        {isCompleted && yt && <ExportYouTubeKit youtubePackage={yt} />}
      </div>
    </Dialog>
  );
};
