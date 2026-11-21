/**
 * Studio Header Component
 *
 * Sticky top bar, drawn as a masthead over a rule: the wordmark, the way back to the
 * library (guarded against unsaved edits), search, help, profile, background render status
 * and the single Export entry point, which is the only yellow block in it. Its top
 * padding clears the status bar and notch when the installed app draws under them
 * (viewport-fit=cover with a translucent iOS status bar).
 */

import React from 'react';
import { ArrowLeft, User, HelpCircle, Upload, Search, Download } from 'lucide-react';
import { ProjectState } from '../types';
import { Tooltip } from './Tooltip';
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
  /** Shows an "Install app" button on the library screen (only when installing is possible). */
  onInstallApp?: () => void;
}

const headerButton = cn(
  'ks-display inline-flex min-h-[44px] md:min-h-[36px] items-center gap-2 text-[20px] text-theme-text transition-colors hover:text-theme-accent',
  focusRing
);

const StudioHeaderView: React.FC<StudioHeaderProps> = ({
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
  onInstallApp,
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
    <header className="sticky top-0 z-40 border-b-2 border-theme-border bg-theme-bg pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex min-h-[3.5rem] w-full max-w-screen-2xl min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1 sm:flex-nowrap sm:px-8">
        <div className="flex min-w-0 shrink items-center gap-x-5">
          <span
            data-testid="brand-wordmark"
            className={cn(
              'ks-display truncate text-[26px] font-black text-theme-text sm:text-[30px]',
              project && 'hidden sm:block'
            )}
          >
            Karaoke Studio
          </span>

          {project && (
            <Tooltip content="Return to song search" position="bottom">
              <button
                type="button"
                onClick={handleNewSongClick}
                className={cn(headerButton, 'min-w-[44px] justify-center sm:justify-start')}
                aria-label="New Song"
              >
                <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">New Song</span>
              </button>
            </Tooltip>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1 sm:flex-nowrap sm:gap-x-4">
          {/* Background render status (hidden while the export dialog shows progress) */}
          {isRendering && !isExportModalOpen && (
            <div
              data-testid="header-render-progress"
              className="flex items-center gap-2 text-sm font-semibold text-theme-accent"
            >
              <Spinner className="h-4 w-4" />
              <span className="tabular-nums">
                <span className="sr-only sm:not-sr-only">Rendering Video: </span>
                {Math.round(project?.render_progress || 0)}%
              </span>
              <button
                type="button"
                data-testid="header-reopen-export-modal"
                onClick={onOpenExportModal || onStartRender}
                className={cn(
                  'min-h-[36px] px-1 text-sm font-semibold text-theme-text underline underline-offset-4',
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
                className={cn(headerButton, 'min-w-[44px] justify-center')}
              >
                <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="hidden lg:inline">Search</span>
                <Kbd keys={['Mod', 'K']} className="hidden lg:inline-flex" />
              </button>
            </Tooltip>
          )}

          {onInstallApp && !project && (
            <Tooltip content="Add Karaoke Studio to your home screen" position="bottom">
              <button
                type="button"
                data-testid="install-app-btn"
                onClick={onInstallApp}
                className={cn(headerButton, 'min-w-[44px] justify-center')}
                aria-label="Install app"
              >
                <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Install</span>
              </button>
            </Tooltip>
          )}

          <Tooltip content="Help & Studio Guide" hotkey="?" position="bottom">
            <button
              type="button"
              onClick={onOpenHelp}
              className={cn(headerButton, 'min-w-[44px] justify-center')}
              aria-label="Help and studio usage guide (?)"
            >
              <HelpCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">Help</span>
              <Kbd keys="?" className="hidden lg:inline-flex" />
            </button>
          </Tooltip>

          <Tooltip content="Manage user profile" position="bottom">
            <button
              type="button"
              onClick={onOpenAuth}
              className={cn(headerButton, 'min-w-[44px] justify-center')}
              aria-label={`Logged in as ${currentUser}. Click to change profile.`}
            >
              <User className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="hidden max-w-[140px] truncate sm:inline">{currentUser}</span>
            </button>
          </Tooltip>

          {project?.status === 'ready' && handleExport && (
            <Tooltip content="Video, subtitles, stems & YouTube kit" position="bottom" align="end">
              <button
                type="button"
                data-testid="studio-export-btn"
                onClick={handleExport}
                className={cn(
                  'ks-display inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 bg-theme-accent px-3 text-[22px] font-black text-theme-accent-text transition-colors hover:bg-theme-accent-hover sm:px-5',
                  focusRing
                )}
                aria-label="Open export dialog"
              >
                <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
};

// Memoized: the header's inputs rarely change while a song plays or is edited
export const StudioHeader = React.memo(StudioHeaderView);
