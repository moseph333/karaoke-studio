/**
 * Lyric Timeline Editor Component
 *
 * Orchestrates lyric line and word timing adjustments, inline text editing,
 * line addition and deletion, dirty state tracking, and persistence.
 * Composes the live stage preview, auto-scrolling container, and confirmation modals.
 */

import React, { useMemo } from 'react';
import { LyricLine, WordTiming } from '../types';
import { Edit3, Check, RotateCcw, Loader2, Plus } from 'lucide-react';
import { LyricDisplay } from './LyricDisplay';
import { recalculateWordTimings } from '../utils/lyrics';
import { useTimelineAutoScroll } from '../hooks/useTimelineAutoScroll';
import { useLyricEditorState } from '../hooks/useLyricEditorState';
import { TimelineLineCard, type ActiveWordLocation } from './timeline/TimelineLineCard';
import { TimelineModals } from './timeline/TimelineModals';
import { Tooltip } from './Tooltip';

export { recalculateWordTimings };

export interface LyricTimelineEditorProps {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  isPlaying?: boolean;
  onSeek: (time: number) => void;
  onSaveLines: (updatedLines: LyricLine[]) => Promise<void | boolean> | void;
  albumArtUrl?: string;
  themeSungColor?: string;
  themeUnsungColor?: string;
  onDirtyChange?: (isDirty: boolean) => void;
  aspectRatio?: string;
}

const getActiveWordLocation = (
  lines: LyricLine[],
  currentTime: number
): ActiveWordLocation | null => {
  if (!lines || lines.length === 0) return null;

  for (const line of lines) {
    if (currentTime >= line.start_time - 0.5 && currentTime <= line.end_time + 0.5) {
      if (line.words && line.words.length > 0) {
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time && currentTime <= w.end_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }

        for (let wIdx = line.words.length - 1; wIdx >= 0; wIdx--) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }

        if (currentTime >= line.start_time - 0.5) {
          return { lineId: line.id, wordIndex: 0, word: line.words[0] };
        }
      }
    }
  }

  return null;
};

export const LyricTimelineEditor: React.FC<LyricTimelineEditorProps> = ({
  lines,
  currentTime,
  duration,
  isPlaying = false,
  onSeek,
  onSaveLines,
  albumArtUrl,
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  onDirtyChange,
  aspectRatio = '16:9',
}) => {
  const {
    editableLines,
    selectedLineId,
    setSelectedLineId,
    isSaving,
    showDiscardModal,
    setShowDiscardModal,
    editingLineId,
    editingText,
    setEditingText,
    lineToDelete,
    setLineToDelete,
    editInputRef,
    hasUnsavedChanges,
    nudgeLine,
    nudgeWordBoundary,
    nudgeWord,
    updateWordTiming,
    handleSave,
    handleConfirmDiscard,
    handleStartEditing,
    handleCancelEditing,
    handleCommitEditing,
    handleInsertLineAbove,
    handleInsertLineBelow,
    handleInsertLineAtEnd,
    handleConfirmDeleteLine,
  } = useLyricEditorState({
    lines,
    currentTime,
    duration,
    onSaveLines,
    onDirtyChange,
  });

  // Find currently active line for list item highlight
  const activeLineIndex = editableLines.findIndex(
    (l) => currentTime >= l.start_time - 1.5 && currentTime <= l.end_time + 1.0
  );
  const currentLine = activeLineIndex >= 0 ? editableLines[activeLineIndex] : null;

  // Active word location for precision word highlight
  const activeWordLoc = useMemo(() => {
    return getActiveWordLocation(editableLines, currentTime);
  }, [editableLines, currentTime]);

  const activeKey = activeWordLoc
    ? `${activeWordLoc.lineId}-${activeWordLoc.wordIndex}`
    : activeLineIndex >= 0
      ? `line-${editableLines[activeLineIndex].id}`
      : null;

  // Hook for automatic timeline scrolling & manual scroll interaction detection
  const {
    containerRef,
    isUserScrolling,
    resumeAutoScroll,
    handleScroll,
    handleUserScrollInteraction,
  } = useTimelineAutoScroll({
    currentTime,
    isPlaying,
    editableLines,
    activeLineIndex,
    activeKey,
    selectedLineId,
  });

  const handleLineClick = (line: LyricLine, isExpanded: boolean) => {
    resumeAutoScroll();
    onSeek(line.start_time);
    setSelectedLineId(isExpanded ? null : line.id);
  };

  const handleWordClick = (w: WordTiming) => {
    resumeAutoScroll();
    onSeek(w.start_time);
  };

  return (
    <div className="space-y-6">
      {/* 1. Live Karaoke Stage Preview (Feature 43: LyricDisplay) */}
      <LyricDisplay
        lines={editableLines}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        onSeek={onSeek}
        albumArtUrl={albumArtUrl}
        themeSungColor={themeSungColor}
        themeUnsungColor={themeUnsungColor}
        aspectRatio={aspectRatio}
      />

      {/* 2. Visual Timeline & Precision Word Editor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Word-by-Word Timeline Editor
              </h3>
              {hasUnsavedChanges && (
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
                  title="Auto-scroll is paused due to manual scrolling. Click to resume immediately."
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
          {hasUnsavedChanges && (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              <Tooltip content="Discard unsaved lyric edits" position="top">
                <button
                  type="button"
                  data-testid="discard-changes-btn"
                  onClick={() => setShowDiscardModal(true)}
                  disabled={isSaving}
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
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 min-h-[36px]"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Lyrics & Timing Changes
                      <span className="sr-only">Save Timing Changes</span>
                      <span className="sr-only">Save Lyrics</span>
                    </>
                  )}
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Scrollable list of lines */}
        <div
          ref={containerRef}
          data-testid="timeline-scroll-container"
          tabIndex={0}
          onScroll={handleScroll}
          onWheel={handleUserScrollInteraction}
          onTouchMove={handleUserScrollInteraction}
          onPointerDown={(e) => {
            const targetEl = e.target as HTMLElement | null;
            if (targetEl?.closest('button, input, select, textarea, [role="button"]')) {
              return;
            }
            const container = containerRef.current;
            if (container && e.target === container) {
              handleUserScrollInteraction();
            }
          }}
          onKeyDown={(e) => {
            const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (
              targetTag === 'input' ||
              targetTag === 'textarea' ||
              (e.target as HTMLElement)?.isContentEditable
            ) {
              return;
            }
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
              handleUserScrollInteraction();
            }
          }}
          className="max-h-[300px] sm:max-h-[380px] overflow-y-auto space-y-2 pr-1 scroll-smooth focus:outline-none touch-pan-y overscroll-contain"
        >
          {editableLines.length === 0 ? (
            <div className="text-center py-8 px-4 bg-slate-950/40 rounded-xl border border-slate-800/80">
              <p className="text-sm text-slate-400 mb-3">No lyric lines yet.</p>
              <button
                type="button"
                onClick={handleInsertLineAtEnd}
                aria-label="+ Add First Lyric Line"
                data-testid="add-line-btn"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                <Plus className="w-4 h-4" />+ Add First Lyric Line
              </button>
            </div>
          ) : (
            <>
              {editableLines.map((line, idx) => {
                const isCurrentlyActive = currentLine?.id === line.id;
                const isExpanded = selectedLineId === line.id;

                return (
                  <TimelineLineCard
                    key={line.id}
                    line={line}
                    idx={idx}
                    isCurrentlyActive={isCurrentlyActive}
                    isExpanded={isExpanded}
                    editingLineId={editingLineId}
                    editingText={editingText}
                    activeWordLoc={activeWordLoc}
                    editInputRef={editInputRef}
                    onLineClick={handleLineClick}
                    onWordClick={handleWordClick}
                    onStartEditing={handleStartEditing}
                    onCommitEditing={handleCommitEditing}
                    onCancelEditing={handleCancelEditing}
                    onSetEditingText={setEditingText}
                    onNudgeLine={nudgeLine}
                    onInsertLineAbove={handleInsertLineAbove}
                    onInsertLineBelow={handleInsertLineBelow}
                    onDeleteLine={setLineToDelete}
                    onToggleExpand={(id) => setSelectedLineId(isExpanded ? null : id)}
                    onNudgeWord={nudgeWord}
                    onNudgeWordBoundary={nudgeWordBoundary}
                    onUpdateWordTiming={updateWordTiming}
                  />
                );
              })}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleInsertLineAtEnd}
                  aria-label="Add new lyric line"
                  data-testid="add-line-btn"
                  className="w-full min-h-[44px] py-2 px-3 rounded-xl border border-dashed border-slate-700 hover:border-cyan-500/70 bg-slate-950/30 hover:bg-cyan-950/20 text-slate-400 hover:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400"
                >
                  <Plus className="w-4 h-4" />
                  Add Lyric Line
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <TimelineModals
        showDiscardModal={showDiscardModal}
        onCloseDiscard={() => setShowDiscardModal(false)}
        onConfirmDiscard={handleConfirmDiscard}
        lineToDelete={lineToDelete}
        onCloseDelete={() => setLineToDelete(null)}
        onConfirmDelete={handleConfirmDeleteLine}
      />
    </div>
  );
};
