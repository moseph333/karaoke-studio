/**
 * Edit Project Metadata Modal Component
 *
 * Provides a focus-trapped dialog for editing song title and artist information,
 * syncing modifications via PATCH /api/project/:id with immediate local update.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Pencil, AlertCircle, X, Check } from 'lucide-react';
import { apiFetch } from '../api';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface EditMetadataModalProps {
  isOpen: boolean;
  project: {
    id: string;
    title?: string;
    artist?: string;
  } | null;
  onClose: () => void;
  onSaved: (updatedProject: { id: string; title: string; artist: string }) => void;
}

export const EditMetadataModal: React.FC<EditMetadataModalProps> = ({
  isOpen,
  project,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState(project?.title || '');
  const [artist, setArtist] = useState(project?.artist || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (project) {
      setTitle(project.title || '');
      setArtist(project.artist || '');
      setError(null);
    }
  }, [project, isOpen]);

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef: titleInputRef,
    escapeDeactivates: true,
  });

  if (!isOpen || !project) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanArtist = artist.trim();

    if (!cleanTitle) {
      setError('Track title cannot be empty');
      return;
    }
    if (!cleanArtist) {
      setError('Artist name cannot be empty');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/project/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          artist: cleanArtist,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update track metadata');
      }

      const data = await res.json();
      const updated = data.project || {
        id: data.id || project.id,
        title: data.title || cleanTitle,
        artist: data.artist || cleanArtist,
      };

      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error updating metadata');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-metadata-title"
      aria-describedby="edit-metadata-desc"
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 bg-theme-surface border border-theme-border rounded-theme-xl shadow-theme-lg space-y-4 sm:space-y-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close edit metadata dialog"
          className="absolute top-3 right-3 sm:top-5 sm:right-5 min-w-[44px] min-h-[44px] p-2.5 rounded-theme-pill bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-theme-lg bg-theme-accent/10 border border-theme-accent/20 text-theme-accent shrink-0">
            <Pencil className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="edit-metadata-title"
              className="text-lg sm:text-xl font-bold text-theme-text font-theme-heading truncate"
            >
              Edit Track Details
            </h2>
            <p
              id="edit-metadata-desc"
              className="text-xs text-theme-text-muted font-theme-body truncate mt-0.5"
            >
              Update title, artist, and karaoke metadata
            </p>
          </div>
        </div>

        {error && (
          <div
            className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-theme-md flex items-center gap-2.5 text-rose-300 text-xs"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="edit-project-title"
              className="text-xs font-semibold text-theme-text font-theme-heading flex items-center gap-1.5"
            >
              Track Title
            </label>
            <input
              ref={titleInputRef}
              id="edit-project-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bohemian Rhapsody"
              required
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-theme-bg border border-theme-border-subtle rounded-theme-md text-theme-text placeholder:text-theme-text-muted text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-theme-border font-theme-body"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="edit-project-artist"
              className="text-xs font-semibold text-theme-text font-theme-heading flex items-center gap-1.5"
            >
              Artist Name
            </label>
            <input
              id="edit-project-artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="e.g. Queen"
              required
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-theme-bg border border-theme-border-subtle rounded-theme-md text-theme-text placeholder:text-theme-text-muted text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-theme-border font-theme-body"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !artist.trim()}
              className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-theme-md bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-bold text-xs transition-all shadow-theme-sm border border-theme-border focus:outline-none focus:ring-2 focus:ring-theme-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-theme-heading"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-theme-accent-text border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{loading ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
