/**
 * Timeline Line Card Component
 *
 * One lyric line in the timeline: duet part chip, confidence dot, time range and text (click
 * to seek, double-click to edit), line nudges, insert/delete, a More menu (with "Re-align
 * this line") and the expandable word timing editor. Secondary controls fade on hover-capable screens until the row is
 * hovered, focused, active or expanded; touch screens always show them at full strength.
 */

import React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FastForward,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Rewind,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { LyricLine, SingerRole, WordTiming } from '../../types';
import { formatLineTime } from '../../utils/lyrics';
import type { LineIssue } from '../../utils/timelineReview';
import { confidenceLevel, confidenceText, type ConfidenceLevel } from '../../utils/lineRealign';
import { cn } from '../../utils/cn';
import { ExpandedWordEditor, type ActiveWordLocation } from './ExpandedWordEditor';
import { Tooltip } from '../Tooltip';
import { Menu } from '../ui/Menu';
import { focusRing } from '../ui/variants';
import { SINGER_CONFIG, normalizeSingerRole } from '../stage/singers';

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
  /** Assigns a duet part directly (row More menu). */
  onSetSinger?: (lineId: number, singer: SingerRole) => void;
  currentTime?: number;
  /** Live playback clock for snapping word boundaries to the playhead. */
  getCurrentTime?: () => number;
  /** Timing problems found by the review checks. */
  issues?: LineIssue[];
  /** Show the word chips row (the editor shows it for the active and selected lines). */
  showWords?: boolean;
  /** Re-time this line against the vocals (row More menu). */
  onRealignLine?: (lineId: number) => void;
  isRealigning?: boolean;
}

const CONFIDENCE_DOT: Record<ConfidenceLevel, string> = {
  high: 'bg-theme-success',
  medium: 'bg-theme-warning',
  low: 'bg-theme-danger',
};

const NEXT_SINGER: Record<SingerRole, SingerRole> = {
  singer1: 'singer2',
  singer2: 'both',
  both: 'singer1',
};

const SINGER_TONE: Record<SingerRole, string> = {
  singer1: 'border-theme-sung/40 bg-theme-sung/10 hover:bg-theme-sung/20 [&_svg]:text-theme-sung',
  singer2:
    'border-theme-secondary/45 bg-theme-secondary/10 hover:bg-theme-secondary/20 [&_svg]:text-theme-secondary',
  both: 'border-theme-success/40 bg-theme-success/10 hover:bg-theme-success/20 [&_svg]:text-theme-success',
};

// Line controls keep a 44px touch target and tighten on desktop. Class strings are kept
// literal (not merged) so both the touch and compact sizes stay on the element.
const rowControl = cn(
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-sm text-theme-text-muted transition-colors hover:bg-theme-surface-raised hover:text-theme-text md:min-h-[30px] md:min-w-[30px]',
  focusRing
);
const nudgeControl = cn(
  rowControl,
  'px-2 font-mono text-[11px] font-semibold tabular-nums md:px-1.5'
);

export const TimelineLineCard = React.memo(function TimelineLineCard({
  line,
  idx,
  isCurrentlyActive,
  isExpanded,
  editingLineId,
  editingText,
  activeWordLoc,
  currentTime,
  getCurrentTime,
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
  onSetSinger,
  issues,
  showWords = true,
  onRealignLine,
  isRealigning = false,
}: TimelineLineCardProps) {
  const singerRole = normalizeSingerRole(line.singer);
  const singer = SINGER_CONFIG[singerRole];
  const nextSinger = SINGER_CONFIG[NEXT_SINGER[singerRole]];
  const SingerIcon = singer.Icon;
  const timeRange = `${formatLineTime(line.start_time)}s - ${formatLineTime(line.end_time)}s`;
  const isEditing = editingLineId === line.id;
  const emphasized = isCurrentlyActive || isExpanded;
  // Fade secondary controls only where hover exists; hover/focus inside the row restores them.
  const calm = emphasized
    ? ''
    : 'transition-opacity [@media(hover:hover)]:opacity-60 group-hover/line:opacity-100 group-focus-within/line:opacity-100';
  const issueMessages = issues && issues.length > 0 ? issues.map((i) => i.message) : null;
  const confidence = confidenceLevel(line.confidence);

  return (
    <div
      data-testid={`timeline-line-${line.id}`}
      data-active-line={isCurrentlyActive ? 'true' : undefined}
      data-singer={singerRole}
      data-needs-review={issueMessages ? 'true' : undefined}
      data-realigning={isRealigning ? 'true' : undefined}
      className={cn(
        'group/line relative rounded-theme-lg border px-2 py-1.5 transition-colors sm:px-2.5',
        isCurrentlyActive
          ? 'border-theme-accent/45 bg-theme-accent/[0.08] shadow-theme-sm before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-accent'
          : isExpanded
            ? 'border-theme-border-subtle bg-theme-surface-subtle'
            : 'border-transparent bg-theme-surface-subtle/50 hover:border-theme-border-subtle hover:bg-theme-surface-subtle'
      )}
    >
      <div className="flex flex-col gap-1.5 @[720px]:flex-row @[720px]:items-center @[720px]:gap-2">
        {isEditing ? (
          <div className="flex min-h-[44px] w-full items-center gap-1.5 overflow-hidden @[720px]:flex-1">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-theme-text-muted">
              {timeRange}
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
              className="min-h-[44px] min-w-0 flex-1 rounded-theme-md border border-theme-accent bg-theme-bg px-2.5 py-1.5 text-base font-semibold text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-focus sm:text-sm md:min-h-[36px]"
            />
            <button
              type="button"
              onClick={() => onCommitEditing(line.id, editingText)}
              aria-label={`Commit edit for line ${line.id}`}
              data-testid={`commit-edit-${line.id}`}
              className={cn(
                'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-md bg-theme-success/15 text-theme-success transition-colors hover:bg-theme-success/25 md:min-h-[36px] md:min-w-[36px]',
                focusRing
              )}
              title="Commit edit (Enter)"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
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
              className={cn(
                'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-md text-theme-text-muted transition-colors hover:bg-theme-surface-raised hover:text-theme-text md:min-h-[36px] md:min-w-[36px]',
                focusRing
              )}
              title="Cancel edit (Escape)"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-1.5 @[720px]:flex-1">
            <Tooltip
              content={`Current part: ${singer.label}. Click to cycle role`}
              position="top"
              portal
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleSinger?.(line.id);
                }}
                aria-label={`Singer: ${singer.label}. Click to cycle to ${nextSinger.label}`}
                data-testid={`toggle-singer-${line.id}`}
                data-singer={singerRole}
                className={cn(
                  'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-theme-md border px-1.5 font-mono text-[11px] font-bold text-theme-text transition-colors md:min-h-[30px] md:min-w-[44px]',
                  SINGER_TONE[singerRole],
                  focusRing
                )}
              >
                <SingerIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{singer.short}</span>
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => onLineClick(line, isExpanded)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEditing(line);
              }}
              aria-label={`Jump to line / Select line: ${line.text} (${formatLineTime(line.start_time)}s to ${formatLineTime(line.end_time)}s)`}
              className={cn(
                // Narrow cards stack the time above the lyric so the text keeps the full width
                'flex min-h-[44px] min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0 overflow-hidden rounded-theme-sm border-0 bg-transparent px-1 py-0.5 text-left @[480px]:flex-row @[480px]:items-center @[480px]:justify-start @[480px]:gap-2.5 md:min-h-[30px]',
                focusRing
              )}
            >
              <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums text-theme-text-muted">
                {confidence && (
                  <span
                    aria-hidden="true"
                    title={confidenceText(line) ?? undefined}
                    data-testid={`line-confidence-${line.id}`}
                    data-level={confidence}
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', CONFIDENCE_DOT[confidence])}
                  />
                )}
                {timeRange}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-theme-body text-sm',
                  isCurrentlyActive ? 'font-bold text-theme-text' : 'font-medium text-theme-text/90'
                )}
              >
                {line.text}
              </span>
            </button>
            {issueMessages && (
              <span
                role="img"
                data-testid={`line-review-${line.id}`}
                aria-label={`Needs review: ${issueMessages.join('; ')}`}
                title={issueMessages.join('\n')}
                className="flex h-6 w-6 shrink-0 items-center justify-center text-theme-warning"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
            <Tooltip content="Edit lyric text inline" position="top" portal>
              <button
                type="button"
                onClick={() => onStartEditing(line)}
                aria-label={`Edit text for line ${line.id}`}
                data-testid={`edit-line-text-${line.id}`}
                className={cn(rowControl, 'shrink-0', calm)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 @[720px]:flex-nowrap @[720px]:justify-end">
          <div
            className={cn(
              'flex items-center gap-px rounded-theme-md border border-theme-border-subtle bg-theme-surface p-0.5',
              calm
            )}
          >
            <Tooltip content="Nudge line 0.2s earlier" position="top" portal>
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, -0.2)}
                aria-label={`Nudge line ${line.id} 0.2s earlier`}
                className={nudgeControl}
              >
                <Rewind className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="Fine-nudge line 0.05s earlier" position="top" portal>
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, -0.05)}
                aria-label={`Nudge line ${line.id} 0.05s earlier`}
                className={nudgeControl}
              >
                -0.05s
              </button>
            </Tooltip>
            <Tooltip content="Fine-nudge line 0.05s later" position="top" portal>
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, 0.05)}
                aria-label={`Nudge line ${line.id} 0.05s later`}
                className={nudgeControl}
              >
                +0.05s
              </button>
            </Tooltip>
            <Tooltip content="Nudge line 0.2s later" position="top" portal>
              <button
                type="button"
                onClick={() => onNudgeLine(line.id, 0.2)}
                aria-label={`Nudge line ${line.id} 0.2s later`}
                className={nudgeControl}
              >
                <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-px">
            {/* Narrow cards reach insert/delete through the More menu instead */}
            <div className={cn('hidden items-center gap-px @[480px]:flex', calm)}>
              <Tooltip content="Insert lyric line above" position="top" portal>
                <button
                  type="button"
                  onClick={() => onInsertLineAbove(idx)}
                  aria-label={`Insert line above line ${line.id}`}
                  data-testid={`insert-line-above-${line.id}`}
                  className={rowControl}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-hidden="true" className="-ml-0.5 font-mono text-[10px]">
                    ↑
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="Insert lyric line below" position="top" portal>
                <button
                  type="button"
                  onClick={() => onInsertLineBelow(idx)}
                  aria-label={`Insert line below line ${line.id}`}
                  data-testid={`insert-line-below-${line.id}`}
                  className={rowControl}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-hidden="true" className="-ml-0.5 font-mono text-[10px]">
                    ↓
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="Delete lyric line from timeline" position="top" portal>
                <button
                  type="button"
                  onClick={() => onDeleteLine(line)}
                  aria-label={`Delete line ${line.id}`}
                  data-testid={`delete-line-${line.id}`}
                  className={cn(rowControl, 'hover:bg-theme-danger/10 hover:text-theme-danger')}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>

            <Menu
              label={`Line ${line.id} actions`}
              portal
              side="auto"
              trigger={(triggerProps) => (
                <button
                  {...triggerProps}
                  type="button"
                  aria-label={`More actions for line ${line.id}`}
                  data-testid={`line-more-${line.id}`}
                  className={cn(rowControl, calm)}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              items={[
                {
                  id: 'insert-above',
                  group: 'Line',
                  label: 'Insert line above',
                  icon: <Plus className="h-4 w-4" />,
                  onSelect: () => onInsertLineAbove(idx),
                },
                {
                  id: 'insert-below',
                  group: 'Line',
                  label: 'Insert line below',
                  icon: <Plus className="h-4 w-4" />,
                  onSelect: () => onInsertLineBelow(idx),
                },
                {
                  id: 'delete',
                  group: 'Line',
                  label: 'Delete line',
                  tone: 'danger',
                  icon: <Trash2 className="h-4 w-4" />,
                  onSelect: () => onDeleteLine(line),
                },
                ...(onRealignLine
                  ? [
                      {
                        id: 'realign',
                        group: 'Timing',
                        label: isRealigning ? 'Re-aligning…' : 'Re-align this line',
                        icon: isRealigning ? (
                          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                        ) : (
                          <WandSparkles className="h-4 w-4" />
                        ),
                        disabled: isRealigning,
                        testId: `line-${line.id}-realign`,
                        onSelect: () => onRealignLine(line.id),
                      },
                    ]
                  : []),
                ...(onSetSinger
                  ? (Object.keys(SINGER_CONFIG) as SingerRole[]).map((role) => {
                      const RoleIcon = SINGER_CONFIG[role].Icon;
                      return {
                        id: role,
                        group: 'Assign singer',
                        label: SINGER_CONFIG[role].label,
                        icon: <RoleIcon className="h-4 w-4" />,
                        checked: role === singerRole,
                        testId: `line-${line.id}-assign-${role}`,
                        onSelect: () => {
                          if (role !== singerRole) onSetSinger(line.id, role);
                        },
                      };
                    })
                  : []),
              ]}
            />

            <button
              type="button"
              onClick={() => onToggleExpand(line.id)}
              aria-label={
                isExpanded
                  ? `Collapse word timings for line ${line.id}`
                  : `Expand word timings for line ${line.id}`
              }
              aria-expanded={isExpanded}
              className={cn(rowControl, isExpanded && 'text-theme-highlight')}
              title="Expand word timings"
            >
              <ChevronRight
                className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>

      {showWords && line.words && line.words.length > 0 && (
        <div
          data-testid={`timeline-words-line-${line.id}`}
          className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-theme-border-subtle/70 pt-1.5"
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
                className={cn(
                  'inline-flex min-h-[34px] cursor-pointer items-center rounded-theme-sm px-2.5 py-1 font-theme-body text-xs transition-colors md:min-h-[28px]',
                  isWordActive
                    ? 'bg-theme-accent/20 font-bold text-theme-highlight ring-1 ring-theme-accent/60'
                    : 'border border-theme-border-subtle bg-theme-surface font-medium text-theme-text-muted hover:bg-theme-surface-raised hover:text-theme-text',
                  focusRing
                )}
                title={`Seek to "${w.word}" (${formatLineTime(w.start_time)}s)`}
              >
                {w.word}
              </button>
            );
          })}
        </div>
      )}

      {isExpanded && (
        <ExpandedWordEditor
          line={line}
          activeWordLoc={activeWordLoc}
          currentTime={currentTime}
          getCurrentTime={getCurrentTime}
          onWordClick={onWordClick}
          onNudgeWord={onNudgeWord}
          onNudgeWordBoundary={onNudgeWordBoundary}
          onUpdateWordTiming={onUpdateWordTiming}
        />
      )}
    </div>
  );
});
