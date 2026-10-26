/** Lyric Timeline Editor: Line/word timing, editing, duet parts, undo/redo, tap sync */

import React, { useMemo, useState } from 'react';
import { LyricLine, WordTiming, StudioWorkspaceTab } from '../types';
import {
  Edit3,
  Check,
  RotateCcw,
  RotateCw,
  Loader2,
  Plus,
  Clock,
  Radio,
  FileText,
  Users,
} from 'lucide-react';
import { LyricDisplay, LyricDisplayProps } from './LyricDisplay';
import { recalculateWordTimings, getActiveWordLocation } from '../utils/lyrics';
import { useTimelineAutoScroll } from '../hooks/useTimelineAutoScroll';
import { useLyricEditorState } from '../hooks/useLyricEditorState';
import { TimelineLineCard } from './timeline/TimelineLineCard';
import { TimelineModals } from './timeline/TimelineModals';
import { BatchOffsetModal } from './timeline/BatchOffsetModal';
import { TapToSyncBanner } from './timeline/TapToSyncBanner';
import { LyricReplacementModal } from './timeline/LyricReplacementModal';
import { DuetAssignmentModal } from './timeline/DuetAssignmentModal';
import { Tooltip } from './Tooltip';
import {
  S_RESUME_BTN,
  S_ICON_BTN,
  S_ACTION_BTN,
  S_DUET_BTN,
  S_DISCARD_BTN,
  S_SAVE_BTN,
  S_ADD_FIRST_BTN,
  S_ADD_LINE_BTN,
  S_TAP_SYNC_BTN,
} from './timeline/timelineStyles';

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
  } = props;
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [showDuetModal, setShowDuetModal] = useState(false);
  const ed = useLyricEditorState(props);
  const effectiveProjectId =
    projectId || new URLSearchParams(window.location.search).get('project') || '';
  const activeLineIndex = ed.editableLines.findIndex(
    (l) => currentTime >= l.start_time - 1.5 && currentTime <= l.end_time + 1.0
  );
  const currentLine = activeLineIndex >= 0 ? ed.editableLines[activeLineIndex] : null;
  const activeWordLoc = useMemo(
    () => getActiveWordLocation(ed.editableLines, currentTime),
    [ed.editableLines, currentTime]
  );
  const activeKey = activeWordLoc
    ? `${activeWordLoc.lineId}-${activeWordLoc.wordIndex}`
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

  const handleLineClick = (line: LyricLine, isExpanded: boolean) => {
    resumeAutoScroll();
    onSeek(line.start_time);
    ed.setSelectedLineId(isExpanded ? null : line.id);
  };
  const handleWordClick = (w: WordTiming) => {
    resumeAutoScroll();
    onSeek(w.start_time);
  };
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

  const selectedIndex = ed.editableLines.findIndex((l) => l.id === ed.selectedLineId);
  const activeLineIdx = selectedIndex >= 0 ? selectedIndex : 0;
  return (
    <div className="space-y-6">
      <div
        id="workspace-panel-stage"
        role="tabpanel"
        aria-labelledby="workspace-tab-stage"
        tabIndex={0}
        data-testid="studio-panel-stage"
        className={panelCls(activeWorkspaceTab, 'stage')}
      >
        <LyricDisplay {...props} lines={ed.editableLines} />
      </div>

      <div
        id="workspace-panel-timeline"
        role="tabpanel"
        aria-labelledby="workspace-tab-timeline"
        tabIndex={0}
        data-testid="studio-panel-timeline"
        className={panelCls(activeWorkspaceTab, 'timeline')}
      >
        <div className="bg-theme-surface border border-theme-border rounded-theme-xl p-3 sm:p-5 shadow-theme-lg space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-theme-border-subtle">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-theme-text font-theme-heading flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-theme-accent" />
                  Word-by-Word Timeline Editor
                </h3>
                {ed.hasUnsavedChanges && (
                  <span
                    data-testid="dirty-indicator"
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-theme-pill bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold"
                    title="You have unsaved lyric or timing changes"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Unsaved Changes
                  </span>
                )}
                {isUserScrolling && (
                  <button
                    type="button"
                    onClick={resumeAutoScroll}
                    className={S_RESUME_BTN}
                    title="Auto-scroll is paused. Click to resume."
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
                    Auto-scroll paused • Click to resume
                  </button>
                )}
              </div>
              <p className="text-xs text-theme-text-muted font-theme-body mt-0.5">
                Click any line to jump audio. Nudge words or lines to fine-tune sync with the beat.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 justify-end">
              <Tooltip content="Undo lyric change (Ctrl+Z)" position="top">
                <button
                  type="button"
                  data-testid="undo-lyrics-btn"
                  aria-label="Undo lyric change (Ctrl+Z)"
                  onClick={ed.handleUndo}
                  disabled={!ed.canUndo || ed.isSaving}
                  className={S_ICON_BTN}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <Tooltip content="Redo lyric change (Ctrl+Y)" position="top">
                <button
                  type="button"
                  data-testid="redo-lyrics-btn"
                  aria-label="Redo lyric change (Ctrl+Y)"
                  onClick={ed.handleRedo}
                  disabled={!ed.canRedo || ed.isSaving}
                  className={S_ICON_BTN}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <Tooltip content="Batch shift timestamps" position="top">
                <button
                  type="button"
                  data-testid="batch-offset-btn"
                  aria-label="Batch offset timestamps"
                  onClick={() => setShowBatchModal(true)}
                  disabled={ed.isSaving || ed.editableLines.length === 0}
                  className={S_ACTION_BTN}
                >
                  <Clock className="w-3.5 h-3.5 text-theme-accent" />
                  <span className="hidden md:inline">Offset</span>
                </button>
              </Tooltip>
              <Tooltip content="Assign duet singer parts" position="top">
                <button
                  type="button"
                  data-testid="duet-assign-btn"
                  aria-label="Assign duet roles / singer parts"
                  onClick={() => setShowDuetModal(true)}
                  disabled={ed.isSaving || ed.editableLines.length === 0}
                  className={S_DUET_BTN}
                >
                  <Users className="w-3.5 h-3.5 text-pink-400" />
                  <span className="hidden md:inline">Duet Parts</span>
                </button>
              </Tooltip>
              <Tooltip content="Live tap-to-sync mode (T)" position="top">
                <button
                  type="button"
                  data-testid="tap-to-sync-btn"
                  aria-label="Live tap to sync mode (T)"
                  onClick={() => {
                    ed.setIsTapToSyncActive(!ed.isTapToSyncActive);
                    ed.setTapTargetIndex(0);
                    ed.setTapTargetWordIndex(0);
                  }}
                  className={`${S_TAP_SYNC_BTN} ${
                    ed.isTapToSyncActive
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-theme-sm'
                      : 'bg-theme-surface-subtle hover:bg-theme-surface-raised border-theme-border-subtle text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  <Radio
                    className={`w-3.5 h-3.5 ${ed.isTapToSyncActive ? 'animate-pulse text-amber-400' : 'text-theme-text-muted'}`}
                  />
                  <span className="hidden md:inline">Tap Sync</span>
                </button>
              </Tooltip>
              <Tooltip content="Replace or re-align lyrics" position="top">
                <button
                  type="button"
                  data-testid="replace-lyrics-btn"
                  aria-label="Replace text or re-align lyrics"
                  onClick={() => setShowReplaceModal(true)}
                  disabled={ed.isSaving}
                  className={S_ACTION_BTN}
                >
                  <FileText className="w-3.5 h-3.5 text-theme-accent" />
                  <span className="hidden md:inline">Re-import</span>
                </button>
              </Tooltip>
              {ed.hasUnsavedChanges && (
                <>
                  <Tooltip content="Discard unsaved lyric edits" position="top">
                    <button
                      type="button"
                      data-testid="discard-changes-btn"
                      onClick={() => ed.setShowDiscardModal(true)}
                      disabled={ed.isSaving}
                      className={S_DISCARD_BTN}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Discard Changes
                    </button>
                  </Tooltip>
                  <Tooltip content="Save lyrics & timing changes to server" position="top">
                    <button
                      type="button"
                      data-testid="save-lyrics-btn"
                      aria-label="Save Timing Changes - Save Lyrics & Timing Changes"
                      onClick={ed.handleSave}
                      disabled={ed.isSaving}
                      className={S_SAVE_BTN}
                    >
                      {ed.isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" /> Save Lyrics & Timing Changes
                          <span className="sr-only">Save Timing Changes</span>
                          <span className="sr-only">Save Lyrics</span>
                        </>
                      )}
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>

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
            className="max-h-[300px] sm:max-h-[380px] overflow-y-auto space-y-2 pr-1 scroll-smooth focus:outline-none touch-pan-y overscroll-contain"
          >
            {ed.editableLines.length === 0 ? (
              <div className="text-center py-8 px-4 bg-theme-surface-subtle/50 rounded-theme-lg border border-theme-border-subtle shadow-theme-sm">
                <p className="text-sm text-theme-text-muted font-theme-body mb-3">
                  No lyric lines yet.
                </p>
                <button
                  type="button"
                  onClick={ed.handleInsertLineAtEnd}
                  aria-label="+ Add First Lyric Line"
                  data-testid="add-line-btn"
                  className={S_ADD_FIRST_BTN}
                >
                  <Plus className="w-4 h-4" />+ Add First Lyric Line
                </button>
              </div>
            ) : (
              <>
                {ed.editableLines.map((line, idx) => (
                  <TimelineLineCard
                    key={line.id}
                    line={line}
                    idx={idx}
                    isCurrentlyActive={currentLine?.id === line.id}
                    currentTime={currentTime}
                    isExpanded={ed.selectedLineId === line.id}
                    editingLineId={ed.editingLineId}
                    editingText={ed.editingText}
                    activeWordLoc={activeWordLoc}
                    editInputRef={ed.editInputRef}
                    onLineClick={handleLineClick}
                    onWordClick={handleWordClick}
                    onStartEditing={ed.handleStartEditing}
                    onCommitEditing={ed.handleCommitEditing}
                    onCancelEditing={ed.handleCancelEditing}
                    onSetEditingText={ed.setEditingText}
                    onNudgeLine={ed.nudgeLine}
                    onInsertLineAbove={ed.handleInsertLineAbove}
                    onInsertLineBelow={ed.handleInsertLineBelow}
                    onDeleteLine={ed.setLineToDelete}
                    onToggleExpand={(id) =>
                      ed.setSelectedLineId(ed.selectedLineId === id ? null : id)
                    }
                    onNudgeWord={ed.nudgeWord}
                    onNudgeWordBoundary={ed.nudgeWordBoundary}
                    onUpdateWordTiming={ed.updateWordTiming}
                    onCycleSinger={ed.handleCycleLineSinger}
                  />
                ))}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={ed.handleInsertLineAtEnd}
                    aria-label="Add new lyric line"
                    data-testid="add-line-btn"
                    className={S_ADD_LINE_BTN}
                  >
                    <Plus className="w-4 h-4" /> Add Lyric Line
                  </button>
                </div>
              </>
            )}
          </div>
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
