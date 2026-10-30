/** Lyric Timeline Editor: Line/word timing, editing, duet parts, undo/redo, tap sync */

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { LyricLine, WordTiming, StudioWorkspaceTab, SyncJob } from '../types';
import { LyricDisplay, LyricDisplayProps } from './LyricDisplay';
import {
  recalculateWordTimings,
  activeWordKeyAt,
  findLeadInLineIndex,
  wordLocationFromKey,
} from '../utils/lyrics';
import { usePlaybackClock, usePlaybackValue } from '../hooks/usePlaybackClock';
import { useWorkspaceTabs, workspacePanelProps } from './studio/workspacePanels';
import { useTimelineAutoScroll } from '../hooks/useTimelineAutoScroll';
import { useLyricEditorState } from '../hooks/useLyricEditorState';
import { useTimelineFilter } from '../hooks/useTimelineFilter';
import { useStableHandlers } from '../hooks/useStableHandlers';
import { useTimelineCommands } from '../hooks/useTimelineCommands';
import { useLineRealign } from '../hooks/useLineRealign';
import { useSyncJobResult } from '../hooks/useSyncJobResult';
import { useToast } from '../hooks/useToast';
import type { BackgroundRealignRequest } from '../hooks/useQualityJobs';
import { TimelineLineCard } from './timeline/TimelineLineCard';
import { TimelineToolbar } from './timeline/TimelineToolbar';
import { TimelineModals } from './timeline/TimelineModals';
import { BatchOffsetModal } from './timeline/BatchOffsetModal';
import { TapToSyncBanner } from './timeline/TapToSyncBanner';
import { SyncJobBanner } from './timeline/SyncJobBanner';
import { LyricReplacementModal } from './timeline/LyricReplacementModal';
import { DuetAssignmentModal } from './timeline/DuetAssignmentModal';
import { Button } from './ui/Button';
import { S_ADD_LINE_BTN, S_RESUME_PILL, S_SCROLL_AREA } from './timeline/timelineStyles';

export { recalculateWordTimings };

const panelCls = (a?: StudioWorkspaceTab, t?: StudioWorkspaceTab) =>
  !a || a === t ? 'block' : 'hidden md:block';

export interface LyricTimelineEditorProps extends LyricDisplayProps {
  duration: number;
  onSeek: (time: number) => void;
  onSaveLines: (updatedLines: LyricLine[]) => Promise<void | boolean> | void;
  onDirtyChange?: (isDirty: boolean) => void;
  projectId?: string;
  trackTitle?: string;
  trackArtist?: string;
  activeWorkspaceTab?: StudioWorkspaceTab;
  /** Live playback clock, more precise than `currentTime`, for taps and playhead snaps. */
  getCurrentTime?: () => number;
  /** Background lyric re-alignment: its state, and starting or cancelling one. */
  syncJob?: SyncJob | null;
  onStartBackgroundRealign?: (request: BackgroundRealignRequest) => Promise<unknown>;
  onCancelRealign?: () => void;
}

/** The stage's own props: passing the editor's too would defeat LyricDisplay's memo. */
function stagePropsOf({
  onSaveLines: _onSaveLines,
  onDirtyChange: _onDirtyChange,
  projectId: _projectId,
  trackTitle: _trackTitle,
  trackArtist: _trackArtist,
  activeWorkspaceTab: _activeWorkspaceTab,
  getCurrentTime: _getCurrentTime,
  syncJob: _syncJob,
  onStartBackgroundRealign: _onStartBackgroundRealign,
  onCancelRealign: _onCancelRealign,
  ...stage
}: LyricTimelineEditorProps): LyricDisplayProps {
  return stage;
}

export const LyricTimelineEditor: React.FC<LyricTimelineEditorProps> = (props) => {
  const {
    currentTime,
    isPlaying = false,
    onSeek,
    projectId,
    trackTitle = 'Track',
    trackArtist = 'Artist',
    activeWorkspaceTab,
    getCurrentTime,
    syncJob,
    onStartBackgroundRealign,
    onCancelRealign,
  } = props;
  const { toast } = useToast();
  const clock = usePlaybackClock();
  // One stable reader of the live position (taps, snaps, new lines)
  const { readTime } = useStableHandlers({
    readTime: (): number => getCurrentTime?.() ?? currentTime ?? clock?.now() ?? 0,
  });
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [showDuetModal, setShowDuetModal] = useState(false);
  const ed = useLyricEditorState({ ...props, getCurrentTime: readTime });
  const review = useTimelineFilter(ed.editableLines);
  const effectiveProjectId =
    projectId || new URLSearchParams(window.location.search).get('project') || '';
  const realign = useLineRealign({
    projectId: effectiveProjectId,
    lines: ed.editableLines,
    onApply: ed.applyRealignedLine,
  });
  const syncResult = useSyncJobResult({
    syncJob,
    lines: props.lines,
    hasUnsavedChanges: ed.hasUnsavedChanges,
    onAdopt: ed.adoptServerLines,
  });
  const isRealignRunning = syncJob?.status === 'queued' || syncJob?.status === 'running';
  const realignAll = async () => {
    if (!onStartBackgroundRealign) return;
    if (ed.hasUnsavedChanges) {
      toast.warning('Save your lyric edits first, then re-align');
      return;
    }
    try {
      await onStartBackgroundRealign({ lines: ed.editableLines });
      toast.info('Re-aligning every line in the background');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the re-alignment');
    }
  };
  // The active line and word come from the playback clock (or the `currentTime` prop) as
  // primitives, so the editor re-renders at word boundaries rather than on every timeupdate
  const activeLineIndex = usePlaybackValue(
    (t) => findLeadInLineIndex(ed.editableLines, t),
    currentTime
  );
  const activeWordKey = usePlaybackValue((t) => activeWordKeyAt(ed.editableLines, t), currentTime);
  const currentLine = activeLineIndex >= 0 ? ed.editableLines[activeLineIndex] : null;
  const activeWordLoc = useMemo(
    () => wordLocationFromKey(ed.editableLines, activeWordKey),
    [ed.editableLines, activeWordKey]
  );
  const activeKey = activeWordLoc
    ? activeWordKey
    : activeLineIndex >= 0
      ? `line-${ed.editableLines[activeLineIndex].id}`
      : null;

  const {
    containerRef,
    isUserScrolling,
    resumeAutoScroll,
    handleScroll,
    handleUserScrollInteraction,
  } = useTimelineAutoScroll({
    currentTime,
    isPlaying,
    editableLines: ed.editableLines,
    activeLineIndex,
    activeKey,
    selectedLineId: ed.selectedLineId,
  });

  // Stable identities let memoized rows skip re-rendering on every playback tick.
  const rowHandlers = useStableHandlers({
    onLineClick: (line: LyricLine, isExpanded: boolean) => {
      resumeAutoScroll();
      onSeek(line.start_time);
      ed.setSelectedLineId(isExpanded ? null : line.id);
    },
    onWordClick: (w: WordTiming) => {
      resumeAutoScroll();
      onSeek(w.start_time);
    },
    onStartEditing: ed.handleStartEditing,
    onCommitEditing: ed.handleCommitEditing,
    onCancelEditing: ed.handleCancelEditing,
    onSetEditingText: ed.setEditingText,
    onNudgeLine: ed.nudgeLine,
    onInsertLineAbove: ed.handleInsertLineAbove,
    onInsertLineBelow: ed.handleInsertLineBelow,
    onDeleteLine: ed.setLineToDelete,
    onToggleExpand: (id: number) => ed.setSelectedLineId((cur) => (cur === id ? null : id)),
    onNudgeWord: ed.nudgeWord,
    onNudgeWordBoundary: ed.nudgeWordBoundary,
    onUpdateWordTiming: ed.updateWordTiming,
    onCycleSinger: ed.handleCycleLineSinger,
    onSetSinger: ed.handleSetLineSinger,
    onRealignLine: realign.realignLine,
    getCurrentTime: readTime,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('button, input, select, textarea, [role="button"]'))
      return;
    if (containerRef.current && e.target === containerRef.current) handleUserScrollInteraction();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key))
      handleUserScrollInteraction();
  };

  const toggleTapToSync = () => {
    ed.setIsTapToSyncActive(!ed.isTapToSyncActive);
    ed.setTapTargetIndex(0);
    ed.setTapTargetWordIndex(0);
  };
  useTimelineCommands({
    lines: ed.editableLines,
    hasUnsavedChanges: ed.hasUnsavedChanges,
    canUndo: ed.canUndo,
    canRedo: ed.canRedo,
    isTapToSyncActive: ed.isTapToSyncActive,
    reviewCount: review.reviewCount,
    filter: review.filter,
    onSave: ed.handleSave,
    onDiscard: () => ed.setShowDiscardModal(true),
    onUndo: ed.handleUndo,
    onRedo: ed.handleRedo,
    onOpenOffset: () => setShowBatchModal(true),
    onOpenDuet: () => setShowDuetModal(true),
    onOpenReplace: () => setShowReplaceModal(true),
    onToggleTapToSync: toggleTapToSync,
    onFilterChange: review.setFilter,
    onAddLine: ed.handleInsertLineAtEnd,
    onGoToLine: (line) => rowHandlers.onLineClick(line, false),
    onRealignSelected:
      effectiveProjectId && ed.selectedLineId !== null
        ? () => void realign.realignLine(ed.selectedLineId as number)
        : undefined,
    onRealignAll:
      onStartBackgroundRealign && ed.editableLines.length > 0 ? () => void realignAll() : undefined,
    isRealignRunning,
    onCancelRealign,
  });

  const selectedIndex = ed.editableLines.findIndex((l) => l.id === ed.selectedLineId);
  const activeLineIdx = selectedIndex >= 0 ? selectedIndex : 0;
  const isEmpty = ed.editableLines.length === 0;
  const asTabs = useWorkspaceTabs();
  return (
    <div className="flex flex-col gap-4 studio:h-full studio:min-h-0 studio:gap-3">
      <div
        id="workspace-panel-stage"
        {...workspacePanelProps('stage', asTabs)}
        data-testid="studio-panel-stage"
        className={`${panelCls(activeWorkspaceTab, 'stage')} studio:shrink-0`}
      >
        <LyricDisplay {...stagePropsOf(props)} lines={ed.editableLines} />
      </div>

      <div
        id="workspace-panel-timeline"
        {...workspacePanelProps('timeline', asTabs)}
        data-testid="studio-panel-timeline"
        className={`${panelCls(activeWorkspaceTab, 'timeline')} studio:min-h-0 studio:flex-1`}
      >
        <div className="@container relative flex flex-col gap-2.5 rounded-theme-xl border border-theme-border-subtle bg-theme-surface p-3 shadow-theme-md sm:p-4 studio:h-full studio:min-h-0">
          <TimelineToolbar
            lineCount={ed.editableLines.length}
            hasUnsavedChanges={ed.hasUnsavedChanges}
            isSaving={ed.isSaving}
            canUndo={ed.canUndo}
            canRedo={ed.canRedo}
            onUndo={ed.handleUndo}
            onRedo={ed.handleRedo}
            onOpenOffset={() => setShowBatchModal(true)}
            onOpenDuet={() => setShowDuetModal(true)}
            onOpenReplace={() => setShowReplaceModal(true)}
            isTapToSyncActive={ed.isTapToSyncActive}
            onToggleTapToSync={toggleTapToSync}
            onDiscard={() => ed.setShowDiscardModal(true)}
            onSave={ed.handleSave}
            filter={review.filter}
            onFilterChange={review.setFilter}
            reviewCount={review.reviewCount}
          />
          <p className="text-xs text-theme-text-muted studio:hidden">
            Click any line to jump audio. Nudge words or lines to fine-tune sync with the beat.
          </p>

          <SyncJobBanner
            job={syncJob}
            onCancel={onCancelRealign}
            hasReadyResult={syncResult.hasReadyResult}
            onLoadResult={syncResult.loadResult}
            onKeepEdits={syncResult.keepEdits}
          />

          <TapToSyncBanner
            isActive={ed.isTapToSyncActive}
            syncMode={ed.tapSyncMode}
            onModeChange={ed.setTapSyncMode}
            targetLine={ed.editableLines[ed.tapTargetIndex] ?? null}
            targetIndex={ed.tapTargetIndex}
            targetWordIndex={ed.tapTargetWordIndex}
            totalLines={ed.editableLines.length}
            onTap={ed.handleTriggerTap}
            onExit={() => ed.setIsTapToSyncActive(false)}
          />

          <div
            ref={containerRef}
            data-testid="timeline-scroll-container"
            tabIndex={0}
            onScroll={handleScroll}
            onWheel={handleUserScrollInteraction}
            onTouchMove={handleUserScrollInteraction}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
            className={S_SCROLL_AREA}
          >
            {isEmpty ? (
              <div className="rounded-theme-lg border border-dashed border-theme-border-subtle px-4 py-8 text-center">
                <p className="mb-3 text-sm text-theme-text-muted">No lyric lines yet.</p>
                <Button
                  onClick={ed.handleInsertLineAtEnd}
                  aria-label="+ Add First Lyric Line"
                  data-testid="add-line-btn"
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  + Add First Lyric Line
                </Button>
              </div>
            ) : review.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <CheckCircle2 className="h-6 w-6 text-theme-success" aria-hidden="true" />
                <p className="text-sm text-theme-text">No lines need review.</p>
                <Button variant="ghost" size="sm" onClick={() => review.setFilter('all')}>
                  Show all lines
                </Button>
              </div>
            ) : (
              <>
                {review.rows.map(({ line, index }) => {
                  const isActive = currentLine?.id === line.id;
                  const isExpanded = ed.selectedLineId === line.id;
                  const hasActiveWord = activeWordLoc?.lineId === line.id;
                  const isEditing = ed.editingLineId === line.id;
                  return (
                    <TimelineLineCard
                      key={line.id}
                      line={line}
                      idx={index}
                      isCurrentlyActive={isActive}
                      isExpanded={isExpanded}
                      editingLineId={isEditing ? line.id : null}
                      editingText={isEditing ? ed.editingText : ''}
                      activeWordLoc={hasActiveWord ? activeWordLoc : null}
                      currentTime={isExpanded ? currentTime : undefined}
                      showWords={isActive || isExpanded || hasActiveWord}
                      issues={review.issuesById.get(line.id)}
                      editInputRef={ed.editInputRef}
                      {...rowHandlers}
                      onRealignLine={effectiveProjectId ? rowHandlers.onRealignLine : undefined}
                      isRealigning={realign.realigningLineId === line.id}
                    />
                  );
                })}
                {review.filter === 'all' && (
                  <div className="pt-1.5">
                    <button
                      type="button"
                      onClick={ed.handleInsertLineAtEnd}
                      aria-label="Add new lyric line"
                      data-testid="add-line-btn"
                      className={S_ADD_LINE_BTN}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" /> Add Lyric Line
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {isUserScrolling && (
            <button
              type="button"
              onClick={resumeAutoScroll}
              title="Auto-scroll is paused. Click to resume."
              className={S_RESUME_PILL}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-theme-highlight motion-safe:animate-pulse"
              />
              Auto-scroll paused
              <span className="text-theme-text-muted">· Resume</span>
            </button>
          )}
        </div>
      </div>
      <TimelineModals
        showDiscardModal={ed.showDiscardModal}
        onCloseDiscard={() => ed.setShowDiscardModal(false)}
        onConfirmDiscard={ed.handleConfirmDiscard}
        lineToDelete={ed.lineToDelete}
        onCloseDelete={() => ed.setLineToDelete(null)}
        onConfirmDelete={ed.handleConfirmDeleteLine}
      />
      <BatchOffsetModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        onApplyOffset={ed.handleApplyBatchOffset}
        selectedLineIndex={activeLineIdx}
        totalLines={ed.editableLines.length}
      />
      <LyricReplacementModal
        isOpen={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        projectId={effectiveProjectId}
        trackTitle={trackTitle}
        trackArtist={trackArtist}
        onSuccess={ed.handleReplaceLyrics}
        currentLines={ed.editableLines}
        onStartBackground={onStartBackgroundRealign}
      />
      <DuetAssignmentModal
        isOpen={showDuetModal}
        onClose={() => setShowDuetModal(false)}
        lines={ed.editableLines}
        onApply={ed.handleBulkAssignSinger}
        selectedLineIndex={activeLineIdx}
      />
    </div>
  );
};
