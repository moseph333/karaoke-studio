/**
 * Export Subtitle Section Component
 *
 * Provides instant standalone .LRC and .ASS subtitle exports and downloads
 * for media players and video editors without requiring a full video render.
 */

import React, { useState, useEffect } from 'react';
import { Download, Sparkles, FileText, Loader2, AlignLeft } from 'lucide-react';
import { ProjectState, VisualTheme, SyncDisplayMode } from '../../types';
import { apiFetch } from '../../api';
import { Tooltip } from '../Tooltip';

export interface ExportSubtitleSectionProps {
  project: ProjectState;
  selectedTheme?: VisualTheme;
  aspectRatio?: '16:9' | '9:16' | string;
  primaryColor?: string;
  secondaryColor?: string;
  fontSizeScale?: number;
  activeSemitones?: number;
  syncMode?: SyncDisplayMode;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  onChangeSyncMode?: (mode: SyncDisplayMode) => void;
}

export const ExportSubtitleSection: React.FC<ExportSubtitleSectionProps> = ({
  project,
  selectedTheme,
  aspectRatio = '16:9',
  primaryColor,
  secondaryColor,
  fontSizeScale,
  activeSemitones,
  syncMode,
  onSyncModeChange,
  onChangeSyncMode,
}) => {
  const [downloadingLrc, setDownloadingLrc] = useState(false);
  const [downloadingAss, setDownloadingAss] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [includeChords, setIncludeChords] = useState(false);
  const [internalSyncMode, setInternalSyncMode] = useState<SyncDisplayMode>(syncMode || 'word');
  const activeSyncMode = syncMode !== undefined ? syncMode : internalSyncMode;

  useEffect(() => {
    if (syncMode) {
      setInternalSyncMode(syncMode);
    }
  }, [syncMode]);

  const handleSyncModeChange = (mode: SyncDisplayMode) => {
    setInternalSyncMode(mode);
    onSyncModeChange?.(mode);
    onChangeSyncMode?.(mode);
  };

  const semitones = activeSemitones ?? project?.semitones ?? 0;

  const handleDownloadSubtitle = async (format: 'lrc' | 'ass') => {
    try {
      if (format === 'lrc') setDownloadingLrc(true);
      else setDownloadingAss(true);
      setDownloadError(null);

      const themeId = selectedTheme?.id || 'modern_gold';

      let assUrl = `/api/project/${project?.id}/export/ass?aspect_ratio=${encodeURIComponent(
        aspectRatio
      )}&theme_id=${encodeURIComponent(themeId)}`;

      if (primaryColor) {
        assUrl += `&primary_color=${encodeURIComponent(primaryColor)}`;
      }
      if (secondaryColor) {
        assUrl += `&secondary_color=${encodeURIComponent(secondaryColor)}`;
      }
      if (fontSizeScale !== undefined) {
        assUrl += `&font_size_scale=${encodeURIComponent(fontSizeScale)}`;
      }
      if (syncMode || activeSyncMode !== 'word') {
        assUrl += `&sync_mode=${encodeURIComponent(activeSyncMode)}`;
      }
      if (includeChords) {
        assUrl += `&include_chords=true&semitones=${encodeURIComponent(semitones)}`;
      }

      const url = format === 'lrc' ? `/api/project/${project.id}/export/lrc` : assUrl;

      const res = await apiFetch(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to export .${format} subtitles`);
      }

      const blob = await res.blob();
      let filename = `${project.artist || 'Karaoke'} - ${project.title || 'Track'}.${format}`;
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
        if (typeof window.URL.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(blobUrl);
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err: unknown) {
      console.error(`Download .${format} failed:`, err);
      setDownloadError(err instanceof Error ? err.message : `Failed to download .${format}`);
    } finally {
      if (format === 'lrc') setDownloadingLrc(false);
      else setDownloadingAss(false);
    }
  };

  return (
    <div className="p-3.5 sm:p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 mb-6 space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileText className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />
          <h3 className="text-sm sm:text-base font-bold text-white font-['Montserrat'] truncate">
            Synchronized Subtitles (.LRC & .ASS)
          </h3>
        </div>
        {project?.lines && (
          <span className="text-[11px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 rounded-full shrink-0">
            {project.lines.length} lines
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Export standalone karaoke subtitle files for media players, video editors, or live
        performances without waiting for video rendering.
      </p>

      {/* Options Row: Chords in Subtitles & Sync Mode */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1">
        <label
          data-testid="include-chords-subtitle-container"
          className="flex items-center gap-2.5 cursor-pointer select-none min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors w-full sm:w-auto"
        >
          <input
            type="checkbox"
            data-testid="include-chords-subtitle-checkbox"
            checked={includeChords}
            onChange={(e) => setIncludeChords(e.target.checked)}
            className="min-h-[44px] min-w-[44px] w-5 h-5 rounded border-slate-700 bg-slate-800 text-purple-500 focus:ring-purple-400 focus:ring-offset-slate-900 cursor-pointer"
            aria-label="Include Harmonic Chords in Subtitles (.ass)"
          />
          <span className="text-xs sm:text-sm font-medium text-slate-300">
            Include Harmonic Chords in Subtitles (.ass)
          </span>
        </label>

        {/* Subtitle Sync Mode Selector */}
        <div
          data-testid="subtitle-sync-mode-selector"
          role="group"
          aria-label="Subtitle synchronization mode"
          className="inline-flex p-1 rounded-xl bg-slate-900/90 border border-slate-800"
        >
          <button
            type="button"
            data-testid="subtitle-sync-mode-word"
            aria-pressed={activeSyncMode !== 'line'}
            aria-label="Word Sweep progressive karaoke subtitles"
            onClick={() => handleSyncModeChange('word')}
            className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
              activeSyncMode !== 'line'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            Word Sweep (\kf)
          </button>
          <button
            type="button"
            data-testid="subtitle-sync-mode-line"
            aria-pressed={activeSyncMode === 'line'}
            aria-label="Line-by-Line solid highlight subtitles"
            onClick={() => handleSyncModeChange('line')}
            className={`min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
              activeSyncMode === 'line'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Line-by-Line
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
        {/* Download .LRC Button */}
        <Tooltip
          content="Download synchronized .LRC file"
          position="top"
          className="flex-1 w-full sm:w-auto"
        >
          <button
            type="button"
            onClick={() => handleDownloadSubtitle('lrc')}
            disabled={downloadingLrc || downloadingAss}
            aria-label="Download .lrc subtitles"
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 active:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 text-white font-semibold text-xs sm:text-sm transition-all flex items-center justify-between gap-2.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 min-w-0 text-left">
              {downloadingLrc ? (
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-xs sm:text-sm text-white block">Download .LRC</span>
                <span className="text-[10px] text-slate-400 block truncate">
                  [mm:ss.xx] Timestamps
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          </button>
        </Tooltip>

        {/* Download .ASS Button */}
        <Tooltip
          content="Download formatted .ASS subtitles"
          position="top"
          className="flex-1 w-full sm:w-auto"
        >
          <button
            type="button"
            onClick={() => handleDownloadSubtitle('ass')}
            disabled={downloadingLrc || downloadingAss}
            aria-label="Download .ass subtitles"
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 active:bg-slate-700 border border-slate-700 hover:border-purple-500/50 text-white font-semibold text-xs sm:text-sm transition-all flex items-center justify-between gap-2.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 min-w-0 text-left">
              {downloadingAss ? (
                <Loader2 className="w-4 h-4 text-purple-400 animate-spin shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-xs sm:text-sm text-white block">Download .ASS</span>
                <span className="text-[10px] text-slate-400 block truncate">
                  {activeSyncMode === 'line' ? 'Line-by-Line' : 'Karaoke \\kf'} • {aspectRatio} •{' '}
                  {includeChords
                    ? `Chords (${semitones >= 0 ? `+${semitones}` : semitones}st)`
                    : selectedTheme?.name || 'Theme'}
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-purple-400 shrink-0" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {downloadError && (
        <div
          role="alert"
          className="text-xs text-red-400 bg-red-950/40 border border-red-800/60 p-2.5 rounded-xl font-mono break-words"
        >
          {downloadError}
        </div>
      )}
    </div>
  );
};
