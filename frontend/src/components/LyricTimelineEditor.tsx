/** Lyric Timeline Editor: Line/word timing, editing, duet parts, undo/redo, tap sync */

import React, { useMemo, useState } from 'react';
import { LyricLine, WordTiming } from '../types';
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
import { LyricDisplay } from './LyricDisplay';
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

export { recalculateWordTimings };

export interface LyricTimelineEditorProps {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  isPlaying?: boolean;
  playbackRate?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onTogglePlay?: () => void;
  onSeek: (time: number) => void;
  onSaveLines: (updatedLines: LyricLine[]) => Promise<void | boolean> | void;
  albumArtUrl?: string;
  themeSungColor?: string;
  themeUnsungColor?: string;
  onDirtyChange?: (isDirty: boolean) => void;
  aspectRatio?: string;
  fontSizeScale?: number;
  projectId?: string;
  trackTitle?: string;
  trackArtist?: string;
  showVisualizer?: boolean;
  onToggleVisualizer?: () => void;
  analyserNode?: AnalyserNode | null;
}

export const LyricTimelineEditor: React.FC<LyricTimelineEditorProps> = ({
  lines,
  currentTime,
  duration,
  isPlaying = false,
  playbackRate = 1.0,
  audioRef,
  onTogglePlay,
  onSeek,
  onSaveLines,
  albumArtUrl,
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  onDirtyChange,
  aspectRatio = '16:9',
  fontSizeScale = 1.0,
  projectId,
  trackTitle = 'Track',
  trackArtist = 'Artist',
  showVisualizer,
  onToggleVisualizer,
  analyserNode,
}) => {
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [showDuetModal, setShowDuetModal] = useState(false);

  const ed = useLyricEditorState({ lines, currentTime, duration, onSaveLines, onDirtyChange });
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

  const selectedIndex = ed.editableLines.findIndex((l) => l.id === ed.selectedLineId);

  return (
    <div className="space-y-6">
      {/* 1. Live Karaoke Stage Preview */}
      <LyricDisplay
        lines={ed.editableLines}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        audioRef={audioRef}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        albumArtUrl={albumArtUrl}
        themeSungColor={themeSungColor}
        themeUnsungColor={themeUnsungColor}
        aspectRatio={aspectRatio}
        fontSizeScale={fontSizeScale}
        showVisualizer={showVisualizer}
        onToggleVisualizer={onToggleVisualizer}
        analyserNode={analyserNode}
      />

      {/* 2. Visual Timeline & Power Tools */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-5 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Word-by-Word Timeline Editor
              </h3>
              {ed.hasUnsavedChanges && (
                <span
                  data-testid="dirty-indicator"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold"
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
                  className="px-2.5 py-0.5 rounded-full bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-[10px] font-medium flex items-center gap-1.5 transition-all shadow-md"
                  title="Auto-scroll is paused. Click to resume."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  Auto-scroll paused • Click to resume
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any line to jump audio. Nudge words or lines to fine-tune sync with the beat.
            </p>
          </div>

          {/* Toolbar: Undo/Redo, Batch Offset, Tap Mode, Realign, Save/Discard */}
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            <Tooltip content="Undo lyric change (Ctrl+Z)" position="top">
              <button
                type="button"
                data-testid="undo-lyrics-btn"
                aria-label="Undo lyric change (Ctrl+Z)"
                onClick={ed.handleUndo}
                disabled={!ed.canUndo || ed.isSaving}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-40 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[36px]"
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
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-40 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[36px]"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Batch shift timestamps" position="top">
              <button
                type="button"
                data-testid="batch-offset-btn"
                aria-label="Batch shift timestamps"
                onClick={() => setShowBatchModal(true)}
                disabled={ed.isSaving || ed.editableLines.length === 0}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[36px]"
              >
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden md:inline">Offset</span>
              </button>
            </Tooltip>
            <Tooltip content="Assign duet singer parts" position="top">
              <button
                type="button"
                data-testid="duet-assign-btn"
                aria-label="Assign duet singer parts"
                onClick={() => setShowDuetModal(true)}
                disabled={ed.isSaving || ed.editableLines.length === 0}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-400 min-h-[44px] min-w-[44px] shrink-0"
              >
                <Users className="w-3.5 h-3.5 text-pink-400" />
                <span className="hidden md:inline">Duet Parts</span>
              </button>
            </Tooltip>
            <Tooltip content="Live tap-to-sync mode (T)" position="top">
              <button
                type="button"
                data-testid="tap-to-sync-btn"
                aria-label="Live tap-to-sync mode (T)"
                onClick={() => {
                  ed.setIsTapToSyncActive(!ed.isTapToSyncActive);
                  ed.setTapTargetIndex(0);
                  ed.setTapTargetWordIndex(0);
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all min-h-[36px] ${
                  ed.isTapToSyncActive
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                <Radio
                  className={`w-3.5 h-3.5 ${ed.isTapToSyncActive ? 'animate-pulse text-amber-400' : 'text-slate-400'}`}
                />
                <span className="hidden md:inline">Tap Sync</span>
              </button>
            </Tooltip>
            <Tooltip content="Replace or re-align lyrics" position="top">
              <button
                type="button"
                data-testid="replace-lyrics-btn"
                aria-label="Replace or re-align lyrics"
                onClick={() => setShowReplaceModal(true)}
                disabled={ed.isSaving}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[36px]"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
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
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 min-h-[36px]"
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
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 min-h-[36px]"
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

        {/* Live Tap-to-Sync Sticky Banner */}
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

        {/* Scrollable list of lines */}
        <div
          ref={containerRef}
          data-testid="timeline-scroll-container"
          tabIndex={0}
          onScroll={handleScroll}
          onWheel={handleUserScrollInteraction}
          onTouchMove={handleUserScrollInteraction}
          onPointerDown={(e) => {
            if (
              (e.target as HTMLElement)?.closest('button, input, select, textarea, [role="button"]')
            )
              return;
            if (containerRef.current && e.target === containerRef.current)
              handleUserScrollInteraction();
          }}
          onKeyDown={(e) => {
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key))
              handleUserScrollInteraction();
          }}
          className="max-h-[300px] sm:max-h-[380px] overflow-y-auto space-y-2 pr-1 scroll-smooth focus:outline-none touch-pan-y overscroll-contain"
        >
          {ed.editableLines.length === 0 ? (
            <div className="text-center py-8 px-4 bg-slate-950/40 rounded-xl border border-slate-800/80">
              <p className="text-sm text-slate-400 mb-3">No lyric lines yet.</p>
              <button
                type="button"
                onClick={ed.handleInsertLineAtEnd}
                aria-label="+ Add First Lyric Line"
                data-testid="add-line-btn"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-400"
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
                  className="w-full min-h-[44px] py-2 px-3 rounded-xl border border-dashed border-slate-700 hover:border-cyan-500/70 bg-slate-950/30 hover:bg-cyan-950/20 text-slate-400 hover:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400"
                >
                  <Plus className="w-4 h-4" /> Add Lyric Line
                </button>
              </div>
            </>
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
        selectedLineIndex={selectedIndex >= 0 ? selectedIndex : 0}
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
        selectedLineIndex={selectedIndex >= 0 ? selectedIndex : 0}
      />
    </div>
  );
};
