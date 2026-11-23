/**
 * Export Modal Component
 *
 * The export hub, ordered by what people export most: the karaoke video (render options,
 * live progress, preview, download and rendering again), then subtitles, audio stems, the
 * musician chord sheet and the YouTube metadata kit.
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, AlertTriangle, Download, ExternalLink, Loader2 } from 'lucide-react';
import { ProjectState, SyncDisplayMode } from '../types';
import { DEFAULT_STAGE_LOOK_ID, type StageLook } from '../theme/stageLooks';
import { renderStyleConfig } from '../utils/renderRequest';
import { ExportSubtitleSection } from './export/ExportSubtitleSection';
import { ExportAudioSection } from './export/ExportAudioSection';
import { ExportNextSteps } from './export/ExportNextSteps';
import { ExportYouTubeKit } from './export/ExportYouTubeKit';
import { ExportCheckOption } from './export/ExportCheckOption';
import {
  EXPORT_DOWNLOAD_BTN,
  EXPORT_ERROR,
  EXPORT_HEADING,
  EXPORT_NOTE,
  EXPORT_SECTION,
} from './export/exportStyles';
import { Tooltip } from './Tooltip';
import { apiFetch, readApiError } from '../api';
import { useToast } from '../hooks/useToast';
import { useNow } from '../hooks/useNow';
import { formatTimer, formatSemitonesShort } from '../utils/format';
import { Dialog, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';
import { InlineConfirm } from './ui/InlineConfirm';
import { ProgressBar } from './ui/Progress';
import { SegmentedControl } from './ui/SegmentedControl';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';

const RENDER_WARMUP_URL = '/api/render/warmup';
// Each format keeps its own file, so the other format's latest video stays downloadable
const VIDEO_FORMATS = ['16:9', '9:16'] as const;
type VideoFormat = (typeof VIDEO_FORMATS)[number];
// The secondary links next to the main download (YouTube Studio, other formats, kept videos)
const SECONDARY_LINK =
  'ks-display flex min-h-[44px] w-full items-center justify-center gap-2 border border-theme-border px-4 text-[22px] text-theme-text transition-colors hover:bg-theme-text hover:text-theme-text-inverse sm:w-auto';
// No word from the renderer for this long counts as quiet
const RENDER_QUIET_AFTER_MS = 15000;

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
  selectedTheme?: StageLook;
  aspectRatio?: '16:9' | '9:16' | string;
  activeSemitones?: number;
  syncMode?: SyncDisplayMode;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  primaryColor?: string;
  secondaryColor?: string;
  /** Duet sung colors from the Look panel (sent only when provided). */
  singer2Color?: string;
  bothColor?: string;
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
  primaryColor,
  secondaryColor,
  singer2Color,
  bothColor,
  fontSizeScale,
}) => {
  const { toast } = useToast();
  const [includeVisualizer, setIncludeVisualizer] = useState(false);
  const [includeCountdown] = useState(true);
  const [includeChords, setIncludeChords] = useState(false);
  const [downloadingChordSheet, setDownloadingChordSheet] = useState(false);
  const [chordSheetError, setChordSheetError] = useState<string | null>(null);
  const [renderSyncMode, setRenderSyncMode] = useState<SyncDisplayMode>(syncMode || 'word');
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  // "Render Again" and "Try Again" bring the render options back over a finished or failed
  // export; a finished video stays until a new render in the same format replaces it
  const [renderAgain, setRenderAgain] = useState(false);

  useEffect(() => {
    if (syncMode) {
      setRenderSyncMode(syncMode);
    }
  }, [syncMode]);

  const handleSyncModeChange = (mode: SyncDisplayMode) => {
    setRenderSyncMode(mode);
    onSyncModeChange?.(mode);
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
        style_config: renderStyleConfig({
          lookId: selectedTheme?.id ?? DEFAULT_STAGE_LOOK_ID,
          sung: primaryColor,
          unsung: secondaryColor,
          singer2: singer2Color,
          both: bothColor,
          fontSizeScale,
          syncMode: syncMode || renderSyncMode !== 'word' ? renderSyncMode : undefined,
        }),
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
        throw new Error(await readApiError(res, 'Failed to download chord sheet'));
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

  // Have the server start a cloud CPU while options are chosen (it does nothing when exports
  // render locally). A beacon is fire-and-forget and carries the session cookie; if it fails,
  // the render simply waits for a CPU itself
  useEffect(() => {
    if (!isOpen || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(RENDER_WARMUP_URL);
    } catch {
      // Ignored: the warm-up is only a head start
    }
  }, [isOpen]);

  useEffect(() => {
    setVideoAspect(null);
  }, [project.video_url]);

  const isRendering = project.render_status === 'queued' || project.render_status === 'rendering';
  // Advances the "Pulse Ns ago" label between polls while a render shows
  const now = useNow(1000, isOpen && isRendering);
  const isRenderQuiet = Boolean(
    isRendering &&
    project.render_heartbeat &&
    now - project.render_heartbeat > RENDER_QUIET_AFTER_MS
  );

  // Show the finished video (or the error) again once a render starts or the dialog reopens
  useEffect(() => {
    if (!isOpen || isRendering) setRenderAgain(false);
  }, [isOpen, isRendering]);

  const isCompleted = project.render_status === 'completed' && !renderAgain;
  const isError = project.render_status === 'error' && !renderAgain;
  const isIdle = !isRendering && !isCompleted && !isError;
  const replacingVideo = renderAgain && project.render_status === 'completed';
  const selectedFormat: VideoFormat = aspectRatio === '9:16' ? '9:16' : '16:9';
  // The latest video's format; legacy projects without videos_by_aspect don't record it
  const latestVideoFormat = project.video_url
    ? VIDEO_FORMATS.find((aspect) => project.videos_by_aspect?.[aspect] === project.video_url)
    : undefined;
  // Every download is named after its format, so the same file keeps its name whichever
  // format was rendered last
  const videoFileBase = `${project.artist || 'Karaoke'} - ${project.title || 'Track'}`;
  const videoFileName = (aspect?: VideoFormat) =>
    aspect ? `${videoFileBase} (${aspect.replace(':', 'x')}).mp4` : `${videoFileBase}.mp4`;
  const otherVideos = VIDEO_FORMATS.flatMap((aspect) => {
    const url = project.videos_by_aspect?.[aspect];
    return url && url !== project.video_url ? [{ aspect, url }] : [];
  });
  // A failed or cancelled render keeps the song's earlier videos, which stay downloadable:
  // the one in the format being rendered first, then the other format's
  const keptVideos: { aspect?: VideoFormat; url: string }[] = [];
  if (isError || (isIdle && !replacingVideo)) {
    const selectedUrl = project.videos_by_aspect?.[selectedFormat];
    if (selectedUrl) keptVideos.push({ aspect: selectedFormat, url: selectedUrl });
    else if (project.video_url)
      keptVideos.push({ aspect: latestVideoFormat, url: project.video_url });
    for (const aspect of VIDEO_FORMATS) {
      const url = project.videos_by_aspect?.[aspect];
      if (url && !keptVideos.some((kept) => kept.url === url)) keptVideos.push({ aspect, url });
    }
  }
  const keptVideoLinks = keptVideos.map(({ aspect, url }) => (
    <a
      key={url}
      href={url}
      download={videoFileName(aspect)}
      onClick={() => toast.success('Download started!')}
      className={cn(SECONDARY_LINK, focusRing)}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {aspect ? `Download previous ${aspect} video` : 'Download previous video'}
    </a>
  ));
  // The finished state describes the video it offers, which may be in the other format
  const shownFormat: VideoFormat = (isCompleted && latestVideoFormat) || selectedFormat;

  const yt = project.youtube_package;
  // Size the preview from the rendered file once known; until then trust its recorded format.
  const previewAspect = videoAspect ?? (shownFormat === '9:16' ? 9 / 16 : 16 / 9);
  const isPortraitPreview = previewAspect < 1;
  const keyLabel = formatSemitonesShort(semitones);

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
        title="Export"
        titleId="export-modal-title"
        description={`${project.title} • ${project.artist}`}
        descriptionId="export-modal-desc"
        onClose={onClose}
        closeLabel="Close export dialog"
      />

      <div className="space-y-5">
        {/* 1. Karaoke video */}
        <section aria-labelledby="export-video-heading" className={EXPORT_SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 id="export-video-heading" className={EXPORT_HEADING}>
              {isRendering
                ? 'Rendering the video'
                : isCompleted
                  ? 'Your video is ready'
                  : isError
                    ? 'The video did not render'
                    : 'Karaoke video'}
            </h3>
            <span className={EXPORT_NOTE}>
              {shownFormat === '9:16' ? '9:16 Shorts' : '16:9'}, 1080p60
            </span>
          </div>

          {isIdle && (
            <div className="space-y-4">
              <p className="text-pretty text-sm text-theme-text-muted">
                Makes a 1080p karaoke video of the song as it is now: its lyrics and timing, the key
                and guide vocal from Audio mix, and the look and format (16:9 or 9:16 Shorts) from
                Stage look.
              </p>
              {/* A song's first export: what the button starts, and what comes after */}
              {!project.video_url && <ExportNextSteps />}
              {replacingVideo && (
                <p className="text-sm text-theme-text">
                  Your current video stays available until a new render in the same format replaces
                  it.
                </p>
              )}

              <div className="flex flex-col gap-x-6 sm:flex-row sm:items-center">
                <ExportCheckOption
                  label="Show the audio visualizer"
                  checked={includeVisualizer}
                  onChange={setIncludeVisualizer}
                  testId="toggle-export-visualizer"
                  containerTestId="toggle-export-visualizer-container"
                />
                <ExportCheckOption
                  label="Show the chords"
                  checked={includeChords}
                  onChange={setIncludeChords}
                  testId="include-chords-video-checkbox"
                  containerTestId="include-chords-video-container"
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="text-sm font-semibold text-theme-text">Lyrics light up</span>
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
                      label: 'Word by word',
                      testId: 'export-sync-mode-word',
                    },
                    {
                      value: 'line',
                      label: 'Line by line',
                      testId: 'export-sync-mode-line',
                    },
                  ]}
                  optionClassName="min-w-[44px]"
                />
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Tooltip
                  content="Render 1080p60 MP4 video"
                  position="top"
                  className="w-full sm:w-auto"
                >
                  <Button variant="primary" fullWidth="mobile" onClick={handleStartRenderClick}>
                    Render 1080p Video
                  </Button>
                </Tooltip>
                {replacingVideo && (
                  <Button variant="ghost" fullWidth="mobile" onClick={() => setRenderAgain(false)}>
                    Keep Current Video
                  </Button>
                )}
                {keptVideoLinks}
              </div>
            </div>
          )}

          {/* Not a live region: it refreshes every second. RenderProgressAnnouncer reads out
              the start and each quarter instead. */}
          {isRendering && (
            <div className="space-y-4">
              <div className="flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:items-end">
                {/* The bar below carries the value for screen readers */}
                <p
                  aria-hidden="true"
                  data-testid="render-percent"
                  className="ks-display shrink-0 text-[72px] font-black leading-[0.85] tabular-nums text-theme-text"
                >
                  {project.render_progress || 5}%
                </p>
                <div className="min-w-0 space-y-1 sm:pb-0.5">
                  <p className="break-words text-sm text-theme-text-muted">
                    {project.render_detail ||
                      'Drawing the lyrics over the background and joining the audio.'}
                  </p>
                  <p className="flex flex-wrap gap-x-6 text-sm tabular-nums text-theme-text">
                    <span>{formatTimer(project.render_elapsed_seconds)} so far</span>
                    <span>
                      {project.render_eta_seconds !== undefined &&
                      project.render_eta_seconds !== null
                        ? `About ${formatTimer(project.render_eta_seconds)} left`
                        : 'Working out the time left'}
                    </span>
                  </p>
                </div>
              </div>
              <ProgressBar
                value={Math.max(5, project.render_progress || 5)}
                label="Video render progress"
                className="h-3"
              />
              {isRenderQuiet && (
                <p
                  data-testid="render-quiet"
                  className="flex items-start gap-2 text-sm font-semibold text-theme-warning"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>No update from the renderer for a while. It may still be working.</span>
                </p>
              )}
              <p
                className="text-pretty text-sm text-theme-text-muted"
                data-testid="render-leave-note"
              >
                You can close this dialog and keep working. The header shows the progress, and a
                message tells you when the video is ready.
              </p>
              {/* A render can take minutes: one stray click must not throw it away */}
              <InlineConfirm
                message="Cancel the render? Its progress will be lost."
                confirmLabel="Confirm Cancel Render"
                keepLabel="Keep Rendering"
                onConfirm={() => onCancelRender?.()}
                renderTrigger={(trigger) => (
                  <Button ref={trigger.ref} variant="secondary" onClick={trigger.onClick}>
                    Cancel Render
                  </Button>
                )}
              />
            </div>
          )}

          {isError && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-theme-danger"
                  aria-hidden="true"
                />
                <p className="break-words text-sm font-semibold text-theme-danger">
                  {project.render_error || 'Unknown rendering error'}
                </p>
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Button variant="secondary" fullWidth="mobile" onClick={() => setRenderAgain(true)}>
                  Try Again
                </Button>
                {keptVideoLinks}
              </div>
            </div>
          )}

          {isCompleted && (
            <div className="space-y-4">
              {project.video_url && (
                <div
                  className={cn(
                    'w-full overflow-hidden bg-black',
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
                <p className="text-sm text-theme-text-muted">
                  1080p60 MP4 with 320 kbps stereo audio.
                </p>
                <div className="flex w-full flex-col items-stretch gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                  <a
                    href={project.video_url}
                    download={videoFileName(latestVideoFormat)}
                    onClick={() => toast.success('Download started!')}
                    className={cn(
                      'ks-display flex min-h-[44px] w-full items-center justify-center gap-2 bg-theme-accent px-5 text-[22px] text-theme-accent-text transition-colors hover:bg-theme-accent-hover sm:w-auto',
                      focusRing
                    )}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download video (.mp4)
                  </a>
                  {otherVideos.map(({ aspect, url }) => (
                    <a
                      key={aspect}
                      href={url}
                      download={videoFileName(aspect)}
                      onClick={() => toast.success('Download started!')}
                      className={cn(SECONDARY_LINK, focusRing)}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download {aspect} video
                    </a>
                  ))}
                  <a
                    href="https://studio.youtube.com"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(SECONDARY_LINK, focusRing)}
                  >
                    Open YouTube Studio
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
              <div className="flex flex-col items-stretch justify-between gap-2.5 sm:flex-row sm:items-center">
                <p className="text-sm text-theme-text-muted">
                  Changed the lyrics, key or look? Render the video again.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth="mobile"
                  onClick={() => setRenderAgain(true)}
                >
                  Render Again
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 2. The upload to YouTube, right under the finished video it is about */}
        {isCompleted && yt && (
          <ExportYouTubeKit
            youtubePackage={yt}
            format={latestVideoFormat}
            durationSeconds={project.duration}
          />
        )}

        {/* 3. Subtitles */}
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

        {/* 4. Audio stems */}
        <ExportAudioSection project={project} />

        {/* 5. Chord & lyric sheet */}
        <section aria-labelledby="export-chord-sheet-heading" className={EXPORT_SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h3 id="export-chord-sheet-heading" className={EXPORT_HEADING}>
              Chord and lyric sheet
            </h3>
            {project?.chords && project.chords.length > 0 && (
              <span className={EXPORT_NOTE}>{project.chords.length} chords</span>
            )}
          </div>
          <p className="text-sm text-theme-text-muted">
            A text sheet of the lyrics with the chords above them, in the key you have set (
            {keyLabel} st), for guitar, piano and playing live.
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
              className={cn(EXPORT_DOWNLOAD_BTN, 'sm:w-auto sm:justify-start')}
            >
              <div className="flex min-w-0 items-center gap-2.5 text-left">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-theme-text">
                    Download Chord & Lyric Sheet
                  </span>
                  <span className="block truncate text-xs font-normal text-theme-text-muted">
                    Text file in the current key
                  </span>
                </div>
              </div>
              {downloadingChordSheet ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
          {chordSheetError && (
            <div role="alert" className={EXPORT_ERROR}>
              {chordSheetError}
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
};
