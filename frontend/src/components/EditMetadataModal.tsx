/**
 * Edit Project Metadata Modal Component
 *
 * Edits a song's title and artist and saves them with PATCH /api/project/:id. Focus
 * starts on the title field.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Pencil, AlertCircle, Check } from 'lucide-react';
import { apiFetch, readApiError } from '../api';
import { Dialog, DialogFooter, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';

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

const inputCls =
  'w-full min-h-[44px] rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3.5 py-2.5 text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-sm';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-theme-text';

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

  if (!project) return null;

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
        throw new Error(await readApiError(res, 'Failed to update track metadata'));
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
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="edit-metadata-title"
      descriptionId="edit-metadata-desc"
      size="md"
      showDragHandle
      initialFocusRef={titleInputRef}
    >
      <DialogHeader
        title="Edit Track Details"
        titleId="edit-metadata-title"
        description="Update title, artist, and karaoke metadata"
        descriptionId="edit-metadata-desc"
        icon={<Pencil className="h-5 w-5" />}
        onClose={onClose}
        closeLabel="Close edit metadata dialog"
      />

      {error && (
        <div
          className="mb-4 flex items-center gap-2.5 rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-3 text-xs text-theme-danger"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="edit-project-title" className={labelCls}>
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
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-project-artist" className={labelCls}>
              Artist Name
            </label>
            <input
              id="edit-project-artist"
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="e.g. Queen"
              required
              className={inputCls}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" fullWidth="mobile" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="gradient"
            fullWidth="mobile"
            disabled={!title.trim() || !artist.trim()}
            loading={loading}
            loadingLabel="Saving..."
            leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
