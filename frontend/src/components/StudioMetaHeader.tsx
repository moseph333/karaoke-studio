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

export const StudioMetaHeader: React.FC<StudioMetaHeaderProps> = ({
  project,
  onOpenEditModal,
  onOpenDeleteModal,
  onOpenExportModal,
  onStartRender,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
        {project.thumbnail_url && (
          <img
            src={project.thumbnail_url}
            alt={project.title}
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl object-cover shadow-lg border border-slate-700/60 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-white font-['Montserrat'] break-words line-clamp-2 sm:line-clamp-none">
              {project.title}
            </h2>
            <Tooltip content="Edit song title and artist" position="top">
              <button
                type="button"
                onClick={onOpenEditModal}
                aria-label="Edit song details"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition-colors flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <p className="text-sm text-slate-400 font-medium truncate">
            {project.artist} • {project.lines.length} lyric lines detected
          </p>
        </div>
      </div>

      <div className="w-full sm:w-auto flex flex-wrap items-center gap-2.5 sm:gap-3">
        <Tooltip content="Delete project and media files" position="top">
          <button
            type="button"
            onClick={onOpenDeleteModal}
            aria-label={`Delete project ${project.title || ''}`.trim() || 'Delete project'}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-rose-950/60 border border-slate-700/60 hover:border-rose-500/50 text-slate-400 hover:text-rose-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <Trash2 className="w-4 h-4 text-rose-400" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </Tooltip>

        <Tooltip content="Export .LRC or .ASS subtitles" position="top">
          <button
            type="button"
            onClick={onOpenExportModal}
            aria-label="Export subtitles and studio package"
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <Download className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            <span>Export Subtitles</span>
          </button>
        </Tooltip>

        <Tooltip content="Render 1080p60 MP4 video" position="top" className="w-full sm:w-auto">
          <button
            type="button"
            onClick={onStartRender}
            className="w-full sm:w-auto justify-center min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
          >
            <Film className="w-4 h-4" />
            Render 1080p Video
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
