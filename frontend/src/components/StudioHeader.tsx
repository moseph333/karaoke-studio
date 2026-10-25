/**
 * Studio Header Component
 *
 * Sticky top navigation bar rendering branding, help guide toggle, user profile button,
 * return-to-search action with unsaved edits guard, and quick video render trigger.
 */

import React from 'react';
import { Mic2, Film, ArrowLeft, User, HelpCircle, Loader2 } from 'lucide-react';
import { ProjectState } from '../types';

import { Tooltip } from './Tooltip';
import { AppThemePicker } from './AppThemePicker';

export interface StudioHeaderProps {
  currentUser: string;
  project: ProjectState | null;
  isLyricsDirty: boolean;
  onOpenHelp: () => void;
  onOpenAuth: () => void;
  onNewSong: () => void;
  onStartRender: () => void;
  isExportModalOpen?: boolean;
  onOpenExportModal?: () => void;
}

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
}) => {
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
    <header className="border-b border-theme-border/60 bg-theme-bg/90 backdrop-blur-md sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 min-h-[3.5rem] sm:min-h-[4rem] h-auto py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-1.5 sm:p-2 rounded-theme-md bg-gradient-to-tr from-theme-accent to-theme-secondary text-theme-accent-text shadow-theme-sm shrink-0">
            <Mic2 className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </div>
          <div className="truncate">
            <span className="font-extrabold text-sm sm:text-lg tracking-tight font-theme-heading text-theme-text truncate block">
              Karaoke Studio
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Accessible Application Theme Picker */}
          <AppThemePicker />

          {/* Help & Usage Guide Trigger */}
          <Tooltip content="Help & Studio Guide" hotkey="?" position="bottom">
            <button
              type="button"
              onClick={onOpenHelp}
              className="px-2 sm:px-2.5 py-1.5 rounded-theme-md bg-theme-surface border border-theme-border/60 hover:border-theme-accent/50 text-theme-text-muted hover:text-theme-text text-xs font-medium transition-all flex items-center gap-1.5 shadow-theme-sm min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent"
              aria-label="Help and Studio Usage Guide (?)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-theme-accent shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline font-semibold">Help</span>
              <kbd className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-semibold text-theme-text-muted bg-theme-surface-subtle border border-theme-border-subtle rounded-theme-sm shadow-xs">
                ?
              </kbd>
            </button>
          </Tooltip>

          {/* Manage User Profile Trigger */}
          <Tooltip content="Manage user profile" position="bottom">
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-2 sm:px-2.5 py-1.5 rounded-theme-md bg-theme-surface border border-theme-border/60 hover:border-theme-accent/50 text-theme-text-muted text-xs font-medium transition-all flex items-center gap-1.5 shadow-theme-sm min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent"
              aria-label={`Logged in as ${currentUser}. Click to change profile.`}
            >
              <User className="w-3.5 h-3.5 text-theme-accent shrink-0" />
              <span className="font-semibold text-theme-text max-w-[65px] sm:max-w-[120px] truncate">
                {currentUser}
              </span>
            </button>
          </Tooltip>

          {project && (
            <>
              <Tooltip content="Return to song search" position="bottom">
                <button
                  type="button"
                  onClick={handleNewSongClick}
                  className="px-2.5 sm:px-3 py-1.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-medium transition-colors flex items-center gap-1.5 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent"
                  aria-label="New Song"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New Song</span>
                </button>
              </Tooltip>

              {/* Persistent Background Render Progress Badge */}
              {project &&
                (project.render_status === 'rendering' || project.render_status === 'queued') &&
                !isExportModalOpen && (
                  <div
                    data-testid="header-render-progress"
                    className="flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-theme-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-medium shadow-theme-sm"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" aria-hidden="true" />
                    <span className="font-mono font-semibold text-[11px] sm:text-xs">
                      Rendering Video: {Math.round(project.render_progress || 0)}%
                    </span>
                    <button
                      type="button"
                      data-testid="header-reopen-export-modal"
                      onClick={onOpenExportModal || onStartRender}
                      className="px-2 py-0.5 rounded-theme-sm bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-[11px] font-bold border border-cyan-500/40 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      aria-label="View background video rendering progress"
                    >
                      View
                    </button>
                  </div>
                )}

              {project.status === 'ready' && (
                <Tooltip
                  content="Render full 1080p60 MP4 video"
                  position="bottom"
                  className="hidden md:inline-flex"
                >
                  <button
                    type="button"
                    onClick={onStartRender}
                    className="hidden md:flex px-4 py-2 rounded-theme-md bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-bold text-xs transition-all shadow-theme-md items-center gap-2 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent"
                  >
                    <Film className="w-4 h-4" />
                    Render & Export Video
                  </button>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
};
