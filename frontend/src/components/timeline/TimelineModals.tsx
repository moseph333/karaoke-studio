/**
 * Timeline Modals Component
 *
 * Renders focus-trapped dialogs for discarding unsaved timing changes
 * and confirming line deletions in the lyric timeline editor.
 */

import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { LyricLine } from '../../types';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatLineTime } from '../../utils/lyrics';

export interface TimelineModalsProps {
  showDiscardModal: boolean;
  onCloseDiscard: () => void;
  onConfirmDiscard: () => void;
  lineToDelete: LyricLine | null;
  onCloseDelete: () => void;
  onConfirmDelete: (lineId: number) => void;
}

export const TimelineModals: React.FC<TimelineModalsProps> = ({
  showDiscardModal,
  onCloseDiscard,
  onConfirmDiscard,
  lineToDelete,
  onCloseDelete,
  onConfirmDelete,
}) => {
  const discardModalRef = useFocusTrap<HTMLDivElement>({
    isOpen: showDiscardModal,
    onClose: onCloseDiscard,
  });

  const deleteModalRef = useFocusTrap<HTMLDivElement>({
    isOpen: Boolean(lineToDelete),
    onClose: onCloseDelete,
  });

  return (
    <>
      {/* Discard Changes Confirmation Modal */}
      {showDiscardModal && (
        <div
          ref={discardModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-dialog-title"
          aria-describedby="discard-dialog-desc"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <h3 id="discard-dialog-title" className="text-base font-bold text-white">
                Discard Unsaved Timing Changes?
              </h3>
            </div>
            <p id="discard-dialog-desc" className="text-xs text-slate-300 leading-relaxed">
              You have made modifications to lyric timing boundaries that have not been saved to the
              server. Discarding will revert all line and word timings back to the last saved state.
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onCloseDiscard}
                className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 flex items-center justify-center"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={onConfirmDiscard}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 focus:outline-none focus:ring-2 focus:ring-rose-400 flex items-center justify-center"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Line Confirmation Modal */}
      {lineToDelete && (
        <div
          ref={deleteModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-line-dialog-title"
          aria-describedby="delete-line-dialog-desc"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <h3 id="delete-line-dialog-title" className="text-base font-bold text-white">
                Delete Lyric Line?
              </h3>
            </div>
            <p id="delete-line-dialog-desc" className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete line {lineToDelete.id}: &ldquo;{lineToDelete.text}
              &rdquo; ({formatLineTime(lineToDelete.start_time)}s to{' '}
              {formatLineTime(lineToDelete.end_time)}s)?
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onCloseDelete}
                className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onConfirmDelete(lineToDelete.id)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 focus:outline-none focus:ring-2 focus:ring-rose-400 flex items-center justify-center"
              >
                Delete Line
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
