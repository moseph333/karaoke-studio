/**
 * Studio Header Component
 *
 * Sticky top bar: brand, background render status, app theme picker, help, profile,
 * return-to-library (guarded against unsaved edits) and the single Export entry point.
 */

import React from 'react';
import { Mic2, ArrowLeft, User, HelpCircle, Upload, Search } from 'lucide-react';
import { ProjectState } from '../types';
import { Tooltip } from './Tooltip';
import { AppThemePicker } from './AppThemePicker';
import { Spinner } from './ui/Spinner';
import { Kbd } from './ui/Kbd';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { modKeyLabel } from '../utils/platform';
import { useCommandPalette } from './commandPalette/context';

export interface StudioHeaderProps {
  currentUser: string;
  project: ProjectState | null;
  isLyricsDirty: boolean;
  onOpenHelp: () => void;
  onOpenAuth: () => void;
  onNewSong: () => void;
  /** Legacy fallback used when no export dialog handler is provided. */
  onStartRender?: () => void;
  isExportModalOpen?: boolean;
  onOpenExportModal?: () => void;
  onExportClick?: () => void;
}

const headerButton = cn(
  'inline-flex min-h-[44px] md:min-h-[36px] items-center gap-1.5 rounded-theme-md border text-xs font-semibold transition-colors',
  focusRing
);

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  currentUser,
  project,
  isLyricsDirty,
  onOpenHelp,
  onOpenAuth,
  onNewSong,
  onStartRender,
  isExportModalOpen = false,
  onOpenExportModal,
  onExportClick,
}) => {
  const handleExport = onExportClick || onOpenExportModal || onStartRender;
  const palette = useCommandPalette();
  const paletteHotkey = modKeyLabel() === '⌘' ? '⌘K' : 'Ctrl+K';
  const isRendering =
    project && (project.render_status === 'rendering' || project.render_status === 'queued');

  const handleNewSongClick = () => {
    if (isLyricsDirty) {
      if (
        window.confirm('You have unsaved lyric timing edits. Discard and return to song search?')
      ) {
        onNewSong();
      }
    } else {
      onNewSong();
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-theme-border-subtle bg-theme-bg/80 backdrop-blur-xl transition-colors">
      <div className="mx-auto flex min-h-[3.5rem] w-full max-w-screen-2xl min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 py-1.5 sm:flex-nowrap sm:px-4 lg:px-6">
        <div className="flex min-w-0 shrink items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-theme-md bg-gradient-accent text-theme-accent-text shadow-theme-glow"
          >
            <Mic2 className="h-4 w-4 stroke-[2.5]" />
          </span>
          <span
            className={cn(
              'truncate font-theme-heading text-sm font-bold tracking-tight text-theme-text sm:text-base',
              project && 'hidden sm:block'
            )}
          >
            Karaoke Studio
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:flex-nowrap sm:gap-1.5">
          {/* Background render status (hidden while the export dialog shows progress) */}
          {isRendering && !isExportModalOpen && (
            <div
              data-testid="header-render-progress"
              className="flex items-center gap-2 rounded-theme-pill border border-theme-accent/40 bg-theme-accent/10 py-1 pl-2.5 pr-1 text-xs font-medium text-theme-highlight"
              role="status"
              aria-live="polite"
            >
              <Spinner className="h-3.5 w-3.5" />
              <span className="font-mono text-[11px] font-semibold tabular-nums">
                <span className="sr-only sm:not-sr-only">Rendering Video: </span>
                {Math.round(project?.render_progress || 0)}%
              </span>
              <button
                type="button"
                data-testid="header-reopen-export-modal"
                onClick={onOpenExportModal || onStartRender}
                className={cn(
                  'min-h-[36px] rounded-theme-pill bg-theme-accent/20 px-2.5 text-[11px] font-bold text-theme-text transition-colors hover:bg-theme-accent/30',
                  focusRing
                )}
                aria-label="View background video rendering progress"
              >
                View
              </button>
            </div>
          )}

          {palette && (
            <Tooltip
              content="Search commands, songs and lyrics"
              hotkey={paletteHotkey}
              position="bottom"
            >
              <button
                type="button"
                onClick={palette.open}
                aria-label={`Open command palette (${paletteHotkey})`}
                className={cn(
                  headerButton,
                  'min-w-[44px] justify-center border-theme-border-subtle bg-theme-surface/60 px-2 text-theme-text-muted hover:border-theme-border hover:text-theme-text md:min-w-[36px] lg:min-w-[190px] lg:justify-between lg:px-2.5'
                )}
              >
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="hidden font-medium lg:inline">Search…</span>
                </span>
                <Kbd keys={['Mod', 'K']} className="hidden lg:inline-flex" />
              </button>
            </Tooltip>
          )}

          <AppThemePicker />

          <Tooltip content="Help & Studio Guide" hotkey="?" position="bottom">
            <button
              type="button"
              onClick={onOpenHelp}
              className={cn(
                headerButton,
                'min-w-[44px] justify-center border-transparent px-2 text-theme-text-muted hover:bg-theme-surface-subtle hover:text-theme-text md:min-w-[36px]'
              )}
              aria-label="Help and Studio Usage Guide (?)"
            >
              <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">Help</span>
              <Kbd keys="?" className="hidden lg:inline-flex" />
            </button>
          </Tooltip>

          <Tooltip content="Manage user profile" position="bottom">
            <button
              type="button"
              onClick={onOpenAuth}
              className={cn(
                headerButton,
                'min-w-[44px] justify-center border-transparent px-2 text-theme-text-muted hover:bg-theme-surface-subtle hover:text-theme-text md:min-w-[36px]'
              )}
              aria-label={`Logged in as ${currentUser}. Click to change profile.`}
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-theme-surface-raised text-theme-highlight"
              >
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="hidden max-w-[120px] truncate text-theme-text sm:inline">
                {currentUser}
              </span>
            </button>
          </Tooltip>

          {project && (
            <Tooltip content="Return to song search" position="bottom">
              <button
                type="button"
                onClick={handleNewSongClick}
                className={cn(
                  headerButton,
                  'min-w-[44px] justify-center border-theme-border-subtle bg-theme-surface-subtle px-2.5 text-theme-text hover:border-theme-border hover:bg-theme-surface-raised'
                )}
                aria-label="New Song"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">New Song</span>
              </button>
            </Tooltip>
          )}

          {project?.status === 'ready' && handleExport && (
            <Tooltip content="Video, subtitles, stems & YouTube kit" position="bottom" align="end">
              <button
                type="button"
                data-testid="studio-export-btn"
                onClick={handleExport}
                className={cn(
                  headerButton,
                  'min-w-[44px] justify-center border-transparent bg-gradient-accent px-3 text-theme-accent-text shadow-theme-glow hover:brightness-110'
                )}
                aria-label="Open export dialog"
              >
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
};
