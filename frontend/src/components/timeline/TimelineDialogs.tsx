/**
 * Timeline Dialogs
 *
 * The timeline editor's tool dialogs, at most one open at a time: shift timing from a line
 * on (offset), replace or re-time the lyrics (replace), and assign duet parts (duet).
 */

import React from 'react';
import type { LyricLine } from '../../types';
import type { BackgroundRealignRequest } from '../../hooks/useQualityJobs';
import type { useLyricEditorState } from '../../hooks/useLyricEditorState';
import { BatchOffsetModal } from './BatchOffsetModal';
import { LyricReplacementModal } from './LyricReplacementModal';
import { DuetAssignmentModal } from './DuetAssignmentModal';

export type TimelineDialog = 'offset' | 'replace' | 'duet' | null;

export interface TimelineDialogsProps {
  open: TimelineDialog;
  onClose: () => void;
  /** The editor's state and handlers (useLyricEditorState). */
  ed: ReturnType<typeof useLyricEditorState>;
  lines: LyricLine[];
  projectId: string;
  trackTitle: string;
  trackArtist: string;
  selectedLineIndex: number;
  onStartBackground?: (request: BackgroundRealignRequest) => Promise<unknown>;
}

export const TimelineDialogs: React.FC<TimelineDialogsProps> = ({
  open,
  onClose,
  ed,
  lines,
  projectId,
  trackTitle,
  trackArtist,
  selectedLineIndex,
  onStartBackground,
}) => (
  <>
    <BatchOffsetModal
      isOpen={open === 'offset'}
      onClose={onClose}
      onApplyOffset={ed.handleApplyBatchOffset}
      selectedLineIndex={selectedLineIndex}
      totalLines={lines.length}
    />
    <LyricReplacementModal
      isOpen={open === 'replace'}
      onClose={onClose}
      projectId={projectId}
      trackTitle={trackTitle}
      trackArtist={trackArtist}
      onSuccess={ed.handleReplaceLyrics}
      currentLines={lines}
      onStartBackground={onStartBackground}
    />
    <DuetAssignmentModal
      isOpen={open === 'duet'}
      onClose={onClose}
      lines={lines}
      onApply={ed.handleBulkAssignSinger}
      selectedLineIndex={selectedLineIndex}
      projectId={projectId}
    />
  </>
);
