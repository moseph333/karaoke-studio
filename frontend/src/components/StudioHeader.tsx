/**
 * Studio Header Component
 *
 * Sticky top navigation bar rendering branding, help guide toggle, user profile button,
 * return-to-search action with unsaved edits guard, and quick video render trigger.
 */

import React from 'react';
import { Mic2, Film, ArrowLeft, User, HelpCircle } from 'lucide-react';
import { ProjectState } from '../types';

import { Tooltip } from './Tooltip';

export interface StudioHeaderProps {
  currentUser: string;
  project: ProjectState | null;
  isLyricsDirty: boolean;
  onOpenHelp: () => void;
  onOpenAuth: () => void;
  onNewSong: () => void;
  onStartRender: () => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  currentUser,
  project,
  isLyricsDirty,
  onOpenHelp,
  onOpenAuth,
  onNewSong,
  onStartRender,
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
    <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 min-h-[3.5rem] sm:min-h-[4rem] h-auto py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-1.5 sm:p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 shadow-md shrink-0">
            <Mic2 className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </div>
          <div className="truncate">
            <span className="font-extrabold text-sm sm:text-lg tracking-tight font-['Montserrat'] bg-gradient-to-r from-white via-slate-200 to-cyan-300 bg-clip-text text-transparent truncate block">
              Karaoke Studio
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Help & Usage Guide Trigger */}
          <Tooltip content="Help & Studio Guide" hotkey="?" position="bottom">
            <button
              type="button"
              onClick={onOpenHelp}
              className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 shadow min-h-[36px] focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              aria-label="Help and Studio Usage Guide (?)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline font-semibold">Help</span>
              <kbd className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-400 bg-slate-800 border border-slate-700 rounded shadow-xs">
                ?
              </kbd>
            </button>
          </Tooltip>

          <Tooltip content="Manage user profile" position="bottom">
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 text-xs font-medium transition-all flex items-center gap-1.5 shadow min-h-[36px]"
              aria-label={`Logged in as ${currentUser}. Click to change profile.`}
            >
              <User className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-semibold text-white max-w-[65px] sm:max-w-[120px] truncate">
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
                  className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5 min-h-[36px]"
                  aria-label="New Song"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New Song</span>
                </button>
              </Tooltip>

              {project.status === 'ready' && (
                <Tooltip
                  content="Render full 1080p60 MP4 video"
                  position="bottom"
                  className="hidden md:inline-flex"
                >
                  <button
                    type="button"
                    onClick={onStartRender}
                    className="hidden md:flex px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-cyan-500/20 items-center gap-2 min-h-[36px]"
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
