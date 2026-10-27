/**
 * Studio Meta Header Component
 *
 * Displays active track metadata (thumbnail, title, artist, line count) and provides
 * action buttons for metadata editing, project deletion, subtitle export, and video render.
 */

import React from 'react';
import { Pencil, Trash2, Download, Film } from 'lucide-react';
import { ProjectState } from '../types';

import { Tooltip } from './Tooltip';

export interface StudioMetaHeaderProps {
  project: ProjectState;
  onOpenEditModal: () => void;
  onOpenDeleteModal: () => void;
  onOpenExportModal: () => void;
  onStartRender: () => void;
}

function getLyricSyncFidelity(project: ProjectState): {
  label: 'Synced Words' | 'Line Synced' | 'Plain Lyrics';
  badgeClass: string;
  tooltipText: string;
} {
  const lines = project.lines || [];
  if (lines.length === 0) {
    return {
      label: 'Plain Lyrics',
      badgeClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
      tooltipText: 'No synchronized timing data detected',
    };
  }

  // Check if explicit is_synced is false or if all lines have 0 timestamps
  const hasLineTimings = lines.some((l) => (l.start_time || 0) > 0 || (l.end_time || 0) > 0);
  if (project.is_synced === false || !hasLineTimings) {
    return {
      label: 'Plain Lyrics',
      badgeClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
      tooltipText: 'Lyrics have untimed lines (requires audio alignment)',
    };
  }

  // Check if lines have sub-line word timings
  const hasWordTimings = lines.some(
    (l) => l.words && l.words.length > 0 && l.words.some((w) => w.end_time > w.start_time)
  );

  if (hasWordTimings) {
    return {
      label: 'Synced Words',
      badgeClass: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
      tooltipText: 'High-fidelity word-level karaoke synchronization active',
    };
  }

  return {
    label: 'Line Synced',
    badgeClass: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
    tooltipText: 'Line-level timestamp synchronization active',
  };
}

export const StudioMetaHeader: React.FC<StudioMetaHeaderProps> = ({
  project,
  onOpenEditModal,
  onOpenDeleteModal,
  onOpenExportModal,
  onStartRender,
}) => {
  const syncFidelity = getLyricSyncFidelity(project);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 p-3 sm:p-4 rounded-theme-xl bg-theme-surface border border-theme-border shadow-theme-md">
      <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
        {project.thumbnail_url && (
          <img
            src={project.thumbnail_url}
            alt={project.title}
            className="w-11 h-11 sm:w-16 sm:h-16 rounded-theme-lg object-cover shadow-theme-sm border border-theme-border-subtle shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between sm:justify-start gap-1.5 sm:gap-2">
            <h2 className="text-base sm:text-xl font-extrabold text-theme-text font-theme-heading break-words line-clamp-2 sm:line-clamp-none">
              {project.title}
            </h2>
            <Tooltip content="Edit song title and artist" position="top">
              <button
                type="button"
                onClick={onOpenEditModal}
                aria-label="Edit song details"
                className="min-h-[44px] min-w-[44px] p-2 sm:p-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-accent transition-colors flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-0.5">
            <p className="text-xs sm:text-sm text-theme-text-muted font-theme-body font-medium truncate">
              {project.artist} • {project.lines.length} lyric lines detected
            </p>
            <Tooltip content={syncFidelity.tooltipText} position="top">
              <span
                data-testid="sync-status-badge"
                className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-theme-sm border text-[10px] sm:text-[11px] font-bold font-mono tracking-wider ${syncFidelity.badgeClass}`}
              >
                {syncFidelity.label}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="w-full sm:w-auto flex flex-wrap items-center gap-1.5 sm:gap-3">
        <Tooltip content="Delete project and media files" position="top">
          <button
            type="button"
            onClick={onOpenDeleteModal}
            aria-label={`Delete project ${project.title || ''}`.trim() || 'Delete project'}
            className="min-h-[44px] min-w-[44px] px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-rose-950/40 border border-theme-border-subtle hover:border-theme-secondary text-theme-text-muted hover:text-theme-secondary text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-theme-secondary shrink-0"
          >
            <Trash2 className="w-4 h-4 text-theme-secondary shrink-0" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">Delete</span>
          </button>
        </Tooltip>

        <Tooltip content="Export .LRC or .ASS subtitles" position="top">
          <button
            type="button"
            onClick={onOpenExportModal}
            aria-label="Export subtitles and studio package"
            className="min-h-[44px] px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-semibold transition-all flex items-center justify-center gap-1.5 sm:gap-2 focus:outline-none focus:ring-2 focus:ring-theme-accent shrink-0"
          >
            <Download className="w-4 h-4 text-theme-accent shrink-0" aria-hidden="true" />
            <span className="truncate">Export Subtitles</span>
          </button>
        </Tooltip>

        <Tooltip content="Render 1080p60 MP4 video" position="top" className="flex-1 sm:w-auto">
          <button
            type="button"
            onClick={onStartRender}
            className="w-full sm:w-auto justify-center min-h-[44px] px-3 sm:px-5 py-2 sm:py-2.5 rounded-theme-lg bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-theme-heading font-bold text-xs sm:text-sm transition-all shadow-theme-md flex items-center gap-1.5 sm:gap-2 border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent"
          >
            <Film className="w-4 h-4 shrink-0" />
            <span className="truncate">Render 1080p Video</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
