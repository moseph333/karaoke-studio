/**
 * Timeline Modals Component
 *
 * Confirmation dialogs for discarding unsaved timing changes and deleting a lyric line.
 */

import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { LyricLine } from '../../types';
import { formatLineTime } from '../../utils/lyrics';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';

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
}) => (
  <>
    <Dialog
      open={showDiscardModal}
      onClose={onCloseDiscard}
      titleId="discard-dialog-title"
      descriptionId="discard-dialog-desc"
      variant="center"
      size="md"
    >
      <DialogHeader
        title="Discard Unsaved Timing Changes?"
        titleId="discard-dialog-title"
        icon={<AlertTriangle className="h-5 w-5" />}
        iconTone="warning"
        sticky={false}
      />
      <p id="discard-dialog-desc" className="text-sm leading-relaxed text-theme-text-muted">
        You have made modifications to lyric timing boundaries that have not been saved to the
        server. Discarding will revert all line and word timings back to the last saved state.
      </p>
      <DialogFooter>
        <Button variant="secondary" fullWidth="mobile" onClick={onCloseDiscard}>
          Keep Editing
        </Button>
        <Button variant="destructive" fullWidth="mobile" onClick={onConfirmDiscard}>
          Discard Changes
        </Button>
      </DialogFooter>
    </Dialog>

    <Dialog
      open={Boolean(lineToDelete)}
      onClose={onCloseDelete}
      titleId="delete-line-dialog-title"
      descriptionId="delete-line-dialog-desc"
      variant="center"
      size="md"
    >
      {lineToDelete && (
        <>
          <DialogHeader
            title="Delete Lyric Line?"
            titleId="delete-line-dialog-title"
            icon={<Trash2 className="h-5 w-5" />}
            iconTone="danger"
            sticky={false}
          />
          <p id="delete-line-dialog-desc" className="text-sm leading-relaxed text-theme-text-muted">
            Are you sure you want to delete line {lineToDelete.id}: &ldquo;{lineToDelete.text}
            &rdquo; ({formatLineTime(lineToDelete.start_time)}s to{' '}
            {formatLineTime(lineToDelete.end_time)}s)?
          </p>
          <DialogFooter>
            <Button variant="secondary" fullWidth="mobile" onClick={onCloseDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              fullWidth="mobile"
              onClick={() => onConfirmDelete(lineToDelete.id)}
            >
              Delete Line
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  </>
);
