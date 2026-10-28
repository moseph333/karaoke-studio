/**
 * Project Deletion Confirmation Modal Component
 *
 * Confirms before permanently removing a project and its generated stems and renders
 * from disk. Focus starts on Cancel; errors from the server are shown inline.
 */

import React, { useState, useRef } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../api';
import { Dialog, DialogFooter, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';

export interface DeleteConfirmModalProps {
  isOpen: boolean;
  projectId: string;
  projectTitle: string;
  projectArtist?: string;
  onClose: () => void;
  onDeleted: (deletedProjectId: string) => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  projectId,
  projectTitle,
  projectArtist,
  onClose,
  onDeleted,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const handleConfirmDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/project/${projectId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete project');
      }
      onDeleted(projectId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error during deletion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="delete-confirm-title"
      descriptionId="delete-confirm-desc"
      size="md"
      showDragHandle
      initialFocusRef={cancelBtnRef}
    >
      <DialogHeader
        title="Delete Project?"
        titleId="delete-confirm-title"
        description="Permanent removal from studio"
        icon={<Trash2 className="h-5 w-5" />}
        iconTone="danger"
        onClose={onClose}
        closeLabel="Close delete confirmation dialog"
      />

      <div className="space-y-4">
        <div className="space-y-0.5 rounded-theme-md border border-theme-border-subtle bg-theme-bg p-3">
          <p className="truncate font-theme-heading text-sm font-semibold text-theme-text">
            {projectTitle}
          </p>
          {projectArtist && (
            <p className="truncate text-xs text-theme-text-muted">{projectArtist}</p>
          )}
        </div>

        <p id="delete-confirm-desc" className="text-sm leading-relaxed text-theme-text-muted">
          Are you sure you want to permanently delete this project? All associated media files
          (vocal/instrumental stems, master audio, and rendered karaoke videos) will be wiped from
          disk. This action cannot be undone.
        </p>

        {error && (
          <div
            className="flex items-center gap-2.5 rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-3 text-xs text-theme-danger"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          ref={cancelBtnRef}
          variant="secondary"
          fullWidth="mobile"
          onClick={onClose}
          disabled={loading}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          fullWidth="mobile"
          onClick={handleConfirmDelete}
          loading={loading}
          loadingLabel="Deleting..."
          leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
        >
          Delete Project
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
