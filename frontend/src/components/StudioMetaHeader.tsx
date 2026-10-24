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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-theme-xl bg-theme-surface border border-theme-border shadow-theme-md">
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
        {project.thumbnail_url && (
          <img
            src={project.thumbnail_url}
            alt={project.title}
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-theme-lg object-cover shadow-theme-sm border border-theme-border-subtle shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-theme-text font-theme-heading break-words line-clamp-2 sm:line-clamp-none">
              {project.title}
            </h2>
            <Tooltip content="Edit song title and artist" position="top">
              <button
                type="button"
                onClick={onOpenEditModal}
                aria-label="Edit song details"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-accent transition-colors flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <p className="text-sm text-theme-text-muted font-theme-body font-medium truncate">
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
            className="min-h-[44px] min-w-[44px] px-3.5 py-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-rose-950/40 border border-theme-border-subtle hover:border-theme-secondary text-theme-text-muted hover:text-theme-secondary text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-theme-secondary"
          >
            <Trash2 className="w-4 h-4 text-theme-secondary" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </Tooltip>

        <Tooltip content="Export .LRC or .ASS subtitles" position="top">
          <button
            type="button"
            onClick={onOpenExportModal}
            aria-label="Export subtitles and studio package"
            className="min-h-[44px] px-4 py-2.5 rounded-theme-lg bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-semibold transition-all flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-theme-accent"
          >
            <Download className="w-4 h-4 text-theme-accent" aria-hidden="true" />
            <span>Export Subtitles</span>
          </button>
        </Tooltip>

        <Tooltip content="Render 1080p60 MP4 video" position="top" className="w-full sm:w-auto">
          <button
            type="button"
            onClick={onStartRender}
            className="w-full sm:w-auto justify-center min-h-[44px] px-5 py-2.5 rounded-theme-lg bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-theme-heading font-bold text-sm transition-all shadow-theme-md flex items-center gap-2 border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent"
          >
            <Film className="w-4 h-4" />
            Render 1080p Video
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
