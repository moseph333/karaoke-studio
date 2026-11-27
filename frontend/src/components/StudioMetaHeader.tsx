/**
 * Studio Meta Header Component (song header)
 *
 * Compact header for the open song: album art, title, artist, line count, a lyric sync
 * badge (timing fidelity, confidence, auto-aligned), a stems badge, the button that opens
 * the song check-up (with a count of the things to fix), the button that turns practice on
 * and off, and quick actions to edit details or delete the project. Exports live in the top bar's Export dialog.
 */

import React, { useMemo } from 'react';
import { Mic, Pencil, Stethoscope, Trash2, Music } from 'lucide-react';
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
  /** Practice is showing; its button is left out without `onTogglePractice`. */
  practiceOn?: boolean;
  onTogglePractice?: () => void;
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
  practiceOn = false,
  onTogglePractice,
}) => {
  const syncFidelity = getLyricSyncFidelity(project);
  const stems = getStemsBadge(project);
  const lineCount = project.lines?.length ?? 0;
  const toFix = useMemo(() => checkupFixCount(project), [project]);

  return (
    <div
      className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4"
      data-testid="song-header"
      data-guide="song"
    >
      {project.thumbnail_url ? (
        <img
          src={project.thumbnail_url}
          alt={project.title}
          className="h-12 w-12 shrink-0 object-cover sm:h-16 sm:w-16"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-theme-surface-raised text-theme-text-muted sm:h-16 sm:w-16"
        >
          <Music className="h-5 w-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h1
          tabIndex={-1}
          data-view-heading
          className="ks-display break-words text-[34px] font-black leading-[0.92] text-theme-text focus:outline-none line-clamp-2 sm:text-[56px] sm:line-clamp-1"
        >
          {project.title}
        </h1>
        {/* What the song is, as plain text. Only what needs a look is coloured. */}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-theme-text-muted">
          <p className="min-w-0 truncate">
            {project.artist} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </p>
          <Tooltip content={syncFidelity.tooltipText} position="bottom">
            <Badge
              data-testid="sync-status-badge"
              tone={syncFidelity.tone === 'success' ? 'neutral' : syncFidelity.tone}
              size="md"
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
              size="md"
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
                data-guide="checkup"
                aria-label={`Song check-up: ${toFix > 0 ? `${toFix} to fix` : 'nothing to fix'}`}
                className={cn(
                  // The chip is badge-sized; the button around it is the 44px touch target and
                  // its negative margin keeps the header's height
                  'group -my-2.5 inline-flex min-h-[44px] items-center md:-my-1 md:min-h-[26px]',
                  focusRing
                )}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold underline underline-offset-4 transition-colors',
                    toFix > 0
                      ? 'text-theme-warning'
                      : 'text-theme-text-muted group-hover:text-theme-text'
                  )}
                >
                  <Stethoscope className="h-4 w-4" aria-hidden="true" />
                  {toFix > 0 ? `${toFix} to fix` : 'Check-up'}
                </span>
              </button>
            </Tooltip>
          )}
          {onTogglePractice && (
            <Tooltip
              content="Repeat a part and sing it until it sits right"
              hotkey={['P']}
              position="bottom"
            >
              <button
                type="button"
                onClick={onTogglePractice}
                data-testid="practice-button"
                data-guide="practice"
                aria-expanded={practiceOn}
                aria-controls={practiceOn ? 'workspace-panel-practice' : undefined}
                className={cn(
                  'group -my-2.5 inline-flex min-h-[44px] items-center md:-my-1 md:min-h-[26px]',
                  focusRing
                )}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold underline underline-offset-4 transition-colors',
                    // Lit while practice is on
                    practiceOn
                      ? 'text-theme-accent'
                      : 'text-theme-text-muted group-hover:text-theme-text'
                  )}
                >
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  Practice
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
          data-guide="song-details"
          tooltip="Edit song title and artist"
          onClick={onOpenEditModal}
        />
        <IconButton
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          label={`Delete project ${project.title || ''}`.trim() || 'Delete project'}
          tooltip="Delete project and media files"
          tooltipAlign="end"
          onClick={onOpenDeleteModal}
          className="hover:text-theme-danger"
        />
      </div>
    </div>
  );
};
