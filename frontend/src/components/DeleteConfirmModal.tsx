/**
 * Project Deletion Confirmation Modal Component
 *
 * Renders an accessible confirmation dialog before permanently removing a project
 * and its generated stems/artifacts from disk, with focus trapping and error handling.
 */

import React, { useState, useRef } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';
import { apiFetch } from '../api';
import { useFocusTrap } from '../hooks/useFocusTrap';

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

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef: cancelBtnRef,
    escapeDeactivates: true,
  });

  if (!isOpen) return null;

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
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      aria-describedby="delete-confirm-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 bg-theme-surface border border-theme-border rounded-t-2xl sm:rounded-theme-xl rounded-b-none sm:rounded-b-theme-xl shadow-theme-lg space-y-4 sm:space-y-5 flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close delete confirmation dialog"
          className="absolute top-3 right-3 sm:top-5 sm:right-5 min-w-[44px] min-h-[44px] p-2.5 rounded-theme-pill bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-theme-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
            <Trash2 className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="delete-confirm-title"
              className="text-lg sm:text-xl font-bold text-theme-text font-theme-heading truncate"
            >
              Delete Project?
            </h2>
            <p className="text-xs text-theme-text-muted font-theme-body truncate mt-0.5">
              Permanent removal from studio
            </p>
          </div>
        </div>

        <div className="p-3 bg-theme-bg border border-theme-border-subtle rounded-theme-md space-y-1 shadow-theme-sm">
          <p className="text-xs font-semibold text-theme-text font-theme-heading truncate">
            {projectTitle}
          </p>
          {projectArtist && (
            <p className="text-[11px] text-theme-text-muted font-theme-body truncate">
              {projectArtist}
            </p>
          )}
        </div>

        <p
          id="delete-confirm-desc"
          className="text-xs text-theme-text font-theme-body leading-relaxed"
        >
          Are you sure you want to permanently delete this project? All associated media files
          (vocal/instrumental stems, master audio, and rendered karaoke videos) will be wiped from
          disk. This action cannot be undone.
        </p>

        {error && (
          <div
            className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-theme-md flex items-center gap-2.5 text-rose-300 text-xs"
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-theme-md bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text hover:text-theme-text text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={loading}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-theme-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-theme-sm focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:opacity-50 flex items-center justify-center gap-2 border border-rose-700"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>{loading ? 'Deleting...' : 'Delete Project'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
