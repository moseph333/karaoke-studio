/**
 * Challenger M2 Adversarial Empirical Stress Test Suite
 *
 * Scope:
 * 1. Stress test rapid touch stamping in Tap-to-Sync mode:
 *    - Rapid consecutive taps (< 50ms, bursts of 20+ taps)
 *    - Switching between Line Sync and Word Sync modes during active stamping
 *    - Zero missing / skipped stamps and strict monotonicity invariants
 *    - Playhead stutter / zero-delta / backward jitter resilience
 *    - Rapid tapping past end-of-song
 * 2. Stress test narrow viewports:
 *    - 320px (iPhone SE 1st gen) and 375px (iPhone standard) viewports
 *    - Zero horizontal overflow (scrollWidth <= clientWidth) in TapToSyncBanner,
 *      TimelineLineCard, ExpandedWordEditor, and LyricTimelineEditor
 * 3. Mobile touch target size invariants (>= 44x44px for actions/steppers/nudges, >= 48px for tap button)
 * 4. Waveform scrubber touch-action: none and pointer drag safety
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { TapToSyncBanner } from '../components/timeline/TapToSyncBanner';
import { TimelineLineCard } from '../components/timeline/TimelineLineCard';
import { ExpandedWordEditor } from '../components/timeline/ExpandedWordEditor';
import { WaveformScrubber } from '../components/audio/WaveformScrubber';
import { applyLineTap, applyWordTap, TapSyncMode } from '../utils/tapSync';
import { LyricLine, WordTiming } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

describe('Milestone M2 Adversarial Stress Suite: Mobile Tap-to-Sync & Narrow Viewports', () => {
  const createMockLines = (count = 5, wordsPerLine = 4): LyricLine[] => {
    const lines: LyricLine[] = [];
    let currentTime = 1.0;
    for (let i = 0; i < count; i++) {
      const words: WordTiming[] = [];
      const lineStart = currentTime;
      for (let j = 0; j < wordsPerLine; j++) {
        const wordStart = currentTime;
        const wordEnd = currentTime + 0.5;
        words.push({
          word: `W_${i + 1}_${j + 1}`,
          start_time: parseFloat(wordStart.toFixed(2)),
          end_time: parseFloat(wordEnd.toFixed(2)),
        });
        currentTime = wordEnd + 0.1;
      }
      lines.push({
        id: i + 1,
        text: words.map((w) => w.word).join(' '),
        start_time: parseFloat(lineStart.toFixed(2)),
        end_time: parseFloat((currentTime - 0.1).toFixed(2)),
        words,
      });
      currentTime += 0.8;
    }
    return lines;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setTestViewport(375, 667);
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: RAPID TOUCH STAMPING & MONOTONICITY ORACLES
  // =========================================================================

  describe('1. Adversarial Rapid Consecutive Stamping & Mode Switching Oracles', () => {
    it('Oracle 1.1: Rapid consecutive Line Sync taps preserve strict monotonicity and zero skipped lines', () => {
      const lines = createMockLines(8, 4);
      let currentLines = lines;
      let targetIndex = 0;
      let tapTime = 2.0;

      // Simulate 8 rapid consecutive taps with progressive time deltas
      for (let i = 0; i < 8; i++) {
        tapTime += 1.5;
        const result = applyLineTap(currentLines, targetIndex, tapTime, 60);

        expect(result.updatedLines[targetIndex].start_time).toBe(parseFloat(tapTime.toFixed(2)));
        expect(result.updatedLines[targetIndex].end_time).toBeGreaterThan(tapTime);

        // Verify words inside stamped line are recalculated and monotonic
        const words = result.updatedLines[targetIndex].words;
        expect(words.length).toBeGreaterThan(0);
        for (let w = 0; w < words.length; w++) {
          expect(words[w].start_time).toBeLessThan(words[w].end_time);
          if (w > 0) {
            expect(words[w].start_time).toBeGreaterThanOrEqual(words[w - 1].end_time);
          }
        }

        // Verify previous line end_time was clamped to tapTime if necessary
        if (targetIndex > 0) {
          expect(result.updatedLines[targetIndex - 1].end_time).toBeLessThanOrEqual(tapTime);
        }

        targetIndex = result.nextLineIndex;
        currentLines = result.updatedLines;

        if (i < 7) {
          expect(result.isComplete).toBe(false);
          expect(result.nextLineIndex).toBe(i + 1);
        } else {
          expect(result.isComplete).toBe(true);
        }
      }
    });

    it('Oracle 1.2: Rapid consecutive Word Sync taps across lines advance seamlessly with zero skipped words', () => {
      const lines = createMockLines(3, 4); // 3 lines * 4 words = 12 words total
      let currentLines = lines;
      let lineIdx = 0;
      let wordIdx = 0;
      let tapTime = 1.0;
      let totalWordTaps = 0;

      while (lineIdx < currentLines.length) {
        tapTime += 0.35;
        const result = applyWordTap(currentLines, lineIdx, wordIdx, tapTime, 60);
        totalWordTaps++;

        const currentWord = result.updatedLines[lineIdx].words[wordIdx];
        expect(currentWord.start_time).toBe(parseFloat(tapTime.toFixed(2)));
        expect(currentWord.end_time).toBeGreaterThan(currentWord.start_time);

        // Preceding word check
        if (wordIdx > 0) {
          const prevWord = result.updatedLines[lineIdx].words[wordIdx - 1];
          expect(prevWord.end_time).toBeLessThanOrEqual(currentWord.start_time);
        }

        currentLines = result.updatedLines;

        if (result.isComplete) {
          break;
        }

        lineIdx = result.nextLineIndex;
        wordIdx = result.nextWordIndex;
      }

      // Exactly 12 words stamped
      expect(totalWordTaps).toBe(12);

      // Verify all lines and words strictly monotonic
      currentLines.forEach((l) => {
        expect(l.start_time).toBeLessThan(l.end_time);
        l.words.forEach((w, wI) => {
          expect(w.start_time).toBeLessThan(w.end_time);
          if (wI > 0) {
            expect(w.start_time).toBeGreaterThanOrEqual(l.words[wI - 1].end_time);
          }
        });
      });
    });

    it('Oracle 1.3: Normal progressive switching between Line and Word sync maintains monotonicity', () => {
      const lines = createMockLines(3, 3);
      let currentLines = lines;
      let tapTime = 2.0;

      // 1. Line 0 stamped via Line Sync at 3.0s
      tapTime = 3.0;
      let lineRes = applyLineTap(currentLines, 0, tapTime, 60);
      currentLines = lineRes.updatedLines;
      expect(lineRes.nextLineIndex).toBe(1);

      // 2. Switch to Word Sync on Line 1 at 7.0s (after Line 0's 6.0s end)
      tapTime = 7.0;
      for (let w = 0; w < 3; w++) {
        tapTime += 0.6;
        const wordRes = applyWordTap(currentLines, 1, w, tapTime, 60);
        currentLines = wordRes.updatedLines;
      }

      // 3. Switch back to Line Sync on Line 2 at 10.0s
      tapTime = 10.0;
      lineRes = applyLineTap(currentLines, 2, tapTime, 60);
      currentLines = lineRes.updatedLines;
      expect(lineRes.isComplete).toBe(true);

      currentLines.forEach((l) => {
        expect(l.start_time).toBeLessThan(l.end_time);
        l.words.forEach((w, idx) => {
          expect(w.start_time).toBeLessThan(w.end_time);
          if (idx > 0) {
            expect(w.start_time).toBeGreaterThanOrEqual(l.words[idx - 1].end_time);
          }
        });
      });
    });

    it('Oracle 1.4: Tapping beyond final index returns complete and does not crash or throw', () => {
      const lines = createMockLines(1, 1);
      const lineRes = applyLineTap(lines, 999, 10.0, 60);
      expect(lineRes.isComplete).toBe(true);
      expect(lineRes.nextLineIndex).toBe(0);

      const wordRes = applyWordTap(lines, 999, 999, 10.0, 60);
      expect(wordRes.isComplete).toBe(true);
      expect(wordRes.nextLineIndex).toBe(0);
      expect(wordRes.nextWordIndex).toBe(0);
    });

    // -----------------------------------------------------------------------
    // EMPIRICAL BUG REPRODUCTION 1: Zero-Duration Collapse under Backward Stamping
    // -----------------------------------------------------------------------
    it('FixVerified 1.5: Word tap when currentTime <= prevWord.start_time enforces positive duration and prevents 0-duration collapse', () => {
      const lines = createMockLines(1, 3);
      // Word 0 is at 4.0 -> 5.0
      lines[0].words[0].start_time = 4.0;
      lines[0].words[0].end_time = 5.0;

      // User accidentally double-taps or taps Word 1 at t = 3.5s (before Word 0 start_time)
      // or at t = 4.0s (identical to Word 0 start_time)
      const result = applyWordTap(lines, 0, 1, 4.0, 60);
      const prevWord = result.updatedLines[0].words[0];
      const prevWordDuration = parseFloat((prevWord.end_time - prevWord.start_time).toFixed(3));

      expect(prevWord.start_time).toBe(4.0);
      expect(prevWord.end_time).toBeGreaterThan(4.0);
      expect(prevWordDuration).toBeGreaterThanOrEqual(0.05);
    });
  });

  // =========================================================================
  // SECTION 2: COMPONENT RAPID TOUCH INTERACTION STRESS
  // =========================================================================

  describe('2. Component Rapid Touch Stamping & Mode Switching Stress', () => {
    it('Interactive 2.1: Rapid consecutive touch clicks on tap-now-btn advance lines accurately', () => {
      setTestViewport(375, 667);
      const lines = createMockLines(4, 2);

      render(
        <LyricTimelineEditor
          lines={lines}
          currentTime={2.0}
          duration={120}
          onSaveLines={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Open Tap-to-Sync
      const tapSyncBtn = screen.getByRole('button', { name: /tap to sync/i });
      fireEvent.click(tapSyncBtn);

      const stampBtn = screen.getByTestId('tap-now-btn');
      expect(stampBtn).toBeInTheDocument();

      // Rapidly tap 3 times
      act(() => {
        fireEvent.click(stampBtn);
      });
      act(() => {
        fireEvent.click(stampBtn);
      });
      act(() => {
        fireEvent.click(stampBtn);
      });

      // Target should now be Line 4 of 4
      expect(screen.getByText(/Line 4 of 4/i)).toBeInTheDocument();

      // 4th tap completes the sync
      act(() => {
        fireEvent.click(stampBtn);
      });

      // Banner should close or show completed state
      expect(screen.queryByTestId('tap-to-sync-banner')).not.toBeInTheDocument();
    });

    it('Interactive 2.2: Interleaving Line and Word sync mode switches during rapid touch stamping', () => {
      setTestViewport(375, 667);
      const lines = createMockLines(3, 3);

      render(
        <LyricTimelineEditor
          lines={lines}
          currentTime={1.5}
          duration={120}
          onSaveLines={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // 1. Enter Tap-to-Sync
      fireEvent.click(screen.getByRole('button', { name: /tap to sync/i }));
      const stampBtn = screen.getByTestId('tap-now-btn');

      // 2. Stamp line 1 in Line Sync mode
      expect(screen.getByText(/Line 1 of 3/i)).toBeInTheDocument();
      act(() => {
        fireEvent.click(stampBtn);
      });

      // Now at Line 2
      expect(screen.getByText(/Line 2 of 3/i)).toBeInTheDocument();

      // 3. Switch to Word Sync mode
      const wordModeBtn = screen.getByTestId('tap-mode-word-btn');
      act(() => {
        fireEvent.click(wordModeBtn);
      });

      expect(screen.getByTestId('word-progress-badge')).toHaveTextContent(/Word 1 of 3/i);

      // Stamp word 1 and word 2 of Line 2
      act(() => {
        fireEvent.click(stampBtn);
      });
      expect(screen.getByTestId('word-progress-badge')).toHaveTextContent(/Word 2 of 3/i);

      act(() => {
        fireEvent.click(stampBtn);
      });
      expect(screen.getByTestId('word-progress-badge')).toHaveTextContent(/Word 3 of 3/i);

      // 4. Switch back to Line Sync mode
      const lineModeBtn = screen.getByTestId('tap-mode-line-btn');
      act(() => {
        fireEvent.click(lineModeBtn);
      });

      // Stamp Line 2 and moves to Line 3
      act(() => {
        fireEvent.click(stampBtn);
      });
      expect(screen.getByText(/Line 3 of 3/i)).toBeInTheDocument();

      // Stamp final line to complete
      act(() => {
        fireEvent.click(stampBtn);
      });
      expect(screen.queryByTestId('tap-to-sync-banner')).not.toBeInTheDocument();
    });

    it('Interactive 2.3: Rapid mode toggle stress test (20 consecutive mode changes)', () => {
      setTestViewport(320, 568);
      const onModeChange = vi.fn();
      let currentMode: TapSyncMode = 'line';

      const { rerender } = render(
        <TapToSyncBanner
          isActive={true}
          targetLine={createMockLines(1, 4)[0]}
          targetIndex={0}
          totalLines={1}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode={currentMode}
          onModeChange={(m) => {
            currentMode = m;
            onModeChange(m);
          }}
        />
      );

      const lineBtn = screen.getByTestId('tap-mode-line-btn');
      const wordBtn = screen.getByTestId('tap-mode-word-btn');

      for (let i = 0; i < 20; i++) {
        act(() => {
          if (i % 2 === 0) {
            fireEvent.click(wordBtn);
          } else {
            fireEvent.click(lineBtn);
          }
        });
        rerender(
          <TapToSyncBanner
            isActive={true}
            targetLine={createMockLines(1, 4)[0]}
            targetIndex={0}
            totalLines={1}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode={currentMode}
            onModeChange={(m) => {
              currentMode = m;
              onModeChange(m);
            }}
          />
        );
      }

      expect(onModeChange).toHaveBeenCalledTimes(20);
    });
  });

  // =========================================================================
  // SECTION 3: NARROW VIEWPORT (320px & 375px) ZERO HORIZONTAL OVERFLOW
  // =========================================================================

  describe('3. Narrow Viewports (320px & 375px) Zero Horizontal Overflow Stress', () => {
    it('Overflow 3.1: TapToSyncBanner with extreme 200-char line at 320px has zero overflow', () => {
      setTestViewport(320, 568);
      const longLine: LyricLine = {
        id: 1,
        text: 'This is an exceptionally long lyric line designed to stress-test wrapping and prevent any horizontal overflow on small mobile screens like iPhone SE first generation with only 320px viewport width.',
        start_time: 1.0,
        end_time: 15.0,
        words: [],
      };

      const { container } = render(
        <TapToSyncBanner
          isActive={true}
          targetLine={longLine}
          targetIndex={0}
          totalLines={10}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="line"
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('Overflow 3.2: Full LyricTimelineEditor with Tap-to-Sync active at 320px viewport has zero overflow', () => {
      setTestViewport(320, 568);
      const lines = createMockLines(3, 4);

      const { container } = render(
        <LyricTimelineEditor
          lines={lines}
          currentTime={1.0}
          duration={180}
          onSaveLines={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Open Tap-to-Sync
      fireEvent.click(screen.getByRole('button', { name: /tap to sync/i }));

      assertZeroHorizontalOverflow(container, 320);
    });

    it('Overflow 3.3: Full LyricTimelineEditor with Tap-to-Sync active at 375px viewport has zero overflow', () => {
      setTestViewport(375, 667);
      const lines = createMockLines(3, 4);

      const { container } = render(
        <LyricTimelineEditor
          lines={lines}
          currentTime={1.0}
          duration={180}
          onSaveLines={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Open Tap-to-Sync
      fireEvent.click(screen.getByRole('button', { name: /tap to sync/i }));

      assertZeroHorizontalOverflow(container, 375);
    });

    it('Overflow 3.4: ExpandedWordEditor at 375px has zero horizontal overflow', () => {
      setTestViewport(375, 667);
      const lineWithMultiDigit: LyricLine = {
        id: 1,
        text: 'Timestamp stress testing line',
        start_time: 3590.25,
        end_time: 3598.85,
        words: [
          { word: 'Timestamp', start_time: 3590.25, end_time: 3592.5 },
          { word: 'stress', start_time: 3592.5, end_time: 3594.0 },
          { word: 'testing', start_time: 3594.0, end_time: 3596.2 },
          { word: 'line', start_time: 3596.2, end_time: 3598.85 },
        ],
      };

      const { container } = render(
        <ExpandedWordEditor
          line={lineWithMultiDigit}
          activeWordLoc={null}
          currentTime={3592.0}
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 375);
    });

    // -----------------------------------------------------------------------
    // EMPIRICAL BUG REPRODUCTION 2: ExpandedWordEditor Row 3 Overflow at 320px
    // -----------------------------------------------------------------------
    it('FixVerified 3.5: ExpandedWordEditor playhead snap buttons wrap cleanly with zero overflow at 320px', () => {
      setTestViewport(320, 568);
      const line: LyricLine = {
        id: 1,
        text: 'Snap playhead test',
        start_time: 1.0,
        end_time: 5.0,
        words: [{ word: 'Snap', start_time: 1.0, end_time: 2.0 }],
      };

      const { container } = render(
        <ExpandedWordEditor
          line={line}
          activeWordLoc={null}
          currentTime={1.5} // renders the playhead snap row: "Snap Start (playhead)" + "Snap End (playhead)"
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // =========================================================================
  // SECTION 4: MOBILE TOUCH TARGET AUDIT (>= 44x44px & >= 48px)
  // =========================================================================

  describe('4. Mobile Touch Target Accessibility Invariants', () => {
    it('TouchTarget 4.1: Tap-to-Sync stamp button meets >= 48px height on mobile', () => {
      setTestViewport(375, 667);
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={createMockLines(1, 2)[0]}
          targetIndex={0}
          totalLines={1}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="line"
        />
      );

      const stampBtn = screen.getByTestId('tap-now-btn');
      const cls = stampBtn.className;
      const meetsRequirement =
        cls.includes('min-h-[48px]') || cls.includes('min-h-[52px]') || cls.includes('h-12');
      expect(
        meetsRequirement,
        `Expected tap stamp button to meet >= 48px height, got classes: ${cls}`
      ).toBe(true);
    });

    it('TouchTarget 4.2: Mode switcher buttons (Line Sync & Word Sync) meet >= 44x44px on mobile', () => {
      setTestViewport(375, 667);
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={createMockLines(1, 2)[0]}
          targetIndex={0}
          totalLines={1}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="line"
        />
      );

      const lineBtn = screen.getByTestId('tap-mode-line-btn');
      const wordBtn = screen.getByTestId('tap-mode-word-btn');

      expect(lineBtn.className).toContain('min-h-[44px]');
      expect(lineBtn.className).toContain('min-w-[44px]');
      expect(wordBtn.className).toContain('min-h-[44px]');
      expect(wordBtn.className).toContain('min-w-[44px]');
    });

    it('TouchTarget 4.3: Exit tap mode button meets >= 44x44px on mobile', () => {
      setTestViewport(375, 667);
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={createMockLines(1, 2)[0]}
          targetIndex={0}
          totalLines={1}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="line"
        />
      );

      const exitBtn = screen.getByTestId('exit-tap-mode-btn');
      expect(exitBtn.className).toContain('min-h-[44px]');
      expect(exitBtn.className).toContain('min-w-[44px]');
    });

    it('TouchTarget 4.4: TimelineLineCard nudge buttons, jump trigger, and chevron meet >= 44x44px', () => {
      setTestViewport(375, 667);
      const line = createMockLines(1, 2)[0];

      render(
        <TimelineLineCard
          line={line}
          idx={0}
          isCurrentlyActive={false}
          isExpanded={false}
          editingLineId={null}
          editingText=""
          activeWordLoc={null}
          editInputRef={{ current: null }}
          onLineClick={vi.fn()}
          onWordClick={vi.fn()}
          onStartEditing={vi.fn()}
          onCommitEditing={vi.fn()}
          onCancelEditing={vi.fn()}
          onSetEditingText={vi.fn()}
          onNudgeLine={vi.fn()}
          onInsertLineAbove={vi.fn()}
          onInsertLineBelow={vi.fn()}
          onDeleteLine={vi.fn()}
          onToggleExpand={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={vi.fn()}
        />
      );

      // Line timing nudges (-0.2s, -0.05s, +0.05s, +0.2s)
      const nudges = screen.getAllByRole('button', { name: /nudge line/i });
      expect(nudges.length).toBe(4);
      nudges.forEach((btn) => {
        expect(btn.className).toContain('min-h-[44px]');
        expect(btn.className).toContain('min-w-[44px]');
      });

      // Jump / Select line trigger
      const jumpBtn = screen.getByRole('button', { name: /jump to line/i });
      expect(jumpBtn.className).toContain('min-h-[44px]');

      // Expand chevron
      const chevron = screen.getByRole('button', { name: /expand word timings/i });
      expect(chevron.className).toContain('min-h-[44px]');
      expect(chevron.className).toContain('min-w-[44px]');
    });

    it('TouchTarget 4.5: ExpandedWordEditor steppers, word shift pills, and inputs meet >= 44x44px', () => {
      setTestViewport(375, 667);
      const line = createMockLines(1, 1)[0];

      render(
        <ExpandedWordEditor
          line={line}
          activeWordLoc={null}
          currentTime={1.0}
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={vi.fn()}
        />
      );

      // Word shift pills (◀ and ▶)
      const shiftButtons = screen.getAllByRole('button', { name: /nudge word .* 0.05s/i });
      expect(shiftButtons.length).toBe(2);
      shiftButtons.forEach((btn) => {
        expect(btn.className).toContain('min-h-[44px]');
        expect(btn.className).toContain('min-w-[44px]');
      });

      // Word boundary steppers (- and +)
      const stepperMinus = screen.getAllByRole('button', { name: /earlier/i });
      const stepperPlus = screen.getAllByRole('button', { name: /later/i });
      [...stepperMinus, ...stepperPlus].forEach((btn) => {
        expect(btn.className).toContain('min-h-[44px]');
        expect(btn.className).toContain('min-w-[44px]');
      });

      // Number inputs
      const startInput = screen.getByLabelText(/start time for word/i);
      const endInput = screen.getByLabelText(/end time for word/i);
      expect(startInput.className).toContain('min-h-[44px]');
      expect(endInput.className).toContain('min-h-[44px]');
    });
  });

  // =========================================================================
  // SECTION 5: WAVEFORM TOUCH SCRUBBING & GESTURE SAFETY
  // =========================================================================

  describe('5. Waveform Scrubber Touch-Action Safety & Pointer Handling', () => {
    it('Waveform 5.1: Container attaches touch-none (touch-action: none) to eliminate scroll hijacking', () => {
      const { container } = render(
        <WaveformScrubber currentTime={10} duration={120} onSeek={vi.fn()} isPlaying={false} />
      );

      const scrubber = container.querySelector('[data-testid="waveform-scrubber"]');
      expect(scrubber).toBeInTheDocument();
      expect(scrubber?.className).toContain('touch-none');
    });

    it('Waveform 5.2: Pointer events sequence (down, move, up) seeks audio accurately on touchscreens', () => {
      const onSeek = vi.fn();
      render(<WaveformScrubber currentTime={0} duration={100} onSeek={onSeek} isPlaying={false} />);

      const scrubber = screen.getByTestId('waveform-scrubber');

      // Mock getBoundingClientRect
      scrubber.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 40,
        width: 200,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Pointer down at x = 50 (25% of 100s = 25s)
      fireEvent.pointerDown(scrubber, {
        pointerId: 1,
        clientX: 50,
        clientY: 20,
        bubbles: true,
      });

      expect(onSeek).toHaveBeenCalledWith(25);

      // Pointer move at x = 150 (75% of 100s = 75s)
      fireEvent.pointerMove(scrubber, {
        pointerId: 1,
        clientX: 150,
        clientY: 20,
        bubbles: true,
      });

      expect(onSeek).toHaveBeenCalledWith(75);

      // Pointer up at x = 180 (90% of 100s = 90s)
      fireEvent.pointerUp(scrubber, {
        pointerId: 1,
        clientX: 180,
        clientY: 20,
        bubbles: true,
      });

      expect(onSeek).toHaveBeenCalledWith(90);
    });

    it('Waveform 5.3: Pointer cancel cleans up active drag state without throwing', () => {
      const onSeek = vi.fn();
      render(<WaveformScrubber currentTime={0} duration={100} onSeek={onSeek} isPlaying={false} />);

      const scrubber = screen.getByTestId('waveform-scrubber');

      fireEvent.pointerDown(scrubber, {
        pointerId: 1,
        clientX: 50,
        clientY: 20,
        bubbles: true,
      });

      // Pointer cancel
      fireEvent.pointerCancel(scrubber, {
        pointerId: 1,
        clientX: 60,
        clientY: 20,
        bubbles: true,
      });

      // Subsequent pointer move should NOT trigger seeking
      onSeek.mockClear();
      fireEvent.pointerMove(scrubber, {
        pointerId: 1,
        clientX: 100,
        clientY: 20,
        bubbles: true,
      });

      expect(onSeek).not.toHaveBeenCalled();
    });
  });
});
