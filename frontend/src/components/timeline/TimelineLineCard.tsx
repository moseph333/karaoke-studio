/**
 * Timeline Line Card Component
 *
 * Renders an individual lyric line with inline text editing, timestamp nudging,
 * structure mutations (insert above/below, delete), progressive word stream chips,
 * and mounts the expandable word timing editor.
 */

import React from 'react';
import { Edit3, Check, ChevronRight, FastForward, Rewind, Plus, Trash2, X } from 'lucide-react';
import { LyricLine, WordTiming } from '../../types';
import { formatLineTime } from '../../utils/lyrics';
import { ExpandedWordEditor, type ActiveWordLocation } from './ExpandedWordEditor';
import { Tooltip } from '../Tooltip';

export type { ActiveWordLocation };

export interface TimelineLineCardProps {
  line: LyricLine;
  idx: number;
  isCurrentlyActive: boolean;
  isExpanded: boolean;
  editingLineId: number | null;
  editingText: string;
  activeWordLoc: ActiveWordLocation | null;
  editInputRef: React.RefObject<HTMLInputElement>;
  onLineClick: (line: LyricLine, isExpanded: boolean) => void;
  onWordClick: (w: WordTiming) => void;
  onStartEditing: (line: LyricLine) => void;
  onCommitEditing: (lineId: number, newText: string) => void;
  onCancelEditing: () => void;
  onSetEditingText: (text: string) => void;
  onNudgeLine: (lineId: number, offset: number) => void;
  onInsertLineAbove: (index: number) => void;
  onInsertLineBelow: (index: number) => void;
  onDeleteLine: (line: LyricLine) => void;
  onToggleExpand: (lineId: number) => void;
  onNudgeWord: (lineId: number, wordIndex: number, delta: number) => void;
  onNudgeWordBoundary: (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => void;
  onUpdateWordTiming: (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => void;
  onCycleSinger?: (lineId: number) => void;
  currentTime?: number;
}

export const TimelineLineCard: React.FC<TimelineLineCardProps> = ({
  line,
  idx,
  isCurrentlyActive,
  isExpanded,
  editingLineId,
  editingText,
  activeWordLoc,
  currentTime,
  editInputRef,
  onLineClick,
  onWordClick,
  onStartEditing,
  onCommitEditing,
  onCancelEditing,
  onSetEditingText,
  onNudgeLine,
  onInsertLineAbove,
  onInsertLineBelow,
  onDeleteLine,
  onToggleExpand,
  onNudgeWord,
  onNudgeWordBoundary,
  onUpdateWordTiming,
  onCycleSinger,
}) => {
  const singerRole = line.singer ?? 'singer1';
  const singerMeta = {
    singer1: {
      label: '🎤 S1',
      fullLabel: 'Singer 1 / Lead',
      ariaLabel: 'Singer: Singer 1 / Lead. Click to cycle to Singer 2',
      badgeClass:
        'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-300 focus:ring-amber-400',
    },
    singer2: {
      label: '🎤 S2',
      fullLabel: 'Singer 2 / Partner',
      ariaLabel: 'Singer: Singer 2 / Partner. Click to cycle to Both / Duet',
      badgeClass:
        'bg-pink-500/15 hover:bg-pink-500/25 border-pink-500/40 text-pink-300 focus:ring-pink-400',
    },
    both: {
      label: '👥 Both',
      fullLabel: 'Both / Duet',
      ariaLabel: 'Singer: Both / Duet. Click to cycle to Singer 1 / Lead',
      badgeClass:
        'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300 focus:ring-emerald-400',
    },
  }[singerRole];
  return (
    <div
      data-testid={`timeline-line-${line.id}`}
      data-active-line={isCurrentlyActive ? 'true' : undefined}
      className={`p-3 rounded-theme-lg border transition-all ${
        isCurrentlyActive
          ? 'bg-theme-surface-raised border-theme-border shadow-theme-md'
          : 'bg-theme-surface-subtle border-theme-border-subtle hover:border-theme-border'
      }`}
    >
      <div className="flex flex-col sm:flex-row flex-wrap sm:items-center sm:justify-between gap-2 sm:gap-3">
        {editingLineId === line.id ? (
          <div className="flex items-center gap-1.5 w-full sm:flex-1 overflow-hidden min-h-[44px]">
            <span className="font-mono text-xs text-theme-text-muted bg-theme-bg px-2 py-1 rounded-theme-sm border border-theme-border-subtle shrink-0">
              {formatLineTime(line.start_time)}s - {formatLineTime(line.end_time)}s
            </span>
            <input
              ref={editInputRef}
              type="text"
              value={editingText}
              onChange={(e) => onSetEditingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onCommitEditing(line.id, editingText);
                } else if (e.key === 'Escape') {
                  onCancelEditing();
                }
              }}
              onBlur={() => onCommitEditing(line.id, editingText)}
              aria-label={`Edit text for line ${line.id}`}
              data-testid={`line-text-input-${line.id}`}
              className="flex-1 min-w-0 min-h-[44px] px-2.5 py-1.5 rounded-theme-sm bg-theme-bg border border-theme-accent text-theme-text text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-theme-accent font-theme-body"
            />
            <button
              type="button"
              onClick={() => onCommitEditing(line.id, editingText)}
              aria-label={`Commit edit for line ${line.id}`}
              data-testid={`commit-edit-${line.id}`}
              className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title="Commit edit (Enter)"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCancelEditing();
              }}
              onClick={onCancelEditing}
              aria-label={`Cancel edit for line ${line.id}`}
              data-testid={`cancel-edit-${line.id}`}
              className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-theme-border"
              title="Cancel edit (Escape)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 w-full sm:flex-1 overflow-hidden min-h-[40px]">
            <Tooltip
              content={`Current part: ${singerMeta.fullLabel}. Click to cycle role`}
              position="top"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleSinger?.(line.id);
                }}
                aria-label={singerMeta.ariaLabel}
                data-testid={`toggle-singer-${line.id}`}
                className={`min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-theme-sm border text-xs font-bold font-mono inline-flex items-center justify-center shrink-0 transition-all focus:outline-none focus:ring-2 ${singerMeta.badgeClass}`}
              >
                {singerMeta.label}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => onLineClick(line, isExpanded)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEditing(line);
              }}
              aria-label={`Select line: ${line.text} (${formatLineTime(line.start_time)}s to ${formatLineTime(line.end_time)}s)`}
              className="flex items-center gap-2 sm:gap-3 cursor-pointer w-full sm:flex-1 overflow-hidden text-left bg-transparent border-0 p-0 focus:outline-none focus:ring-2 focus:ring-theme-accent rounded-theme-sm min-h-[40px]"
            >
              <span className="font-mono text-xs text-theme-text-muted bg-theme-bg px-2 py-1 rounded-theme-sm border border-theme-border-subtle shrink-0">
                {formatLineTime(line.start_time)}s - {formatLineTime(line.end_time)}s
              </span>
              <span
                className={`text-sm font-semibold truncate min-w-0 flex-1 font-theme-body ${
                  isCurrentlyActive ? 'text-theme-accent font-bold' : 'text-theme-text'
                }`}
              >
                {line.text}
              </span>
            </button>
            <Tooltip content="Edit lyric text inline" position="top">
              <button
                type="button"
                onClick={() => onStartEditing(line)}
                aria-label={`Edit text for line ${line.id}`}
                data-testid={`edit-line-text-${line.id}`}
                className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text flex items-center justify-center shrink-0 focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Right side controls: Nudges + Structure (Insert above/below, Delete) + Expand */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-theme-border-subtle mt-2 sm:mt-0 shrink-0">
          {/* Nudge controls */}
          <div className="flex items-center gap-1">
            {/* Coarse Earlier: -0.2s */}
            <Tooltip content="Nudge line 0.2s earlier" position="top">
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, -0.2)}
                aria-label={`Nudge line ${line.id} 0.2s earlier`}
                className="min-h-[40px] px-3 sm:min-h-[32px] sm:px-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-mono flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <Rewind className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </Tooltip>

            {/* Fine Earlier: -0.05s */}
            <Tooltip content="Fine-nudge line 0.05s earlier" position="top">
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, -0.05)}
                aria-label={`Nudge line ${line.id} 0.05s earlier`}
                className="min-h-[40px] px-3 sm:min-h-[32px] sm:px-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-accent font-mono text-xs font-semibold flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                -0.05s
              </button>
            </Tooltip>

            {/* Fine Later: +0.05s */}
            <Tooltip content="Fine-nudge line 0.05s later" position="top">
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, 0.05)}
                aria-label={`Nudge line ${line.id} 0.05s later`}
                className="min-h-[40px] px-3 sm:min-h-[32px] sm:px-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-accent font-mono text-xs font-semibold flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                +0.05s
              </button>
            </Tooltip>

            {/* Coarse Later: +0.2s */}
            <Tooltip content="Nudge line 0.2s later" position="top">
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, 0.2)}
                aria-label={`Nudge line ${line.id} 0.2s later`}
                className="min-h-[40px] px-3 sm:min-h-[32px] sm:px-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-mono flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <FastForward className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          {/* Structure controls (Insert above/below, Delete) */}
          <div className="flex items-center gap-1">
            <Tooltip content="Insert lyric line above" position="top">
              <button
                type="button"
                onClick={() => onInsertLineAbove(idx)}
                aria-label={`Insert line above line ${line.id}`}
                data-testid={`insert-line-above-${line.id}`}
                className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-accent flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <span className="flex items-center text-xs font-semibold">
                  <Plus className="w-3.5 h-3.5 text-theme-accent" />
                  <span className="text-[10px] text-theme-text-muted ml-0.5 font-mono">↑</span>
                </span>
              </button>
            </Tooltip>
            <Tooltip content="Insert lyric line below" position="top">
              <button
                type="button"
                onClick={() => onInsertLineBelow(idx)}
                aria-label={`Insert line below line ${line.id}`}
                data-testid={`insert-line-below-${line.id}`}
                className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-accent flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent"
              >
                <span className="flex items-center text-xs font-semibold">
                  <Plus className="w-3.5 h-3.5 text-theme-accent" />
                  <span className="text-[10px] text-theme-text-muted ml-0.5 font-mono">↓</span>
                </span>
              </button>
            </Tooltip>
            <Tooltip content="Delete lyric line from timeline" position="top">
              <button
                type="button"
                onClick={() => onDeleteLine(line)}
                aria-label={`Delete line ${line.id}`}
                data-testid={`delete-line-${line.id}`}
                className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-rose-950/40 border border-theme-border-subtle hover:border-theme-secondary text-theme-text-muted hover:text-rose-400 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-secondary"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>

            {/* Expand / Collapse */}
            <button
              type="button"
              onClick={() => onToggleExpand(line.id)}
              aria-label={
                isExpanded
                  ? `Collapse word timings for line ${line.id}`
                  : `Expand word timings for line ${line.id}`
              }
              aria-expanded={isExpanded}
              className="min-h-[40px] px-3 sm:min-h-[32px] sm:px-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text text-xs flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-theme-accent ml-1"
              title="Expand word timings"
            >
              <ChevronRight
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>

      {/* Word-by-Word Timeline Stream */}
      {line.words && line.words.length > 0 && (
        <div
          data-testid={`timeline-words-line-${line.id}`}
          className="mt-2 pt-1.5 border-t border-theme-border-subtle flex flex-wrap gap-1.5 items-center"
        >
          {line.words.map((w, wIdx) => {
            const isWordActive =
              activeWordLoc?.lineId === line.id && activeWordLoc?.wordIndex === wIdx;

            return (
              <button
                key={wIdx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onWordClick(w);
                }}
                data-active-word={isWordActive ? 'true' : undefined}
                data-testid={
                  isWordActive ? 'active-timeline-word' : `timeline-word-${line.id}-${wIdx}`
                }
                aria-current={isWordActive ? 'true' : undefined}
                aria-label={`Jump to word ${w.word} in timeline at ${formatLineTime(w.start_time)}s`}
                className={`min-h-[34px] px-2.5 py-1 text-xs inline-flex items-center rounded-theme-sm font-medium transition-all cursor-pointer font-theme-body ${
                  isWordActive
                    ? 'bg-theme-accent/30 text-theme-accent font-bold ring-1 ring-theme-accent shadow-theme-sm scale-105'
                    : 'bg-theme-surface text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-subtle border border-theme-border-subtle'
                }`}
                title={`Seek to "${w.word}" (${formatLineTime(w.start_time)}s)`}
              >
                {w.word}
              </button>
            );
          })}
        </div>
      )}

      {/* Expanded Word-Level Timing Inputs (Feature 44: Word Steppers & Whole-Word Shift) */}
      {isExpanded && (
        <ExpandedWordEditor
          line={line}
          activeWordLoc={activeWordLoc}
          currentTime={currentTime}
          onWordClick={onWordClick}
          onNudgeWord={onNudgeWord}
          onNudgeWordBoundary={onNudgeWordBoundary}
          onUpdateWordTiming={onUpdateWordTiming}
        />
      )}
    </div>
  );
};
