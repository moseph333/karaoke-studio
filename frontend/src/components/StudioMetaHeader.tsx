/**
 * Studio Meta Header Component (song header)
 *
 * Compact header for the open song: album art, title, artist, line count, a lyric sync
 * badge (timing fidelity, confidence, auto-aligned), a stems badge, the button that opens
 * the song check-up (with a count of the things to fix), and quick actions to edit details
 * or delete the project. Exports live in the top bar's Export dialog.
 */

import React, { useMemo } from 'react';
import { Pencil, Stethoscope, Trash2, Music } from 'lucide-react';
import { ProjectState } from '../types';
import { checkupFixCount } from '../utils/songCheckup';
import { getLyricSyncFidelity, getStemsBadge } from '../utils/syncStatus';
import { cn } from '../utils/cn';
import { Tooltip } from './Tooltip';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import { focusRing } from './ui/variants';

export interface StudioMetaHeaderProps {
  project: ProjectState;
  onOpenEditModal: () => void;
  onOpenDeleteModal: () => void;
  /** Opens the song check-up; its button is left out without it. */
  onOpenCheckup?: () => void;
  /** Kept for API compatibility; exports open from the top bar. */
  onOpenExportModal?: () => void;
  /** Kept for API compatibility; renders start from the Export dialog. */
  onStartRender?: () => void;
}

export const StudioMetaHeader: React.FC<StudioMetaHeaderProps> = ({
  project,
  onOpenEditModal,
  onOpenDeleteModal,
  onOpenCheckup,
}) => {
  const syncFidelity = getLyricSyncFidelity(project);
  const stems = getStemsBadge(project);
  const lineCount = project.lines?.length ?? 0;
  const toFix = useMemo(() => checkupFixCount(project), [project]);

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
        <h1
          tabIndex={-1}
          data-view-heading
          className="break-words font-theme-heading text-base font-semibold leading-tight tracking-tight text-theme-text focus:outline-none line-clamp-2 sm:text-lg sm:line-clamp-1"
        >
          {project.title}
        </h1>
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
                <span className="tabular-nums">{syncFidelity.quality}%</span>
              )}
              {syncFidelity.autoAligned && <span className="font-medium">auto-aligned</span>}
              {/* The badge takes no focus, so its tooltip only reaches pointer users */}
              <span className="sr-only" data-testid="sync-status-details">
                {`: ${syncFidelity.tooltipText}`}
              </span>
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
              <span className="sr-only" data-testid="stems-details">
                {`: ${stems.tooltip}`}
              </span>
            </Badge>
          </Tooltip>
          {onOpenCheckup && (
            <Tooltip content="What looks off about this song, and how to fix it" position="bottom">
              <button
                type="button"
                onClick={onOpenCheckup}
                data-testid="song-checkup-button"
                aria-label={`Song check-up: ${toFix > 0 ? `${toFix} to fix` : 'nothing to fix'}`}
                className={cn(
                  // The chip is badge-sized; the button around it is the 44px touch target and
                  // its negative margin keeps the header's height
                  'group -my-2.5 inline-flex min-h-[44px] items-center rounded-theme-pill md:-my-1 md:min-h-[26px]',
                  focusRing
                )}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-theme-pill border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                    toFix > 0
                      ? 'border-theme-warning/50 bg-theme-warning/10 text-theme-warning group-hover:bg-theme-warning/20'
                      : 'border-theme-border-subtle text-theme-text-muted group-hover:border-theme-border group-hover:text-theme-text'
                  )}
                >
                  <Stethoscope className="h-3 w-3" aria-hidden="true" />
                  {toFix > 0 ? `${toFix} to fix` : 'Check-up'}
                </span>
              </button>
            </Tooltip>
          )}
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
