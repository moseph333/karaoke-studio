/**
 * Studio Meta Header Component (song header)
 *
 * Compact header for the open song: album art, title, artist, line count, lyric sync
 * fidelity badge, and quick actions to edit details or delete the project. Exports live
 * in the top bar's Export dialog.
 */

import React from 'react';
import { Pencil, Trash2, Music } from 'lucide-react';
import { ProjectState } from '../types';
import { Tooltip } from './Tooltip';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import type { BadgeTone } from './ui/variants';

export interface StudioMetaHeaderProps {
  project: ProjectState;
  onOpenEditModal: () => void;
  onOpenDeleteModal: () => void;
  /** Kept for API compatibility; exports open from the top bar. */
  onOpenExportModal?: () => void;
  /** Kept for API compatibility; renders start from the Export dialog. */
  onStartRender?: () => void;
}

function getLyricSyncFidelity(project: ProjectState): {
  label: 'Synced Words' | 'Line Synced' | 'Plain Lyrics';
  tone: BadgeTone;
  tooltipText: string;
} {
  const lines = project.lines || [];
  if (lines.length === 0) {
    return {
      label: 'Plain Lyrics',
      tone: 'warning',
      tooltipText: 'No synchronized timing data detected',
    };
  }

  // Check if explicit is_synced is false or if all lines have 0 timestamps
  const hasLineTimings = lines.some((l) => (l.start_time || 0) > 0 || (l.end_time || 0) > 0);
  if (project.is_synced === false || !hasLineTimings) {
    return {
      label: 'Plain Lyrics',
      tone: 'warning',
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
      tone: 'success',
      tooltipText: 'High-fidelity word-level karaoke synchronization active',
    };
  }

  return {
    label: 'Line Synced',
    tone: 'info',
    tooltipText: 'Line-level timestamp synchronization active',
  };
}

export const StudioMetaHeader: React.FC<StudioMetaHeaderProps> = ({
  project,
  onOpenEditModal,
  onOpenDeleteModal,
}) => {
  const syncFidelity = getLyricSyncFidelity(project);
  const lineCount = project.lines?.length ?? 0;

  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="song-header">
      {project.thumbnail_url ? (
        <img
          src={project.thumbnail_url}
          alt={project.title}
          className="h-11 w-11 shrink-0 rounded-theme-lg border border-theme-border-subtle object-cover shadow-theme-sm sm:h-12 sm:w-12"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-theme-lg bg-gradient-accent text-theme-accent-text shadow-theme-sm sm:h-12 sm:w-12"
        >
          <Music className="h-5 w-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h2 className="break-words font-theme-heading text-base font-semibold leading-tight tracking-tight text-theme-text line-clamp-2 sm:text-lg sm:line-clamp-1">
          {project.title}
        </h2>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-text-muted">
          <p className="min-w-0 truncate font-medium">
            {project.artist} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </p>
          <Tooltip content={syncFidelity.tooltipText} position="bottom">
            <Badge data-testid="sync-status-badge" tone={syncFidelity.tone} dot>
              {syncFidelity.label}
            </Badge>
          </Tooltip>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
          label="Edit song details"
          tooltip="Edit song title and artist"
          onClick={onOpenEditModal}
        />
        <IconButton
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          label={`Delete project ${project.title || ''}`.trim() || 'Delete project'}
          tooltip="Delete project and media files"
          tooltipAlign="end"
          onClick={onOpenDeleteModal}
          className="hover:bg-theme-danger/10 hover:text-theme-danger"
        />
      </div>
    </div>
  );
};
