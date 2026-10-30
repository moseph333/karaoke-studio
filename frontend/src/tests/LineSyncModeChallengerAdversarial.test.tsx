import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../components/LyricDisplay';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { ExportModal } from '../components/ExportModal';
import { LyricLine, SyncDisplayMode, ProjectState, SingerRole } from '../types';
import * as apiModule from '../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './helpers/responsiveTestUtils';

describe('Challenger 1 Adversarial Suite: M1 Line-by-Line Lyric Synchronization', () => {
  const standardTestLines: LyricLine[] = [
    {
      id: 1,
      text: 'First verse fast opening',
      start_time: 10.0,
      end_time: 14.0,
      singer: 'singer1',
      words: [
        { word: 'First', start_time: 10.0, end_time: 10.8 },
        { word: 'verse', start_time: 10.9, end_time: 11.9 },
        { word: 'fast', start_time: 12.0, end_time: 12.9 },
        { word: 'opening', start_time: 13.0, end_time: 14.0 },
      ],
    },
    {
      id: 2,
      text: 'Second chorus partner harmony',
      start_time: 20.0, // 6s instrumental gap between 14.0 and 20.0
      end_time: 25.0,
      singer: 'singer2',
      words: [
        { word: 'Second', start_time: 20.0, end_time: 21.0 },
        { word: 'chorus', start_time: 21.1, end_time: 22.0 },
        { word: 'partner', start_time: 22.1, end_time: 23.5 },
        { word: 'harmony', start_time: 23.6, end_time: 25.0 },
      ],
    },
    {
      id: 3,
      text: 'Both singers together finale',
      start_time: 26.0,
      end_time: 30.0,
      singer: 'both',
      words: [
        { word: 'Both', start_time: 26.0, end_time: 26.8 },
        { word: 'singers', start_time: 26.9, end_time: 27.9 },
        { word: 'together', start_time: 28.0, end_time: 28.9 },
        { word: 'finale', start_time: 29.0, end_time: 30.0 },
      ],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestViewport();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Section 1: Adversarial Boundary Value Stress Tests
  // =========================================================================
  describe('Boundary Transitions & Timing Thresholds', () => {
    it('ADV-1.1: Pre-vocal lead-in boundary without gap and with gap countdown', () => {
      // 1. Line without instrumental gap (start_time < 4.0s, e.g. 2.0s)
      const noGapLines: LyricLine[] = [
        {
          id: 10,
          text: 'Short intro verse',
          start_time: 2.0,
          end_time: 5.0,
          words: [
            { word: 'Short', start_time: 2.0, end_time: 2.9 },
            { word: 'intro', start_time: 3.0, end_time: 3.9 },
            { word: 'verse', start_time: 4.0, end_time: 5.0 },
          ],
        },
      ];

      // At 0.49s (before 1.5s lead-in), active line is not mounted
      const { rerender } = render(
        <LyricDisplay lines={noGapLines} currentTime={0.49} syncMode="line" />
      );
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();

      // At 0.50s (exact start of 1.5s lead-in: 2.0 - 1.5 = 0.5), active line mounts, all words at 0%
      rerender(<LyricDisplay lines={noGapLines} currentTime={0.5} syncMode="line" />);
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
      for (let i = 0; i < 3; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(0);
        expect(word.style.clipPath).toBe('inset(0 100.00% 0 0)');
      }

      // At 1.999s (1ms before onset), progress MUST still be 0% across all words
      rerender(<LyricDisplay lines={noGapLines} currentTime={1.999} syncMode="line" />);
      for (let i = 0; i < 3; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(0);
        expect(word.style.clipPath).toBe('inset(0 100.00% 0 0)');
      }

      // At 2.000s (exact onset), all words jump to 100%
      rerender(<LyricDisplay lines={noGapLines} currentTime={2.0} syncMode="line" />);
      for (let i = 0; i < 3; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(100);
      }

      // 2. Lines with long instrumental gap (start_time >= 4.0s) show countdown during gap
      rerender(<LyricDisplay lines={standardTestLines} currentTime={8.5} syncMode="line" />);
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    });

    it('ADV-1.2: Exact onset instant (t = start_time) and post-onset (t = start_time + delta)', () => {
      // At exact 10.0s, all words immediately jump to 100% width and 0% clipPath
      const { rerender } = render(
        <LyricDisplay lines={standardTestLines} currentTime={10.0} syncMode="line" />
      );
      for (let i = 0; i < 4; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(100);
        expect(word.style.clipPath).toBe('inset(0 0.00% 0 0)');
      }

      // At 10.001s, all words remain 100%
      rerender(<LyricDisplay lines={standardTestLines} currentTime={10.001} syncMode="line" />);
      for (let i = 0; i < 4; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(100);
      }
    });

    it('ADV-1.3: End boundary and lead-out hold (t = end_time through end_time + 1.0s)', () => {
      // Line ends at 14.0s.
      // At 13.999s, all words are 100%
      const { rerender } = render(
        <LyricDisplay lines={standardTestLines} currentTime={13.999} syncMode="line" />
      );
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(100);

      // At exact 14.0s, all words are 100%
      rerender(<LyricDisplay lines={standardTestLines} currentTime={14.0} syncMode="line" />);
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(100);

      // At 14.999s (inside 1.0s lead-out), words remain 100%
      rerender(<LyricDisplay lines={standardTestLines} currentTime={14.999} syncMode="line" />);
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(100);

      // At exact 15.00s, line is still held
      rerender(<LyricDisplay lines={standardTestLines} currentTime={15.0} syncMode="line" />);
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();

      // At 15.01s (lead-out expired), active line unmounts cleanly
      rerender(<LyricDisplay lines={standardTestLines} currentTime={15.01} syncMode="line" />);
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    });

    it('ADV-1.4: Contiguous back-to-back lines without gaps (line1: [2, 5], line2: [5, 8])', () => {
      const contiguousLines: LyricLine[] = [
        {
          id: 1,
          text: 'First contiguous line',
          start_time: 2.0,
          end_time: 5.0,
          words: [
            { word: 'First', start_time: 2.0, end_time: 3.5 },
            { word: 'line', start_time: 3.5, end_time: 5.0 },
          ],
        },
        {
          id: 2,
          text: 'Second contiguous line',
          start_time: 5.0,
          end_time: 8.0,
          words: [
            { word: 'Second', start_time: 5.0, end_time: 6.5 },
            { word: 'line', start_time: 6.5, end_time: 8.0 },
          ],
        },
      ];

      // At 4.9s, line 1 is active, 100% in line mode
      const { rerender } = render(
        <LyricDisplay lines={contiguousLines} currentTime={4.9} syncMode="line" />
      );
      expect(screen.getByTestId('word-sung-0')).toHaveTextContent('First');
      expect(screen.getByTestId('word-sung-1')).toHaveTextContent('line');
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(100);

      // At 5.1s, line 1 is in lead-out until 6.0, line 2 started at 5.0.
      // Regardless of which line is activeLineIndex, whichever line is rendered as currentLine
      // MUST have 100% illumination since effectiveTime >= start_time for both!
      rerender(<LyricDisplay lines={contiguousLines} currentTime={5.1} syncMode="line" />);
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toBeInTheDocument();
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(100);
    });
  });

  // =========================================================================
  // Section 2: Seek Clicks in Line Mode
  // =========================================================================
  describe('Interactive Word Seek Clicks in Line Mode', () => {
    it('ADV-2.1: Clicking any word in 100% solid illuminated line dispatches correct start_time', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(
        <LyricDisplay
          lines={standardTestLines}
          currentTime={11.0}
          syncMode="line"
          onSeek={onSeek}
        />
      );

      // All 4 words are illuminated at 100%
      for (let i = 0; i < 4; i++) {
        expect(parseFloat(screen.getByTestId(`word-sung-${i}`).style.width)).toBe(100);
      }

      // Click word 0 ('First' at 10.0s)
      await user.click(screen.getByRole('button', { name: /word First/i }));
      expect(onSeek).toHaveBeenLastCalledWith(10.0);

      // Click word 2 ('fast' at 12.0s)
      await user.click(screen.getByRole('button', { name: /word fast/i }));
      expect(onSeek).toHaveBeenLastCalledWith(12.0);

      // Click word 3 ('opening' at 13.0s)
      await user.click(screen.getByRole('button', { name: /word opening/i }));
      expect(onSeek).toHaveBeenLastCalledWith(13.0);
    });

    it('ADV-2.2: Untimed line seek click triggers onSeek with line.start_time', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      const untimedLines: LyricLine[] = [
        {
          id: 101,
          text: 'Single block plain lyric without words',
          start_time: 7.5,
          end_time: 12.0,
          words: [],
        },
      ];

      render(
        <LyricDisplay lines={untimedLines} currentTime={9.0} syncMode="line" onSeek={onSeek} />
      );

      const lineButton = screen.getByRole('button', { name: /jump playback to line/i });
      await user.click(lineButton);
      expect(onSeek).toHaveBeenCalledWith(7.5);
    });

    it('ADV-2.3: Clicking words does not throw when onSeek prop is omitted', async () => {
      const user = userEvent.setup();
      render(<LyricDisplay lines={standardTestLines} currentTime={11.0} syncMode="line" />);

      const wordButton = screen.getByRole('button', { name: /word First/i });
      // Should execute cleanly without error
      await expect(user.click(wordButton)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Section 3: Rapid Mode Toggling & Non-Destructive Invariance
  // =========================================================================
  describe('Rapid Mode Toggling & Non-Destructive Timestamps', () => {
    it('ADV-3.1: 50 consecutive mode toggles preserve exact word timestamps without deviation', async () => {
      const user = userEvent.setup();
      const originalLinesJson = JSON.stringify(standardTestLines);

      // Harness component managing mode toggle
      const ToggleHarness = () => {
        const [mode, setMode] = useState<SyncDisplayMode>('word');
        return (
          <div>
            <span data-testid="current-mode">{mode}</span>
            <LyricDisplay
              lines={standardTestLines}
              currentTime={11.5}
              syncMode={mode}
              onSyncModeChange={setMode}
            />
          </div>
        );
      };

      render(<ToggleHarness />);

      for (let i = 0; i < 50; i++) {
        const expected = i % 2 === 0 ? 'line' : 'word';
        await user.click(screen.getByTestId(`sync-mode-${expected}`));
        expect(screen.getByTestId('current-mode')).toHaveTextContent(expected);
      }

      // After 50 toggles, test lines must be bit-for-bit identical to original
      expect(JSON.stringify(standardTestLines)).toBe(originalLinesJson);
    });

    it('ADV-3.2: Fractional wipe state restores perfectly when switching word -> line -> word', () => {
      // At t = 11.4s, word 1 ('verse' [10.9 - 11.9]) duration is 1.0s, elapsed is 0.5s -> exactly 50%
      const { rerender } = render(
        <LyricDisplay lines={standardTestLines} currentTime={11.4} syncMode="word" />
      );

      const word1WordMode = screen.getByTestId('word-sung-1');
      expect(parseFloat(word1WordMode.style.width)).toBeCloseTo(50.0, 1);
      const word2WordMode = screen.getByTestId('word-sung-2');
      expect(parseFloat(word2WordMode.style.width)).toBe(0);

      // Toggle to line mode -> all words jump to 100%
      rerender(<LyricDisplay lines={standardTestLines} currentTime={11.4} syncMode="line" />);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-2').style.width)).toBe(100);

      // Toggle back to word mode -> word 1 restores back to exactly 50%, word 2 to 0%
      rerender(<LyricDisplay lines={standardTestLines} currentTime={11.4} syncMode="word" />);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBeCloseTo(50.0, 1);
      expect(parseFloat(screen.getByTestId('word-sung-2').style.width)).toBe(0);
    });
  });

  // =========================================================================
  // Section 4: Degenerate, Zero & Extreme Durations
  // =========================================================================
  describe('Degenerate Durations & Timing Extremes', () => {
    it('ADV-4.1: Line with zero duration words (start == end) does not produce NaN or Inf in line mode', () => {
      const zeroWordLines: LyricLine[] = [
        {
          id: 501,
          text: 'Zero duration hit',
          start_time: 5.0,
          end_time: 8.0,
          words: [
            { word: 'Zero', start_time: 5.0, end_time: 5.0 }, // 0 duration
            { word: 'duration', start_time: 5.0, end_time: 5.0 }, // 0 duration
            { word: 'hit', start_time: 5.0, end_time: 8.0 },
          ],
        },
      ];

      render(<LyricDisplay lines={zeroWordLines} currentTime={6.0} syncMode="line" />);
      for (let i = 0; i < 3; i++) {
        const word = screen.getByTestId(`word-sung-${i}`);
        expect(parseFloat(word.style.width)).toBe(100);
        expect(word.style.width).not.toContain('NaN');
        expect(word.style.width).not.toContain('Infinity');
        expect(word.style.clipPath).toBe('inset(0 0.00% 0 0)');
      }
    });

    it('ADV-4.2: High timestamp song (e.g. 10000s) executes accurately in line mode', () => {
      const highTimeLines: LyricLine[] = [
        {
          id: 999,
          text: 'Marathon concert finale',
          start_time: 10000.0,
          end_time: 10005.0,
          words: [
            { word: 'Marathon', start_time: 10000.0, end_time: 10002.0 },
            { word: 'concert', start_time: 10002.1, end_time: 10003.5 },
            { word: 'finale', start_time: 10003.6, end_time: 10005.0 },
          ],
        },
      ];

      // At 9999.0s: intro gap >= 4.0s is active, displaying countdown
      const { rerender } = render(
        <LyricDisplay lines={highTimeLines} currentTime={9999.0} syncMode="line" />
      );
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('gap-countdown-time')).toHaveTextContent('Next vocals in 1s');

      // At 10000.0s: exact onset, all words 100%
      rerender(<LyricDisplay lines={highTimeLines} currentTime={10000.0} syncMode="line" />);
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-2').style.width)).toBe(100);
      expect(screen.getByTestId('word-sung-0').style.clipPath).toBe('inset(0 0.00% 0 0)');
    });

    it('ADV-4.3: Empty lines array renders without crashing', () => {
      const { container } = render(<LyricDisplay lines={[]} currentTime={5.0} syncMode="line" />);
      expect(container).toBeInTheDocument();
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    });

    it('ADV-4.4: Line with whitespace or empty text renders safely', () => {
      const emptyTextLines: LyricLine[] = [
        {
          id: 888,
          text: '   ',
          start_time: 1.0,
          end_time: 4.0,
          words: [],
        },
      ];

      render(<LyricDisplay lines={emptyTextLines} currentTime={2.0} syncMode="line" />);
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Section 5: Duet Colors & Singer Role Resolution in Line Mode
  // =========================================================================
  describe('Duet Color & Singer Normalization in Line Mode', () => {
    it('ADV-5.1: Case-insensitive and alias singer normalization resolves to correct sung colors', () => {
      const duetLines: LyricLine[] = [
        {
          id: 1,
          text: 'Partner line',
          start_time: 2.0,
          end_time: 4.0,
          singer: '  PARTNER  ' as unknown as SingerRole,
          words: [{ word: 'Partner', start_time: 2.0, end_time: 4.0 }],
        },
        {
          id: 2,
          text: 'Both line',
          start_time: 10.0,
          end_time: 12.0,
          singer: 'UNISON' as unknown as SingerRole,
          words: [{ word: 'Both', start_time: 10.0, end_time: 12.0 }],
        },
        {
          id: 3,
          text: 'Unknown fallback line',
          start_time: 18.0,
          end_time: 20.0,
          singer: 'MysteryGuest' as unknown as SingerRole,
          words: [{ word: 'Unknown', start_time: 18.0, end_time: 20.0 }],
        },
      ];

      // PARTNER -> singer2 -> singer2SungColor (#ec4899)
      const { rerender } = render(
        <LyricDisplay
          lines={duetLines}
          currentTime={3.0}
          syncMode="line"
          singer2SungColor="#ec4899"
          bothSungColor="#10b981"
          themeSungColor="#facc15"
        />
      );
      expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'singer2');
      expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#ec4899' });

      // UNISON -> both -> bothSungColor (#10b981)
      rerender(
        <LyricDisplay
          lines={duetLines}
          currentTime={11.0}
          syncMode="line"
          singer2SungColor="#ec4899"
          bothSungColor="#10b981"
          themeSungColor="#facc15"
        />
      );
      expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'both');
      expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#10b981' });

      // MysteryGuest -> singer1 (fallback) -> themeSungColor (#facc15)
      rerender(
        <LyricDisplay
          lines={duetLines}
          currentTime={19.0}
          syncMode="line"
          singer2SungColor="#ec4899"
          bothSungColor="#10b981"
          themeSungColor="#facc15"
        />
      );
      expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'singer1');
      expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#facc15' });
    });

    it('ADV-5.2: Upcoming singer cue tag renders with matching color in line mode', () => {
      // At t = 11.0s, line 1 is active (Singer 1 Lead). Line 2 is upcoming (PARTNER / Singer 2).
      render(
        <LyricDisplay
          lines={standardTestLines}
          currentTime={11.0}
          syncMode="line"
          singer2SungColor="#ec4899"
        />
      );

      const nextTag = screen.getByTestId('next-singer-tag');
      expect(nextTag).toBeInTheDocument();
      expect(nextTag).toHaveAttribute('data-singer', 'singer2');
      expect(nextTag).toHaveTextContent('[Singer 2]');
      expect(nextTag).toHaveStyle({ color: '#ec4899' });
    });
  });

  // =========================================================================
  // Section 6: Fullscreen TV Stage Parity & Keyboard Shortcuts
  // =========================================================================
  describe('Fullscreen TV Stage Parity & Keyboard Navigation', () => {
    it('ADV-6.1: Stage toolbar switches sync mode in TV stage and updates data-sync-mode attribute', () => {
      const onSyncModeChange = vi.fn();
      render(
        <LyricDisplay
          lines={standardTestLines}
          currentTime={11.0}
          syncMode="word"
          onSyncModeChange={onSyncModeChange}
        />
      );

      // Enter fullscreen stage
      fireEvent.keyDown(window, { key: 'f' });
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      expect(stage).toHaveAttribute('data-sync-mode', 'word');

      // The toolbar highlight selector stays usable in TV stage mode
      const wordBtn = screen.getByTestId('sync-mode-word');
      expect(wordBtn).toHaveTextContent('Word');
      expect(wordBtn).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByTestId('sync-mode-line'));
      expect(onSyncModeChange).toHaveBeenCalledWith('line');
    });

    it('ADV-6.2: Fullscreen Stage does not capture "f" when user is typing in an input', () => {
      render(
        <div>
          <input data-testid="test-input" type="text" />
          <LyricDisplay lines={standardTestLines} currentTime={11.0} syncMode="line" />
        </div>
      );

      const input = screen.getByTestId('test-input');
      input.focus();
      fireEvent.keyDown(input, { key: 'f' });

      // Stage must NOT have entered fullscreen
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('ADV-6.3: Responsive geometry & zero horizontal overflow across breakpoints in Line Mode', () => {
      const breakpoints = [320, 375, 768, 1280];
      for (const width of breakpoints) {
        setTestViewport(width, 700);
        const { container, unmount } = render(
          <LyricDisplay lines={standardTestLines} currentTime={11.0} syncMode="line" />
        );
        assertZeroHorizontalOverflow(container, width);
        unmount();
      }
    });
  });

  // =========================================================================
  // Section 7: VisualThemePicker & Hook State
  // =========================================================================
  describe('Stage Toolbar & useVisualTheme Hook Stress', () => {
    it('ADV-7.1: Highlight selector falls back to onToggleSyncMode, then to internal state', () => {
      const onToggleSyncMode = vi.fn();
      const { unmount } = render(
        <LyricDisplay
          lines={standardTestLines}
          currentTime={11.0}
          syncMode="word"
          onToggleSyncMode={onToggleSyncMode}
        />
      );
      fireEvent.click(screen.getByTestId('sync-mode-line'));
      expect(onToggleSyncMode).toHaveBeenCalledTimes(1);
      unmount();

      // Uncontrolled stages keep their own mode
      render(<LyricDisplay lines={standardTestLines} currentTime={11.0} />);
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-sync-mode', 'word');
    });

    it('ADV-7.1b: The Look panel no longer renders its own highlight selector', () => {
      render(
        <VisualThemePicker
          selectedTheme={THEMES[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );
      expect(screen.queryByTestId('sync-mode-selector')).not.toBeInTheDocument();
    });

    it('ADV-7.2: document.documentElement receives data-sync-mode attribute matching hook state', () => {
      const { result } = renderHook(() => useVisualTheme());
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');

      act(() => {
        result.current.setSyncMode('line');
      });
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('line');

      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');
    });
  });

  // =========================================================================
  // Section 8: Export Modal & Subtitle Sync Mode Plumb
  // =========================================================================
  describe('Export Modal & Subtitle Section Verification', () => {
    const testProject: ProjectState = {
      id: 'proj_adv_test',
      status: 'ready',
      progress: 100,
      title: 'Adv Title',
      artist: 'Adv Artist',
      lines: standardTestLines,
      semitones: 0,
      guide_volume: 0,
      render_status: 'idle',
    };

    it('ADV-8.1: ExportModal passes sync_mode: "line" directly to POST /api/project/:id/render when onStartRender is omitted', async () => {
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'queued' }),
      } as Response);

      render(
        <ExportModal
          project={testProject}
          isOpen={true}
          onClose={vi.fn()}
          syncMode="line"
          aspectRatio="16:9"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      fireEvent.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/proj_adv_test/render',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"sync_mode":"line"'),
        })
      );
    });

    it('ADV-8.2: ExportSubtitleSection appends sync_mode=word when word mode is explicitly selected', async () => {
      const user = userEvent.setup();
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Export.ass"',
        }),
      } as unknown as Response);

      render(
        <ExportSubtitleSection
          project={testProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="word"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/project/proj_adv_test/export/ass')
      );
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('sync_mode=word');
    });
  });
});
