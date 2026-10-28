/**
 * Timeline Toolbar
 *
 * Header row of the lyric timeline: title, line count, unsaved state and the review
 * filter on the left; history, lyric tools and Save / Discard on the right. Tool labels
 * appear when the timeline card (an `@container`) is wide enough.
 */

import React from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  FileText,
  ListMusic,
  Radio,
  Redo2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { Spinner } from '../ui/Spinner';
import { focusRing } from '../ui/variants';
import { Tooltip } from '../Tooltip';
import { cn } from '../../utils/cn';
import type { TimelineFilter } from '../../hooks/useTimelineFilter';

export interface TimelineToolbarProps {
  lineCount: number;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenOffset: () => void;
  onOpenDuet: () => void;
  onOpenReplace: () => void;
  isTapToSyncActive: boolean;
  onToggleTapToSync: () => void;
  onDiscard: () => void;
  onSave: () => void;
  filter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
  reviewCount: number;
}

const Divider = () => (
  <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px bg-theme-border-subtle sm:block" />
);

const ToolLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="hidden text-xs font-semibold @[980px]:inline">{children}</span>
);

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  lineCount,
  hasUnsavedChanges,
  isSaving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenOffset,
  onOpenDuet,
  onOpenReplace,
  isTapToSyncActive,
  onToggleTapToSync,
  onDiscard,
  onSave,
  filter,
  onFilterChange,
  reviewCount,
}) => {
  const noLines = lineCount === 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-theme-border-subtle pb-2.5">
      <div className="flex min-w-0 flex-auto flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="flex items-center gap-2 font-theme-heading text-base font-bold text-theme-text">
          <ListMusic className="h-4 w-4 text-theme-highlight" aria-hidden="true" />
          Timeline
        </h3>
        <span className="whitespace-nowrap text-xs tabular-nums text-theme-text-muted">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        {hasUnsavedChanges && (
          <span
            data-testid="dirty-indicator"
            className="inline-flex items-center gap-1.5 rounded-theme-pill border border-theme-warning/40 bg-theme-warning/15 px-2 py-0.5 text-[11px] font-semibold text-theme-warning"
            title="You have unsaved lyric or timing changes"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-theme-warning motion-safe:animate-pulse"
            />
            Unsaved Changes
          </span>
        )}
        {(reviewCount > 0 || filter === 'review') && (
          <button
            type="button"
            data-testid="timeline-review-filter"
            aria-pressed={filter === 'review'}
            onClick={() => onFilterChange(filter === 'review' ? 'all' : 'review')}
            title={
              filter === 'review'
                ? 'Showing lines that need review. Click to show all lines.'
                : 'Show only lines with timing problems'
            }
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-theme-pill border px-2.5 text-[11px] font-semibold transition-colors md:min-h-[26px]',
              filter === 'review'
                ? 'border-theme-warning bg-theme-warning/20 text-theme-warning'
                : 'border-theme-border-subtle text-theme-text-muted hover:border-theme-warning/50 hover:text-theme-warning',
              focusRing
            )}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Needs review ({reviewCount})
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        <IconButton
          data-testid="undo-lyrics-btn"
          label="Undo lyric change (Ctrl+Z)"
          tooltip="Undo lyric change (Ctrl+Z)"
          icon={<Undo2 className="h-4 w-4" />}
          size="sm"
          onClick={onUndo}
          disabled={!canUndo || isSaving}
        />
        <IconButton
          data-testid="redo-lyrics-btn"
          label="Redo lyric change (Ctrl+Y)"
          tooltip="Redo lyric change (Ctrl+Y)"
          icon={<Redo2 className="h-4 w-4" />}
          size="sm"
          onClick={onRedo}
          disabled={!canRedo || isSaving}
        />
        <Divider />
        <IconButton
          data-testid="batch-offset-btn"
          label="Batch offset timestamps"
          tooltip="Batch shift timestamps"
          icon={
            <>
              <Clock className="h-4 w-4" />
              <ToolLabel>Offset</ToolLabel>
            </>
          }
          size="sm"
          className="gap-1.5 px-2"
          onClick={onOpenOffset}
          disabled={isSaving || noLines}
        />
        <IconButton
          data-testid="duet-assign-btn"
          label="Assign duet roles / singer parts"
          tooltip="Assign duet singer parts"
          icon={
            <>
              <Users className="h-4 w-4" />
              <ToolLabel>Duet parts</ToolLabel>
            </>
          }
          size="sm"
          className="gap-1.5 px-2"
          onClick={onOpenDuet}
          disabled={isSaving || noLines}
        />
        <IconButton
          data-testid="tap-to-sync-btn"
          label="Live tap to sync mode (T)"
          tooltip="Live tap-to-sync mode"
          hotkey="T"
          pressed={isTapToSyncActive}
          icon={
            <>
              <Radio className={cn('h-4 w-4', isTapToSyncActive && 'motion-safe:animate-pulse')} />
              <ToolLabel>Tap sync</ToolLabel>
            </>
          }
          size="sm"
          className={cn(
            'gap-1.5 px-2',
            isTapToSyncActive && 'border-theme-warning/60 bg-theme-warning/15 text-theme-warning'
          )}
          onClick={onToggleTapToSync}
        />
        <IconButton
          data-testid="replace-lyrics-btn"
          label="Replace text or re-align lyrics"
          tooltip="Replace or re-align lyrics"
          icon={
            <>
              <FileText className="h-4 w-4" />
              <ToolLabel>Re-import</ToolLabel>
            </>
          }
          size="sm"
          className="gap-1.5 px-2"
          onClick={onOpenReplace}
          disabled={isSaving}
        />
        {hasUnsavedChanges && (
          <>
            <Divider />
            <Tooltip content="Discard unsaved lyric edits" position="top">
              <button
                type="button"
                data-testid="discard-changes-btn"
                aria-label="Discard Changes"
                onClick={onDiscard}
                disabled={isSaving}
                className={cn(
                  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-theme-md px-2.5 text-xs font-semibold text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text disabled:opacity-50 md:min-h-[32px]',
                  focusRing
                )}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span aria-hidden="true" className="hidden sm:inline">
                  Discard
                </span>
                <span className="sr-only">Discard Changes</span>
              </button>
            </Tooltip>
            <Tooltip content="Save lyrics & timing changes to server" position="top">
              <button
                type="button"
                data-testid="save-lyrics-btn"
                aria-label="Save Timing Changes - Save Lyrics & Timing Changes"
                onClick={onSave}
                disabled={isSaving}
                className={cn(
                  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-theme-md bg-gradient-accent px-3.5 text-xs font-bold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110 disabled:opacity-60 md:min-h-[32px]',
                  focusRing
                )}
              >
                {isSaving ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" /> Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" /> Save
                    <span className="sr-only">Save Timing Changes</span>
                    <span className="sr-only">Save Lyrics</span>
                  </>
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};
