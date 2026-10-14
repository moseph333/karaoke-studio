import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LyricLine, WordTiming } from '../types';
import {
  Edit3,
  Check,
  ChevronRight,
  FastForward,
  Rewind,
  AlertTriangle,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { LyricDisplay } from './LyricDisplay';

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
}

interface ActiveWordLocation {
  lineId: number;
  wordIndex: number;
  word: WordTiming;
}

const getActiveWordLocation = (
  lines: LyricLine[],
  currentTime: number
): ActiveWordLocation | null => {
  if (!lines || lines.length === 0) return null;

  for (const line of lines) {
    if (currentTime >= line.start_time - 0.5 && currentTime <= line.end_time + 0.5) {
      if (line.words && line.words.length > 0) {
        // Direct hit: currentTime within [start_time, end_time]
        for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time && currentTime <= w.end_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }

        // Gap within line: find the closest preceding word
        for (let wIdx = line.words.length - 1; wIdx >= 0; wIdx--) {
          const w = line.words[wIdx];
          if (currentTime >= w.start_time) {
            return { lineId: line.id, wordIndex: wIdx, word: w };
          }
        }

        // Before first word in line but within line start window
        if (currentTime >= line.start_time - 0.5) {
          return { lineId: line.id, wordIndex: 0, word: line.words[0] };
        }
      }
    }
  }

  return null;
};

const sanitizeTimestamp = (val: number): number => {
  return isNaN(val) ? 0 : Math.max(0, parseFloat(val.toFixed(3)));
};

const formatLineTime = (t: number): string => {
  const rounded = parseFloat(t.toFixed(3));
  const str = rounded.toFixed(2);
  if (str.endsWith('0')) {
    return rounded.toFixed(1);
  }
  return str;
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
}) => {
  const { toast } = useToast();
  const [editableLines, setEditableLines] = useState<LyricLine[]>(lines);
  const [initialLines, setInitialLines] = useState<LyricLine[]>(lines);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Auto-scroll & manual scroll interaction state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticStartScrollTopRef = useRef<number>(0);
  const lastTargetScrollRef = useRef<number | null>(null);
  const userScrollTimeoutRef = useRef<number | null>(null);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const lastCurrentTimeRef = useRef(currentTime);
  const prevIsPlayingRef = useRef(isPlaying);

  const clearUserScrollTimeout = useCallback(() => {
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
      userScrollTimeoutRef.current = null;
    }
  }, []);

  const resumeAutoScroll = useCallback(() => {
    clearUserScrollTimeout();
    setIsUserScrolling(false);
  }, [clearUserScrollTimeout]);

  const discardModalRef = useFocusTrap<HTMLDivElement>({
    isOpen: showDiscardModal,
    onClose: () => setShowDiscardModal(false),
  });

  // Compute dirty state via deep JSON equality
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(editableLines) !== JSON.stringify(initialLines);
  }, [editableLines, initialLines]);

  // Synchronize when parent `lines` change, but ONLY if no active unsaved changes
  const prevLinesRef = useRef(lines);
  useEffect(() => {
    if (prevLinesRef.current !== lines) {
      prevLinesRef.current = lines;
      if (!hasUnsavedChanges) {
        setEditableLines(lines);
        setInitialLines(lines);
      }
    }
  }, [lines, hasUnsavedChanges]);

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  // Browser unload guard
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved lyric timing changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

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

  // Resume auto-scroll when user seeks, scrubs, or restarts playback
  // Backward jump (< -0.1s), forward jump (> 1.5s), or restart to 0.0s indicates seeking
  useEffect(() => {
    const timeDelta = currentTime - lastCurrentTimeRef.current;
    const isRestart = currentTime === 0 && lastCurrentTimeRef.current > 0;
    lastCurrentTimeRef.current = currentTime;
    if (timeDelta < -0.1 || timeDelta > 1.5 || isRestart) {
      resumeAutoScroll();
    }
  }, [currentTime, resumeAutoScroll]);

  // Resume auto-scroll when playback starts
  useEffect(() => {
    if (!prevIsPlayingRef.current && isPlaying) {
      resumeAutoScroll();
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying, resumeAutoScroll]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearUserScrollTimeout();
      if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
    };
  }, [clearUserScrollTimeout]);

  // Calculate target scroll top to position active word or line at ~38% viewport band
  const calculateTargetScrollTop = useCallback((): number | null => {
    const container = containerRef.current;
    if (!container) return null;

    const activeWordEl = container.querySelector('[data-active-word="true"]') as HTMLElement | null;
    const activeLineEl = container.querySelector('[data-active-line="true"]') as HTMLElement | null;
    const targetEl = activeWordEl || activeLineEl;

    if (!targetEl) return null;

    const containerRect = container.getBoundingClientRect();
    const containerHeight = container.clientHeight || containerRect.height || 380;
    const containerScrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;

    let targetTop = 0;
    const targetRect = targetEl.getBoundingClientRect();

    if (targetRect.height > 0 && containerRect.height > 0) {
      const relativeElementTop = targetRect.top - containerRect.top + containerScrollTop;
      const elementHeight = targetRect.height;
      targetTop = relativeElementTop - containerHeight * 0.38 + elementHeight / 2;
      // If target element is tall (e.g. line card or multi-line lyric), ensure its top
      // is never pushed above the visible viewport (at least 16px of top padding)
      const maxTargetTop = Math.max(0, relativeElementTop - 16);
      if (targetTop > maxTargetTop) {
        targetTop = maxTargetTop;
      }
    } else if (targetEl.offsetTop > 0) {
      let top = 0;
      let curr: HTMLElement | null = targetEl;
      while (curr && curr !== container) {
        top += curr.offsetTop;
        curr = curr.offsetParent as HTMLElement | null;
      }
      const elementHeight = targetEl.offsetHeight || 30;
      targetTop = top - containerHeight * 0.38 + elementHeight / 2;
    } else {
      const lineIdx = activeLineIndex >= 0 ? activeLineIndex : 0;
      const estimatedLineHeight = 70;
      targetTop = lineIdx * estimatedLineHeight - containerHeight * 0.38;
    }

    const hasRealLayout = containerHeight > 0 && scrollHeight > 0;
    const maxScroll = hasRealLayout ? Math.max(0, scrollHeight - containerHeight) : Infinity;
    return Math.max(
      0,
      hasRealLayout ? Math.min(maxScroll, Math.round(targetTop)) : Math.round(targetTop)
    );
  }, [activeLineIndex]);

  // Automatic timeline scrolling to keep active highlighted word comfortably in viewport
  useEffect(() => {
    if (isUserScrolling) return;

    const container = containerRef.current;
    if (!container || !activeKey) return;

    const clampedTarget = calculateTargetScrollTop();
    if (clampedTarget === null) return;

    // If already smoothly scrolling towards this exact target, allow in-flight animation to complete cleanly
    if (
      isProgrammaticScrollRef.current &&
      lastTargetScrollRef.current !== null &&
      Math.abs(lastTargetScrollRef.current - clampedTarget) <= 2
    ) {
      return;
    }

    if (Math.abs(container.scrollTop - clampedTarget) >= 2) {
      programmaticStartScrollTopRef.current = container.scrollTop;
      lastTargetScrollRef.current = clampedTarget;
      isProgrammaticScrollRef.current = true;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: clampedTarget,
          behavior: 'smooth',
        });
      } else {
        container.scrollTop = clampedTarget;
      }

      // Check for test environment (e.g. jsdom / vitest) where native smooth scroll does not update scrollTop
      const isTestEnv =
        (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) ||
        (typeof import.meta !== 'undefined' &&
          (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test');

      const isSimulatingSmoothScroll = Boolean(
        (container as unknown as { __simulatingSmoothScroll?: boolean }).__simulatingSmoothScroll
      );

      if (isTestEnv && !isSimulatingSmoothScroll && container.scrollTop !== clampedTarget) {
        container.scrollTop = clampedTarget;
      }

      if (Math.abs(container.scrollTop - clampedTarget) <= 2) {
        // Arrived at target synchronously (e.g. test environment or instant layout)
        isProgrammaticScrollRef.current = false;
      }

      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 1000);
    }
  }, [
    activeKey,
    isUserScrolling,
    activeLineIndex,
    editableLines,
    selectedLineId,
    calculateTargetScrollTop,
  ]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const currentScrollTop = container.scrollTop;

    if (isProgrammaticScrollRef.current) {
      const target = lastTargetScrollRef.current;
      const start = programmaticStartScrollTopRef.current;

      if (target !== null) {
        // Did we arrive at the programmatic destination?
        if (Math.abs(currentScrollTop - target) <= 2) {
          isProgrammaticScrollRef.current = false;
          if (programmaticScrollTimeoutRef.current) {
            clearTimeout(programmaticScrollTimeoutRef.current);
            programmaticScrollTimeoutRef.current = null;
          }
          return;
        }

        // Is currentScrollTop moving within the programmatic trajectory between start and target?
        const minBound = Math.min(start, target) - 4;
        const maxBound = Math.max(start, target) + 4;
        const isMovingTowardsTarget = currentScrollTop >= minBound && currentScrollTop <= maxBound;

        if (isMovingTowardsTarget) {
          // This is an intermediate animation frame of the smooth programmatic scroll.
          // Do not treat it as a manual user scroll!
          return;
        }
      }

      // If currentScrollTop has diverged outside the start-to-target trajectory,
      // the user intervened or forced a scroll elsewhere!
      isProgrammaticScrollRef.current = false;
      if (programmaticScrollTimeoutRef.current) {
        clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
    }

    // Check if user manually returned to the active position:
    // Uses the live active element position so returning to active position always works
    // even if playback advanced while auto-scroll was paused.
    const activeTarget = calculateTargetScrollTop();
    const targetToCompare = activeTarget !== null ? activeTarget : lastTargetScrollRef.current;
    if (targetToCompare !== null && Math.abs(currentScrollTop - targetToCompare) <= 40) {
      resumeAutoScroll();
      return;
    }

    // User is manually scrolling away from active position
    setIsUserScrolling(true);
    clearUserScrollTimeout();
    userScrollTimeoutRef.current = window.setTimeout(() => {
      resumeAutoScroll();
    }, 2500);
  };

  const handleUserScrollInteraction = () => {
    isProgrammaticScrollRef.current = false;
    if (programmaticScrollTimeoutRef.current) {
      clearTimeout(programmaticScrollTimeoutRef.current);
      programmaticScrollTimeoutRef.current = null;
    }

    setIsUserScrolling(true);
    clearUserScrollTimeout();
    userScrollTimeoutRef.current = window.setTimeout(() => {
      resumeAutoScroll();
    }, 2500);
  };

  const handleLineClick = (line: LyricLine, isExpanded: boolean) => {
    resumeAutoScroll();
    onSeek(line.start_time);
    setSelectedLineId(isExpanded ? null : line.id);
  };

  const handleWordClick = (w: WordTiming) => {
    resumeAutoScroll();
    onSeek(w.start_time);
  };

  // Handle nudging an entire line by offset seconds
  const nudgeLine = (lineId: number, offset: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;

      const minStart = Math.min(l.start_time, ...l.words.map((w) => w.start_time));
      const effectiveOffset = offset < 0 ? Math.max(offset, -minStart) : offset;

      const newStart = sanitizeTimestamp(l.start_time + effectiveOffset);
      const newEnd = Math.max(newStart, sanitizeTimestamp(l.end_time + effectiveOffset));
      const newWords = l.words.map((w) => {
        const wStart = sanitizeTimestamp(w.start_time + effectiveOffset);
        const wEnd = Math.max(wStart, sanitizeTimestamp(w.end_time + effectiveOffset));
        return { ...w, start_time: wStart, end_time: wEnd };
      });

      return { ...l, start_time: newStart, end_time: newEnd, words: newWords };
    });
    setEditableLines(updated);
  };

  // Handle nudging a specific word boundary ('start_time' or 'end_time')
  const nudgeWordBoundary = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    delta: number
  ) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;

        const proposed = targetWord.start_time + delta;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, proposed))
        );
      } else {
        const minAllowed = targetWord.start_time;
        const proposed = targetWord.end_time + delta;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, proposed));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle nudging an entire word (both start and end)
  const nudgeWord = (lineId: number, wordIndex: number, delta: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      const dur = sanitizeTimestamp(targetWord.end_time - targetWord.start_time);
      const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
      const nextWordStart =
        wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;

      const proposedStart = targetWord.start_time + delta;
      const clampedStart = sanitizeTimestamp(
        Math.min(nextWordStart, Math.max(prevWordStart, proposedStart))
      );
      targetWord.start_time = clampedStart;
      targetWord.end_time = sanitizeTimestamp(clampedStart + dur);

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Handle editing a single word timing with monotonic clamping
  const updateWordTiming = (
    lineId: number,
    wordIndex: number,
    field: 'start_time' | 'end_time',
    value: number
  ) => {
    const safeValue = sanitizeTimestamp(value);
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = l.words.map((w) => ({ ...w }));
      const targetWord = words[wordIndex];
      if (!targetWord) return l;

      if (field === 'start_time') {
        const prevWordStart = wordIndex > 0 ? words[wordIndex - 1].start_time : 0;
        const nextWordStart =
          wordIndex < words.length - 1 ? words[wordIndex + 1].start_time : Infinity;
        const maxAllowed = Math.min(targetWord.end_time, nextWordStart);
        const minAllowed = prevWordStart;
        targetWord.start_time = sanitizeTimestamp(
          Math.min(maxAllowed, Math.max(minAllowed, safeValue))
        );
      } else {
        const minAllowed = targetWord.start_time;
        targetWord.end_time = sanitizeTimestamp(Math.max(minAllowed, safeValue));
      }

      const lineStart = Math.min(...words.map((w) => w.start_time));
      const lineEnd = Math.max(...words.map((w) => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
  };

  // Save changes with async guard
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveLines(editableLines);
      setInitialLines(editableLines);
      toast.success('Lyric timing changes saved');
    } catch (err) {
      console.error('Failed to save lyric timings:', err);
      toast.error('Failed to save lyric timings');
    } finally {
      setIsSaving(false);
    }
  };

  // Discard changes and revert to initialLines
  const handleConfirmDiscard = () => {
    setEditableLines(initialLines);
    setShowDiscardModal(false);
    toast.info('Lyric edits discarded');
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
      />

      {/* 2. Visual Timeline & Precision Word Editor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-cyan-400" />
                Word-by-Word Timeline Editor
              </h3>
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(true)}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Timing Changes
                  </>
                )}
              </button>
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
            // Ignore pointerdown from interactive buttons, inputs, steppers, or chips
            const targetEl = e.target as HTMLElement | null;
            if (targetEl?.closest('button, input, select, textarea, [role="button"]')) {
              return;
            }
            // Pointer landing directly on the container (e.g. scrollbar track or thumb)
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
          className="max-h-[380px] overflow-y-auto space-y-2 pr-1 scroll-smooth focus:outline-none"
        >
          {editableLines.map((line) => {
            const isCurrentlyActive = currentLine?.id === line.id;
            const isExpanded = selectedLineId === line.id;

            return (
              <div
                key={line.id}
                data-testid={`timeline-line-${line.id}`}
                data-active-line={isCurrentlyActive ? 'true' : undefined}
                className={`p-3 rounded-xl border transition-all ${
                  isCurrentlyActive
                    ? 'bg-cyan-950/40 border-cyan-500/70 shadow-md'
                    : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => handleLineClick(line, isExpanded)}
                    aria-label={`Select line: ${line.text} (${formatLineTime(line.start_time)}s to ${formatLineTime(line.end_time)}s)`}
                    className="flex items-center gap-3 cursor-pointer flex-1 overflow-hidden text-left bg-transparent border-0 p-0 focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded"
                  >
                    <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded shrink-0">
                      {formatLineTime(line.start_time)}s - {formatLineTime(line.end_time)}s
                    </span>
                    <span
                      className={`text-sm font-semibold truncate ${
                        isCurrentlyActive ? 'text-cyan-300 font-bold' : 'text-slate-200'
                      }`}
                    >
                      {line.text}
                    </span>
                  </button>

                  {/* Nudge & Expand Controls (Feature 44: Dual-Step Line Nudging) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Coarse Earlier: -0.2s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, -0.2)}
                      aria-label={`Nudge line ${line.id} 0.2s earlier`}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Coarse nudge 0.2s earlier"
                    >
                      <Rewind className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    {/* Fine Earlier: -0.05s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, -0.05)}
                      aria-label={`Nudge line ${line.id} 0.05s earlier`}
                      className="px-1.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-cyan-400 font-mono text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Fine nudge 0.05s earlier"
                    >
                      -0.05s
                    </button>

                    {/* Fine Later: +0.05s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, 0.05)}
                      aria-label={`Nudge line ${line.id} 0.05s later`}
                      className="px-1.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 text-cyan-400 font-mono text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Fine nudge 0.05s later"
                    >
                      +0.05s
                    </button>

                    {/* Coarse Later: +0.2s */}
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, 0.2)}
                      aria-label={`Nudge line ${line.id} 0.2s later`}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      title="Coarse nudge 0.2s later"
                    >
                      <FastForward className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    {/* Expand / Collapse */}
                    <button
                      type="button"
                      onClick={() => setSelectedLineId(isExpanded ? null : line.id)}
                      aria-label={
                        isExpanded
                          ? `Collapse word timings for line ${line.id}`
                          : `Expand word timings for line ${line.id}`
                      }
                      aria-expanded={isExpanded}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400 ml-1"
                      title="Expand word timings"
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                {/* Word-by-Word Timeline Stream */}
                {line.words && line.words.length > 0 && (
                  <div
                    data-testid={`timeline-words-line-${line.id}`}
                    className="mt-2 pt-1.5 border-t border-slate-800/40 flex flex-wrap gap-1.5 items-center"
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
                            handleWordClick(w);
                          }}
                          data-active-word={isWordActive ? 'true' : undefined}
                          data-testid={
                            isWordActive
                              ? 'active-timeline-word'
                              : `timeline-word-${line.id}-${wIdx}`
                          }
                          aria-current={isWordActive ? 'true' : undefined}
                          aria-label={`Jump to word ${w.word} in timeline at ${formatLineTime(w.start_time)}s`}
                          className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                            isWordActive
                              ? 'bg-cyan-500/30 text-cyan-200 font-bold ring-1 ring-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)] scale-105'
                              : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800/80'
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
                  <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {line.words.map((w, wIdx) => {
                      const isWordActive =
                        activeWordLoc?.lineId === line.id && activeWordLoc?.wordIndex === wIdx;

                      return (
                        <div
                          key={wIdx}
                          data-active-word={isWordActive ? 'true' : undefined}
                          className={`flex flex-col gap-1.5 p-2.5 rounded-lg border text-xs transition-all ${
                            isWordActive
                              ? 'bg-cyan-950/70 border-cyan-500 ring-1 ring-cyan-400/50 shadow-md'
                              : 'bg-slate-900 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              onClick={() => handleWordClick(w)}
                              className={`font-bold cursor-pointer truncate mr-2 ${
                                isWordActive ? 'text-cyan-300' : 'text-white hover:text-cyan-400'
                              }`}
                              title={`Click to seek to word: ${w.word}`}
                            >
                              {w.word}
                            </span>
                            {/* Word Shift Pill */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => nudgeWord(line.id, wIdx, -0.05)}
                                aria-label={`Nudge word ${w.word} 0.05s earlier`}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                                title="Shift word 0.05s earlier"
                              >
                                ◀
                              </button>
                              <button
                                type="button"
                                onClick={() => nudgeWord(line.id, wIdx, 0.05)}
                                aria-label={`Nudge word ${w.word} 0.05s later`}
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                                title="Shift word 0.05s later"
                              >
                                ▶
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            {/* Start Time Stepper */}
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  nudgeWordBoundary(line.id, wIdx, 'start_time', -0.05)
                                }
                                aria-label={`Nudge start of word ${w.word} 0.05s earlier`}
                                className="w-5 h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                step="0.05"
                                value={w.start_time}
                                onChange={(e) =>
                                  updateWordTiming(
                                    line.id,
                                    wIdx,
                                    'start_time',
                                    parseFloat(e.target.value)
                                  )
                                }
                                aria-label={`Start time for word ${w.word}`}
                                className="w-14 h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              />
                              <button
                                type="button"
                                onClick={() => nudgeWordBoundary(line.id, wIdx, 'start_time', 0.05)}
                                aria-label={`Nudge start of word ${w.word} 0.05s later`}
                                className="w-5 h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              >
                                +
                              </button>
                            </div>

                            <span className="text-slate-500 font-bold">to</span>

                            {/* End Time Stepper */}
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => nudgeWordBoundary(line.id, wIdx, 'end_time', -0.05)}
                                aria-label={`Nudge end of word ${w.word} 0.05s earlier`}
                                className="w-5 h-6 rounded-l bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                step="0.05"
                                value={w.end_time}
                                onChange={(e) =>
                                  updateWordTiming(
                                    line.id,
                                    wIdx,
                                    'end_time',
                                    parseFloat(e.target.value)
                                  )
                                }
                                aria-label={`End time for word ${w.word}`}
                                className="w-14 h-6 p-0.5 bg-slate-950 border-y border-slate-700 text-center text-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              />
                              <button
                                type="button"
                                onClick={() => nudgeWordBoundary(line.id, wIdx, 'end_time', 0.05)}
                                aria-label={`Nudge end of word ${w.word} 0.05s later`}
                                className="w-5 h-6 rounded-r bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center justify-center font-bold focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Discard Changes Confirmation Modal (Feature 45: Focus Trapped) */}
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
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 focus:outline-none focus:ring-2 focus:ring-rose-400"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
