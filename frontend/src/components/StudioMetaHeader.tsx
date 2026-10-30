/**
 * Studio Meta Header Component (song header)
 *
 * Compact header for the open song: album art, title, artist, line count, a lyric sync
 * badge (timing fidelity, confidence, auto-aligned), a stems badge, and quick actions to
 * edit details or delete the project. Exports live in the top bar's Export dialog.
 */

import React from 'react';
import { Pencil, Trash2, Music } from 'lucide-react';
import { ProjectState } from '../types';
import { getLyricSyncFidelity, getStemsBadge } from '../utils/syncStatus';
import { Tooltip } from './Tooltip';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';

export interface StudioMetaHeaderProps {
  project: ProjectState;
  onOpenEditModal: () => void;
  onOpenDeleteModal: () => void;
  /** Kept for API compatibility; exports open from the top bar. */
  onOpenExportModal?: () => void;
  /** Kept for API compatibility; renders start from the Export dialog. */
  onStartRender?: () => void;
}

export const StudioMetaHeader: React.FC<StudioMetaHeaderProps> = ({
  project,
  onOpenEditModal,
  onOpenDeleteModal,
}) => {
  const syncFidelity = getLyricSyncFidelity(project);
  const stems = getStemsBadge(project);
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
        <h2
          tabIndex={-1}
          data-view-heading
          className="break-words font-theme-heading text-base font-semibold leading-tight tracking-tight text-theme-text focus:outline-none line-clamp-2 sm:text-lg sm:line-clamp-1"
        >
          {project.title}
        </h2>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-text-muted">
          <p className="min-w-0 truncate font-medium">
            {project.artist} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </p>
          <Tooltip content={syncFidelity.tooltipText} position="bottom">
            <Badge
              data-testid="sync-status-badge"
              tone={syncFidelity.tone}
              dot
              pulse={syncFidelity.label === 'Re-aligning'}
            >
              {syncFidelity.label}
              {syncFidelity.quality !== null && (
                <span className="tabular-nums opacity-80">{syncFidelity.quality}%</span>
              )}
              {syncFidelity.autoAligned && (
                <span className="font-medium opacity-80">auto-aligned</span>
              )}
            </Badge>
          </Tooltip>
          <Tooltip content={stems.tooltip} position="bottom">
            <Badge
              data-testid="stems-badge"
              tone={stems.active ? 'accent' : 'neutral'}
              dot={stems.active}
              pulse={stems.active}
              className="hidden sm:inline-flex"
            >
              {stems.text}
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
