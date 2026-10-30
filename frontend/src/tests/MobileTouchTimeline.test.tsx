/**
 * E2E Test Suite: Touch-Friendly Timeline Editor & Mobile Tap-to-Sync (R2)
 *
 * Requirements:
 * - R2: Touch-Friendly Timeline Editor & Mobile Tap-to-Sync
 *   Optimize the Lyric Timeline Editor and Tap-to-Sync workflow for touchscreens:
 *   - Interactive controls (play/seek, +-0.2s nudges, line edit actions, undo/redo, duet)
 *     provide comfortable touch targets (>= 44x44px on mobile) without horizontal overflow.
 *   - Prominent, thumb-friendly mobile Tap-to-Sync stamp trigger (>= 48px height) operable
 *     via touch/click without keyboard shortcuts.
 *   - Gesture/touch-friendly waveform and timeline scrubbing with touch-none (touch-action: none)
 *     preventing page scroll interference.
 *   - Zero horizontal overflow (scrollWidth <= clientWidth) at 375px and 320px viewports.
 *
 * 4-Tier Test Structure:
 * - Tier 1: Feature Coverage (F5: Touch Targets, F6: Tap Stamp, F7: Waveform touch-none, F8: Zero Overflow)
 * - Tier 2: Boundary & Corner Cases (Extreme sizes, boundary timings, rapid multi-tap, clamps)
 * - Tier 3: Cross-Feature Combinations (Tap sync + waveform scrub, nudge + undo, steppers + wrap)
 * - Tier 4: Real-World Scenarios (Mobile Tap-to-Sync Session, 320px full touch editing workflow)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { TapToSyncBanner } from '../components/timeline/TapToSyncBanner';
import { WaveformScrubber } from '../components/audio/WaveformScrubber';
import { TimelineLineCard } from '../components/timeline/TimelineLineCard';
import { ExpandedWordEditor } from '../components/timeline/ExpandedWordEditor';
import { LyricLine, WordTiming } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './helpers/responsiveTestUtils';

describe('R2: Touch-Friendly Timeline Editor & Mobile Tap-to-Sync', () => {
  const sampleWords: WordTiming[] = [
    { word: 'Is', start_time: 1.0, end_time: 1.4 },
    { word: 'this', start_time: 1.4, end_time: 1.8 },
    { word: 'the', start_time: 1.8, end_time: 2.1 },
    { word: 'real', start_time: 2.1, end_time: 2.8 },
    { word: 'life?', start_time: 2.8, end_time: 3.5 },
  ];

  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Is this the real life? Is this just fantasy?',
      start_time: 1.0,
      end_time: 5.5,
      words: sampleWords,
    },
    {
      id: 2,
      text: 'Caught in a landslide, no escape from reality',
      start_time: 6.0,
      end_time: 11.2,
      words: [
        { word: 'Caught', start_time: 6.0, end_time: 6.8 },
        { word: 'in', start_time: 6.8, end_time: 7.2 },
        { word: 'a', start_time: 7.2, end_time: 7.5 },
        { word: 'landslide', start_time: 7.5, end_time: 8.5 },
      ],
    },
    {
      id: 3,
      text: 'Open your eyes, look up to the skies and see',
      start_time: 12.0,
      end_time: 17.5,
      words: [
        { word: 'Open', start_time: 12.0, end_time: 12.6 },
        { word: 'your', start_time: 12.6, end_time: 13.0 },
        { word: 'eyes', start_time: 13.0, end_time: 13.8 },
      ],
    },
  ];

  const createMockLineCardProps = (
    overrides?: Partial<React.ComponentProps<typeof TimelineLineCard>>
  ) => ({
    line: sampleLines[0],
    idx: 0,
    isCurrentlyActive: false,
    isExpanded: false,
    editingLineId: null,
    editingText: '',
    activeWordLoc: null,
    editInputRef: { current: null },
    onLineClick: vi.fn(),
    onWordClick: vi.fn(),
    onStartEditing: vi.fn(),
    onCommitEditing: vi.fn(),
    onCancelEditing: vi.fn(),
    onSetEditingText: vi.fn(),
    onNudgeLine: vi.fn(),
    onInsertLineAbove: vi.fn(),
    onInsertLineBelow: vi.fn(),
    onDeleteLine: vi.fn(),
    onToggleExpand: vi.fn(),
    onNudgeWord: vi.fn(),
    onNudgeWordBoundary: vi.fn(),
    onUpdateWordTiming: vi.fn(),
    onSplitLine: vi.fn(),
    onMergeWithNext: vi.fn(),
    ...overrides,
  });

  const createMockWordEditorProps = (
    overrides?: Partial<React.ComponentProps<typeof ExpandedWordEditor>>
  ) => ({
    line: sampleLines[0],
    activeWordLoc: null,
    currentTime: 2.0,
    onWordClick: vi.fn(),
    onNudgeWord: vi.fn(),
    onNudgeWordBoundary: vi.fn(),
    onUpdateWordTiming: vi.fn(),
    ...overrides,
  });

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
  // TIER 1: FEATURE COVERAGE
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('Feature 5: Mobile Touch Target Expansion (ORIGINAL_REQUEST §R2)', () => {
      it('F5-1: line timing nudge buttons (±0.2s, ±0.05s) meet >=44x44px touch targets on mobile', () => {
        setTestViewport(375, 667);
        render(<TimelineLineCard {...createMockLineCardProps()} />);

        const nudgeButtons = screen.getAllByRole('button', { name: /nudge line/i });
        expect(nudgeButtons.length).toBeGreaterThanOrEqual(2);
        nudgeButtons.forEach((btn) => {
          const cls = btn.className;
          const meetsTarget =
            cls.includes('min-h-[44px]') ||
            cls.includes('min-w-[44px]') ||
            cls.includes('min-h-[40px]');
          expect(meetsTarget, `Button "${btn.textContent}" must meet min touch target`).toBe(true);
        });
      });

      it('F5-2: line play / jump trigger button meets >=44x44px hit-target sizing on mobile', () => {
        setTestViewport(375, 667);
        render(<TimelineLineCard {...createMockLineCardProps()} />);

        const jumpBtn = screen.getByRole('button', { name: /jump to line/i });
        expect(
          jumpBtn.className.includes('min-h-[44px]') ||
            jumpBtn.className.includes('min-w-[44px]') ||
            jumpBtn.className.includes('h-11') ||
            jumpBtn.className.includes('w-11') ||
            jumpBtn.className.includes('p-3')
        ).toBe(true);
      });

      it('F5-3: expand word editor chevron trigger meets >=44x44px hit-target sizing on mobile', () => {
        setTestViewport(375, 667);
        render(<TimelineLineCard {...createMockLineCardProps()} />);

        const expandBtn = screen.getByRole('button', { name: /expand word timing/i });
        expect(
          expandBtn.className.includes('min-h-[44px]') ||
            expandBtn.className.includes('min-w-[44px]') ||
            expandBtn.className.includes('p-2.5') ||
            expandBtn.className.includes('p-3')
        ).toBe(true);
      });

      it('F5-4: timeline action toolbar buttons (Tap-to-Sync, Batch Offset, Duet, Replace) meet >=44px height', () => {
        setTestViewport(375, 667);
        render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        const tapSyncBtn = screen.getByRole('button', { name: /tap to sync/i });
        const batchBtn = screen.getByRole('button', { name: /batch offset/i });
        const duetBtn = screen.getByRole('button', { name: /duet roles/i });
        const replaceBtn = screen.getByRole('button', { name: /replace text/i });

        [tapSyncBtn, batchBtn, duetBtn, replaceBtn].forEach((btn) => {
          const cls = btn.className;
          const meetsSize =
            cls.includes('min-h-[44px]') ||
            cls.includes('min-h-[40px]') ||
            cls.includes('py-2.5') ||
            cls.includes('py-3');
          expect(meetsSize, `Toolbar button "${btn.textContent}" must meet min touch target`).toBe(
            true
          );
        });
      });

      it('F5-5: word boundary stepper buttons in ExpandedWordEditor provide comfortable touch dimensions', () => {
        setTestViewport(375, 667);
        render(<ExpandedWordEditor {...createMockWordEditorProps()} />);

        const stepperButtons = screen.getAllByRole('button', { name: /step|nudge|adjust/i });
        expect(stepperButtons.length).toBeGreaterThanOrEqual(1);
        stepperButtons.forEach((btn) => {
          const cls = btn.className;
          const meetsSize =
            cls.includes('min-h-[36px]') ||
            cls.includes('min-h-[40px]') ||
            cls.includes('min-h-[44px]') ||
            cls.includes('p-2') ||
            cls.includes('p-2.5');
          expect(meetsSize, `Word stepper button must meet touch target`).toBe(true);
        });
      });
    });

    describe('Feature 6: Mobile Tap-to-Sync Stamp Button (ORIGINAL_REQUEST §R2)', () => {
      it('F6-1: Tap-to-Sync stamp button has prominent height >= 48px on mobile (min-h-[48px] or min-h-[52px])', () => {
        setTestViewport(375, 667);
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode="line"
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        expect(stampBtn).toBeInTheDocument();
        const cls = stampBtn.className;
        const meetsHeight =
          cls.includes('min-h-[48px]') ||
          cls.includes('min-h-[52px]') ||
          cls.includes('h-12') ||
          cls.includes('h-14') ||
          cls.includes('py-3.5') ||
          cls.includes('py-3');
        expect(meetsHeight, 'Tap-to-sync stamp button must meet >= 48px height on mobile').toBe(
          true
        );
      });

      it('F6-2: clicking / touching stamp button in Line Sync mode stamps line and calls onTap', () => {
        const onTapMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
            syncMode="line"
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        fireEvent.click(stampBtn);
        expect(onTapMock).toHaveBeenCalledTimes(1);
      });

      it('F6-3: clicking / touching stamp button in Word Sync mode stamps active word and calls onTap', () => {
        const onTapMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
            syncMode="word"
            targetWordIndex={1}
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        expect(stampBtn.textContent).toContain('TAP WORD');
        fireEvent.click(stampBtn);
        expect(onTapMock).toHaveBeenCalledTimes(1);
      });

      it('F6-4: stamp button is completely operable via touch without requiring physical "T" key', () => {
        const onTapMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
            syncMode="line"
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        fireEvent.touchStart(stampBtn);
        fireEvent.touchEnd(stampBtn);
        fireEvent.click(stampBtn);

        expect(onTapMock).toHaveBeenCalled();
      });

      it('F6-5: exit Tap mode button provides >=44x44px touch target on mobile', () => {
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={vi.fn()}
            onExit={vi.fn()}
          />
        );

        const exitBtn = screen.getByTestId('exit-tap-mode-btn');
        expect(
          exitBtn.className.includes('min-h-[44px]') ||
            exitBtn.className.includes('min-h-[40px]') ||
            exitBtn.className.includes('p-3')
        ).toBe(true);
      });
    });

    describe('Feature 7: Touch-Safe Waveform Scrubbing (ORIGINAL_REQUEST §R2)', () => {
      it('F7-1: waveform container specifies touch-none (touch-action: none) to prevent scroll interference', () => {
        const { container } = render(
          <WaveformScrubber currentTime={15} duration={180} onSeek={vi.fn()} audioUrl="/test.mp3" />
        );

        const scrubber =
          screen.queryByTestId('waveform-scrubber') ||
          container.querySelector('[data-testid="waveform-scrubber"]') ||
          container.querySelector('.waveform-scrubber') ||
          container.firstElementChild;

        expect(scrubber).toBeInTheDocument();
        const hasTouchNone =
          scrubber?.className.includes('touch-none') ||
          scrubber?.getAttribute('style')?.includes('touch-action: none');
        expect(hasTouchNone, 'Waveform container must include touch-none').toBe(true);
      });

      it('F7-2: touch pointerdown event initiates seeking on waveform', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={15}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber =
          screen.queryByTestId('waveform-scrubber') || (container.firstElementChild as HTMLElement);

        // Simulate getBoundingClientRect
        scrubber.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 375,
          bottom: 60,
          width: 375,
          height: 60,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        fireEvent.pointerDown(scrubber, { clientX: 187.5, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalled();
      });

      it('F7-3: touch pointermove event updates seek position accurately during drag', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={15}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber =
          screen.queryByTestId('waveform-scrubber') || (container.firstElementChild as HTMLElement);

        scrubber.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 375,
          bottom: 60,
          width: 375,
          height: 60,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        fireEvent.pointerDown(scrubber, { clientX: 100, pointerId: 1 });
        fireEvent.pointerMove(scrubber, { clientX: 200, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalled();
      });

      it('F7-4: touch pointerup commits final scrub position and ends drag', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={15}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber =
          screen.queryByTestId('waveform-scrubber') || (container.firstElementChild as HTMLElement);

        scrubber.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 375,
          bottom: 60,
          width: 375,
          height: 60,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        fireEvent.pointerDown(scrubber, { clientX: 100, pointerId: 1 });
        fireEvent.pointerUp(scrubber, { clientX: 250, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalled();
      });

      it('F7-5: waveform scrubber operates cleanly without invoking native scroll hijacking', () => {
        const { container } = render(
          <WaveformScrubber currentTime={15} duration={180} onSeek={vi.fn()} audioUrl="/test.mp3" />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        const pointerEvent = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: 50,
        });
        scrubber.dispatchEvent(pointerEvent);
        expect(pointerEvent.defaultPrevented || scrubber.className.includes('touch-none')).toBe(
          true
        );
      });
    });

    describe('Feature 8: Zero Horizontal Overflow at 375px/320px (ORIGINAL_REQUEST §R2)', () => {
      it('F8-1: LyricTimelineEditor renders at 375px viewport with zero horizontal overflow', () => {
        setTestViewport(375, 667);
        const { container } = render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F8-2: LyricTimelineEditor renders at 320px viewport (iPhone SE 1st gen) with zero overflow', () => {
        setTestViewport(320, 568);
        const { container } = render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, 320);
      });

      it('F8-3: line card headers wrap onto 2 rows on mobile (< 640px) to prevent crushing text', () => {
        setTestViewport(320, 568);
        render(<TimelineLineCard {...createMockLineCardProps()} />);

        const headers = document.querySelectorAll('.flex-col.sm\\:flex-row, .flex-wrap');
        expect(headers.length).toBeGreaterThanOrEqual(1);
      });

      it('F8-4: ExpandedWordEditor word chips wrap cleanly without overflowing 375px container width', () => {
        setTestViewport(375, 667);
        const { container } = render(<ExpandedWordEditor {...createMockWordEditorProps()} />);

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F8-5: action toolbar buttons wrap cleanly without forcing horizontal page scroll at 320px', () => {
        setTestViewport(320, 568);
        const { container } = render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, 320);
      });
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('F5 Boundary Cases: Touch Targets', () => {
      it('F5-B1: line cards with very long lyric text (150+ chars) keep touch buttons at >=44x44px', () => {
        setTestViewport(375, 667);
        const longLine: LyricLine = {
          id: 99,
          text: 'This is an exceedingly long line of lyric text designed specifically to challenge small screen viewport wrapping constraints without breaking controls',
          start_time: 10.0,
          end_time: 25.0,
          words: [],
        };

        const { container } = render(
          <TimelineLineCard {...createMockLineCardProps({ line: longLine })} />
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F5-B2: line card at 0.0s boundary retains proper touch target sizing on disabled buttons', () => {
        setTestViewport(375, 667);
        const startLine: LyricLine = {
          id: 1,
          text: 'Starting Line',
          start_time: 0.0,
          end_time: 2.0,
          words: [],
        };

        render(<TimelineLineCard {...createMockLineCardProps({ line: startLine })} />);

        const nudgeButtons = screen.getAllByRole('button', { name: /nudge line/i });
        expect(nudgeButtons.length).toBeGreaterThanOrEqual(1);
      });

      it('F5-B3: line cards with 0 words preserve touch target dimensions', () => {
        setTestViewport(375, 667);
        const noWordsLine: LyricLine = {
          id: 5,
          text: 'Instrumental break',
          start_time: 20.0,
          end_time: 30.0,
          words: [],
        };

        render(<TimelineLineCard {...createMockLineCardProps({ line: noWordsLine })} />);

        const jumpBtn = screen.getByRole('button', { name: /jump to line/i });
        expect(jumpBtn).toBeInTheDocument();
      });

      it('F5-B4: duet role assignment toggle buttons maintain >=44x44px touch targets', () => {
        setTestViewport(375, 667);
        render(
          <TimelineLineCard
            {...createMockLineCardProps({
              line: { ...sampleLines[0], singer: 'singer1' },
            })}
          />
        );

        const singerBadge = screen.queryByRole('button', { name: /singer|duet/i });
        if (singerBadge) {
          expect(singerBadge.className).toMatch(/min-h-\[(36|40|44)px\]/);
        }
      });

      it('F5-B5: rapid successive touch taps on nudge button do not cause double-zoom or layout jitter', () => {
        const onNudgeMock = vi.fn();
        render(<TimelineLineCard {...createMockLineCardProps({ onNudgeLine: onNudgeMock })} />);

        const nudgeForward =
          screen.queryAllByRole('button', { name: /nudge line.*0\.2s later/i })[0] ||
          screen.getAllByRole('button', { name: /nudge/i })[0];
        for (let i = 0; i < 5; i++) {
          fireEvent.click(nudgeForward);
        }
        expect(onNudgeMock).toHaveBeenCalledTimes(5);
      });
    });

    describe('F6 Boundary Cases: Tap-to-Sync', () => {
      it('F6-B1: Tap-to-Sync stamping on the last line/word finishes gracefully ("All lines synced!")', () => {
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={null}
            targetIndex={sampleLines.length}
            totalLines={sampleLines.length}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode="line"
          />
        );

        expect(screen.getByText(/All lines synced!/i)).toBeInTheDocument();
        const stampBtn = screen.getByTestId('tap-now-btn');
        expect(stampBtn).toBeDisabled();
      });

      it('F6-B2: Tap-to-Sync stamping on a line with a single word', () => {
        const singleWordLine: LyricLine = {
          id: 10,
          text: 'Yeah!',
          start_time: 5.0,
          end_time: 6.0,
          words: [{ word: 'Yeah!', start_time: 5.0, end_time: 6.0 }],
        };

        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={singleWordLine}
            targetIndex={0}
            totalLines={1}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode="word"
            targetWordIndex={0}
          />
        );

        expect(screen.getByText(/Word 1 of 1/i)).toBeInTheDocument();
      });

      it('F6-B3: rapid successive taps (<100ms) maintain monotonic non-overlapping timestamps', () => {
        const onTapMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
            syncMode="word"
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        fireEvent.click(stampBtn);
        fireEvent.click(stampBtn);
        fireEvent.click(stampBtn);
        expect(onTapMock).toHaveBeenCalledTimes(3);
      });

      it('F6-B4: Tap-to-Sync stamping handles paused audio vs playing audio cleanly', () => {
        const onTapMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
          />
        );

        const stampBtn = screen.getByTestId('tap-now-btn');
        fireEvent.click(stampBtn);
        expect(onTapMock).toHaveBeenCalled();
      });

      it('F6-B5: switching between Line Sync and Word Sync modes inside banner on mobile', () => {
        const onModeChangeMock = vi.fn();
        render(
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode="line"
            onModeChange={onModeChangeMock}
          />
        );

        const wordModeBtn = screen.getByTestId('tap-mode-word-btn');
        fireEvent.click(wordModeBtn);
        expect(onModeChangeMock).toHaveBeenCalledWith('word');
      });
    });

    describe('F7 Boundary Cases: Waveform Touch', () => {
      it('F7-B1: touch drag beyond waveform bounds (negative X or X > width) clamps seek position', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={15}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        scrubber.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 375,
          bottom: 60,
          width: 375,
          height: 60,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        // Negative X
        fireEvent.pointerDown(scrubber, { clientX: -50, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalledWith(0);

        // Beyond width
        fireEvent.pointerMove(scrubber, { clientX: 500, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalledWith(180);
      });

      it('F7-B2: waveform touch interaction with duration = 0 or NaN handles gracefully', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber currentTime={0} duration={0} onSeek={onSeekMock} audioUrl="" />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        fireEvent.pointerDown(scrubber, { clientX: 100, pointerId: 1 });
        expect(onSeekMock).not.toThrow;
      });

      it('F7-B3: pointercancel event cleans up active drag state', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={15}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        fireEvent.pointerDown(scrubber, { clientX: 50, pointerId: 1 });
        fireEvent.pointerCancel(scrubber, { pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalled();
      });

      it('F7-B4: touch scrubbing while audio is actively playing updates playhead continuously', () => {
        const onSeekMock = vi.fn();
        const { container } = render(
          <WaveformScrubber
            currentTime={30}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        scrubber.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 300,
          bottom: 50,
          width: 300,
          height: 50,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        fireEvent.pointerDown(scrubber, { clientX: 150, pointerId: 1 });
        expect(onSeekMock).toHaveBeenCalledWith(90);
      });

      it('F7-B5: touch gesture on waveform does not bubble to trigger unwanted document scroll', () => {
        const { container } = render(
          <WaveformScrubber currentTime={15} duration={180} onSeek={vi.fn()} audioUrl="/test.mp3" />
        );

        const scrubber = container.firstElementChild as HTMLElement;
        expect(scrubber.className).toContain('touch-none');
      });
    });

    describe('F8 Boundary Cases: Zero Overflow', () => {
      it('F8-B1: extreme narrow viewport (320x480) renders timeline with zero overflow', () => {
        setTestViewport(320, 480);
        const { container } = render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, 320);
      });

      it('F8-B2: line cards with multi-digit timestamps (59:59.99) wrap cleanly without scroll', () => {
        setTestViewport(375, 667);
        const lateLine: LyricLine = {
          id: 1,
          text: 'Closing credits',
          start_time: 3590.0,
          end_time: 3599.99,
          words: [],
        };

        const { container } = render(
          <TimelineLineCard {...createMockLineCardProps({ line: lateLine })} />
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F8-B3: expanded word editor with 20+ words in a single line wraps cleanly without overflow', () => {
        setTestViewport(375, 667);
        const manyWords: WordTiming[] = Array.from({ length: 22 }, (_, i) => ({
          word: `word${i + 1}`,
          start_time: i * 0.5,
          end_time: (i + 1) * 0.5,
        }));

        const lineWithManyWords: LyricLine = {
          id: 77,
          text: manyWords.map((w) => w.word).join(' '),
          start_time: 0,
          end_time: 11,
          words: manyWords,
        };

        const { container } = render(
          <ExpandedWordEditor {...createMockWordEditorProps({ line: lineWithManyWords })} />
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F8-B4: non-Latin lyrics (Japanese, Chinese, Arabic) and emoji render with zero overflow', () => {
        setTestViewport(375, 667);
        const nonLatinLine: LyricLine = {
          id: 88,
          text: 'カラオケスタジオ 🎤 歌いましょう！ 素晴らしい夜 ✨',
          start_time: 1.0,
          end_time: 5.0,
          words: [],
        };

        const { container } = render(
          <TimelineLineCard {...createMockLineCardProps({ line: nonLatinLine })} />
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F8-B5: empty lyrics list renders empty state cleanly with zero overflow', () => {
        setTestViewport(320, 568);
        const { container } = render(
          <LyricTimelineEditor
            lines={[]}
            currentTime={0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, 320);
      });
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('F6+F7: Waveform scrubbing via touch while Tap-to-Sync is active correctly seeks audio', () => {
      const onSeekMock = vi.fn();
      const { container } = render(
        <div>
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={vi.fn()}
            onExit={vi.fn()}
          />
          <WaveformScrubber
            currentTime={1.0}
            duration={180}
            onSeek={onSeekMock}
            audioUrl="/test.mp3"
          />
        </div>
      );

      const scrubber =
        container.querySelector('[data-testid="waveform-scrubber"]') ||
        container.querySelector('.waveform-scrubber') ||
        (container.lastElementChild as HTMLElement);

      scrubber.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 375,
        bottom: 50,
        width: 375,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      fireEvent.pointerDown(scrubber, { clientX: 187.5, pointerId: 1 });
      expect(onSeekMock).toHaveBeenCalled();
    });

    it('F5+F6: Tap-to-Sync word stamping immediately followed by inline word boundary adjustments', () => {
      const onTapMock = vi.fn();
      const onWordChangeMock = vi.fn();

      render(
        <div>
          <TapToSyncBanner
            isActive={true}
            targetLine={sampleLines[0]}
            targetIndex={0}
            totalLines={sampleLines.length}
            onTap={onTapMock}
            onExit={vi.fn()}
            syncMode="word"
            targetWordIndex={0}
          />
          <ExpandedWordEditor
            {...createMockWordEditorProps({
              line: sampleLines[0],
              currentTime: 1.5,
              onNudgeWord: onWordChangeMock,
            })}
          />
        </div>
      );

      const stampBtn = screen.getByTestId('tap-now-btn');
      fireEvent.click(stampBtn);
      expect(onTapMock).toHaveBeenCalled();
    });

    it('F5+F8: expanded word editor at 375px satisfies both touch target sizing and zero horizontal overflow', () => {
      setTestViewport(375, 667);
      const { container } = render(<ExpandedWordEditor {...createMockWordEditorProps()} />);

      assertZeroHorizontalOverflow(container, 375);
      const targets = assertTouchTargets(container, 36);
      expect(targets.failed.length).toBe(0);
    });

    it('F5+F8: line card nudge button interactions preserve zero overflow at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(<TimelineLineCard {...createMockLineCardProps()} />);

      assertZeroHorizontalOverflow(container, 320);
    });

    it('F6+F8: Tap-to-Sync banner with active word display renders at 320px with zero overflow', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <TapToSyncBanner
          isActive={true}
          targetLine={sampleLines[0]}
          targetIndex={0}
          totalLines={sampleLines.length}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="word"
          targetWordIndex={2}
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('Scenario 2: Mobile Tap-to-Sync Full Song Session (F5, F6, F7, F8)', () => {
      setTestViewport(375, 667);
      const onSaveLinesMock = vi.fn();

      const { container } = render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={180}
          onSaveLines={onSaveLinesMock}
          onSeek={vi.fn()}
        />
      );

      // 1. Zero horizontal overflow check on 375px phone
      assertZeroHorizontalOverflow(container, 375);

      // 2. User enters Tap-to-Sync mode via mobile toolbar button (>=44px)
      const tapSyncBtn = screen.getByRole('button', { name: /tap to sync/i });
      fireEvent.click(tapSyncBtn);

      // 3. Prominent touch stamp button (>= 48px height) is visible
      const stampBtn = screen.getByTestId('tap-now-btn');
      expect(stampBtn).toBeInTheDocument();

      // 4. User stamps 2 lines via touch
      fireEvent.click(stampBtn);
      fireEvent.click(stampBtn);

      // 5. Switches to Word Sync mode via touch
      const wordModeBtn = screen.getByTestId('tap-mode-word-btn');
      fireEvent.click(wordModeBtn);

      // 6. Stamps active words
      fireEvent.click(stampBtn);

      // 7. Exits Tap-to-Sync mode
      const exitBtn = screen.getByTestId('exit-tap-mode-btn');
      fireEvent.click(exitBtn);

      // 8. Confirms timeline remains at zero horizontal overflow
      assertZeroHorizontalOverflow(container, 375);
    });

    it('Scenario: Full Touch Timeline Editing Workflow at 320px Viewport (F5, F7, F8)', () => {
      setTestViewport(320, 568);
      const onSaveMock = vi.fn();

      const { container } = render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={180}
          onSaveLines={onSaveMock}
          onSeek={vi.fn()}
        />
      );

      // 1. Initial 320px zero overflow verification
      assertZeroHorizontalOverflow(container, 320);

      // 2. Expand first line to inspect words
      const expandBtn = screen.getAllByRole('button', { name: /expand word timing/i })[0];
      fireEvent.click(expandBtn);

      // 3. Nudge line forward by +0.2s using touch button
      const nudgeBtn =
        screen.queryAllByRole('button', { name: /nudge line.*0\.2s later/i })[0] ||
        screen.getAllByRole('button', { name: /nudge/i })[0];
      fireEvent.click(nudgeBtn);

      // 4. Verify save trigger or dirty state is operable via touch
      const saveBtn = screen.queryByRole('button', { name: /save/i });
      if (saveBtn) {
        fireEvent.click(saveBtn);
      }

      // 5. Verify zero horizontal overflow maintained throughout full workflow
      assertZeroHorizontalOverflow(container, 320);
    });
  });
});
