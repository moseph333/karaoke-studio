import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../../components/LyricDisplay';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { getStageLook } from '../../theme/stageLooks';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { ExportSubtitleSection } from '../../components/export/ExportSubtitleSection';
import { ExportModal } from '../../components/ExportModal';
import { LyricLine, ProjectState } from '../../types';
import * as apiModule from '../../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

// KTV draws the words as the lyrics write them and keeps each line in a row of its own
const KTV = getStageLook('ktv');

/** The element that carries a row's colour. */
const ink = (row: HTMLElement) => row.querySelector('.ks-words') as HTMLElement;

/** A line being sung as the stage draws it, row by row (each word is drawn twice: once to
 * sing, once sung). */
const drawn = (line: number) =>
  Array.from(document.querySelectorAll(`[data-role="lyric"][data-line="${line}"]`), (row) =>
    Array.from(
      row.querySelectorAll('.ks-word > span:first-child'),
      (word) => word.textContent
    ).join('')
  ).join(' ');

const sizeOf = (row: HTMLElement) => Number(row.style.getPropertyValue('--size'));

describe('Milestone M1: Line-by-Line Lyric Synchronization Display Mode', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'First verse singing line',
      start_time: 4.0,
      end_time: 7.0,
      singer: 'singer1',
      words: [
        { word: 'First', start_time: 4.0, end_time: 4.6 },
        { word: 'verse', start_time: 4.7, end_time: 5.4 },
        { word: 'singing', start_time: 5.5, end_time: 6.2 },
        { word: 'line', start_time: 6.3, end_time: 7.0 },
      ],
    },
    {
      id: 2,
      text: 'Second duet partner chorus',
      start_time: 12.0, // 5.0s instrumental gap between 7.0 and 12.0
      end_time: 15.0,
      singer: 'singer2',
      words: [
        { word: 'Second', start_time: 12.0, end_time: 12.6 },
        { word: 'duet', start_time: 12.7, end_time: 13.3 },
        { word: 'partner', start_time: 13.4, end_time: 14.1 },
        { word: 'chorus', start_time: 14.2, end_time: 15.0 },
      ],
    },
    {
      id: 3,
      text: 'Both singers in unison finale',
      start_time: 16.0,
      end_time: 19.0,
      singer: 'both',
      words: [
        { word: 'Both', start_time: 16.0, end_time: 16.5 },
        { word: 'singers', start_time: 16.6, end_time: 17.2 },
        { word: 'in', start_time: 17.3, end_time: 17.6 },
        { word: 'unison', start_time: 17.7, end_time: 18.3 },
        { word: 'finale', start_time: 18.4, end_time: 19.0 },
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
  // Tier 1: Base Feature Tests (F1 to F6)
  // =========================================================================
  describe('Tier 1: Core Functional Verification', () => {
    it('T1.1: Default mode verification - LyricDisplay defaults to "word" sweep mode when syncMode prop is omitted', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.3} />);
      // At t=4.3, word 0 ('First' [4.0-4.6]) is at 50% progress in default word mode
      const word0 = screen.getByTestId('word-sung-0');
      const widthVal = parseFloat(word0.style.width);
      expect(widthVal).toBeGreaterThan(0);
      expect(widthVal).toBeLessThan(100);

      // Subsequent word 1 ('verse' [4.7-5.4]) has not started yet
      const word1 = screen.getByTestId('word-sung-1');
      expect(parseFloat(word1.style.width)).toBe(0);
    });

    it('T1.2: Instant full-line highlight - In "line" mode, all words illuminate at 100% width and 0% clipPath at t >= start_time', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.3} syncMode="line" />);

      // All 4 words in the active line should immediately be 100% sung
      sampleLines[0].words.forEach((w, idx) => {
        const wordSpan = screen.getByTestId(`word-sung-${idx}`);
        expect(parseFloat(wordSpan.style.width)).toBe(100);
        expect(wordSpan.style.clipPath).toBe('inset(0 0.00% 0 0)');
      });
    });

    it('T1.3: User toggle controls - Stage toolbar highlight selector triggers onSyncModeChange', async () => {
      const user = userEvent.setup();
      const onSyncModeChange = vi.fn();
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.3}
          syncMode="word"
          onSyncModeChange={onSyncModeChange}
        />
      );

      const selector = screen.getByTestId('sync-mode-selector');
      expect(selector).toHaveAttribute('role', 'group');
      const wordBtn = within(selector).getByRole('button', { name: 'Word sweep highlight' });
      const lineBtn = within(selector).getByRole('button', { name: 'Line highlight' });
      expect(wordBtn).toHaveAttribute('aria-pressed', 'true');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'false');

      // Re-selecting the active mode is a no-op
      await user.click(wordBtn);
      expect(onSyncModeChange).not.toHaveBeenCalled();

      await user.click(lineBtn);
      expect(onSyncModeChange).toHaveBeenCalledWith('line');
    });

    it('T1.4: Word seek interactivity - Clicking word button in line mode still invokes onSeek with word start_time', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(
        <LyricDisplay lines={sampleLines} currentTime={4.3} syncMode="line" onSeek={onSeek} />
      );

      const verseWordBtn = screen.getByRole('button', { name: /jump playback to word verse/i });
      await user.click(verseWordBtn);
      expect(onSeek).toHaveBeenCalledWith(4.7);
    });

    it('T1.5: Fullscreen TV Stage Mode parity - Solid line highlight renders identically in fullscreen stage mode', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      // Enter fullscreen stage mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Every word in active line is 100% illuminated in stage mode
      sampleLines[0].words.forEach((_, idx) => {
        const wordSpan = screen.getByTestId(`word-sung-${idx}`);
        expect(parseFloat(wordSpan.style.width)).toBe(100);
        expect(wordSpan.style.clipPath).toBe('inset(0 0.00% 0 0)');
      });

      // The stage toolbar (with its highlight selector) stays available in stage mode
      expect(screen.getAllByTestId('sync-mode-selector')).toHaveLength(1);
      expect(screen.getByTestId('sync-mode-line')).toHaveAttribute('aria-pressed', 'true');
    });

    it('T1.6: Non-destructive mode toggling - Toggling between "word" and "line" leaves word timestamps untouched', () => {
      const linesCopy = JSON.parse(JSON.stringify(sampleLines));
      const { rerender } = render(
        <LyricDisplay lines={linesCopy} currentTime={4.5} syncMode="word" />
      );

      // Switch to line mode
      rerender(<LyricDisplay lines={linesCopy} currentTime={4.5} syncMode="line" />);
      expect(linesCopy[0].words[0].start_time).toBe(4.0);
      expect(linesCopy[0].words[0].end_time).toBe(4.6);

      // Switch back to word mode
      rerender(<LyricDisplay lines={linesCopy} currentTime={4.5} syncMode="word" />);
      expect(linesCopy[0].words[0].start_time).toBe(4.0);
      expect(linesCopy[0].words[0].end_time).toBe(4.6);
      expect(linesCopy[1].words[2].start_time).toBe(13.4);
    });
  });

  // =========================================================================
  // Tier 2: Boundary & Corner Cases
  // =========================================================================
  describe('Tier 2: Boundary Value Analysis & Edge Cases', () => {
    it('T2.1: Sub-millisecond lead-in (t = start_time - 0.001s) keeps active line words at 0% unsung state in line mode', () => {
      const leadInLines: LyricLine[] = [
        {
          id: 1,
          text: 'First verse singing line',
          start_time: 2.0,
          end_time: 5.0,
          words: [
            { word: 'First', start_time: 2.0, end_time: 2.6 },
            { word: 'verse', start_time: 2.7, end_time: 3.4 },
          ],
        },
      ];
      // Line 1 starts at 2.0s. At 1.999s the line is on stage, but singing hasn't begun.
      render(<LyricDisplay lines={leadInLines} currentTime={1.999} syncMode="line" />);
      const word0 = screen.getByTestId('word-sung-0');
      expect(parseFloat(word0.style.width)).toBe(0);
      expect(word0.style.clipPath).toBe('inset(0 100.00% 0 0)');
    });

    it('T2.2: Exact onset instant (t = start_time) immediately triggers 100% solid illumination across all words', () => {
      const onsetLines: LyricLine[] = [
        {
          id: 1,
          text: 'First verse singing line',
          start_time: 2.0,
          end_time: 5.0,
          words: [
            { word: 'First', start_time: 2.0, end_time: 2.6 },
            { word: 'verse', start_time: 2.7, end_time: 3.4 },
          ],
        },
      ];
      const { rerender } = render(
        <LyricDisplay lines={onsetLines} currentTime={1.99} syncMode="line" />
      );
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(0);

      // Cross boundary to exact start_time (2.0s)
      rerender(<LyricDisplay lines={onsetLines} currentTime={2.0} syncMode="line" />);
      onsetLines[0].words.forEach((_, idx) => {
        expect(parseFloat(screen.getByTestId(`word-sung-${idx}`).style.width)).toBe(100);
      });
    });

    it('T2.3: Intra-word midpoint comparison - Word sweep has partial widths, line mode has 100% across all words', () => {
      // t = 4.3 (midpoint of word 0)
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.3} syncMode="word" />
      );
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBeCloseTo(50, 0);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(0);

      // Now rerender with line mode
      rerender(<LyricDisplay lines={sampleLines} currentTime={4.3} syncMode="line" />);
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-1').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-2').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(100);
    });

    it('T2.4: Lead-out hold - Line remains 100% illuminated in line mode throughout the 1.2s lead-out interval', () => {
      // Line 1 ends at 7.0s and holds the stage until 8.2s.
      for (const t of [7.5, 8.19]) {
        const { unmount } = render(
          <LyricDisplay lines={sampleLines} currentTime={t} syncMode="line" />
        );
        expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '0');
        sampleLines[0].words.forEach((_, idx) => {
          expect(parseFloat(screen.getByTestId(`word-sung-${idx}`).style.width)).toBe(100);
        });
        unmount();
      }
    });

    it('T2.5: Lead-out release - Active line unmounts cleanly once effectiveTime reaches end_time + 1.2s', () => {
      // Line 1 ends at 7.0s. At 8.2s, it has unmounted; the next line is not sung until 12.0s.
      render(<LyricDisplay lines={sampleLines} currentTime={8.2} syncMode="line" />);
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
      expect(document.querySelector('[data-line="0"]')).toBeNull();
    });

    it('T2.6: Untimed plain lyrics resilience - Renders line text in solid sung color when words array is empty', () => {
      const untimedLines: LyricLine[] = [
        {
          id: 99,
          text: 'Plain untimed lyric without word timings',
          start_time: 2.0,
          end_time: 5.0,
          words: [],
        },
      ];

      const { rerender } = render(
        <LyricDisplay
          lines={untimedLines}
          currentTime={3.0}
          syncMode="line"
          themeSungColor="#fbbf24"
          selectedTheme={KTV}
        />
      );
      expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '0');
      expect(drawn(0)).toBe('Plain untimed lyric without word timings');
      for (let idx = 0; idx < 6; idx++) {
        const word = screen.getByTestId(`word-sung-${idx}`);
        expect(parseFloat(word.style.width)).toBe(100);
        expect(word).toHaveStyle({ color: '#fbbf24' });
      }

      // Without word timing the word sweep lights the whole line at once too
      rerender(
        <LyricDisplay
          lines={untimedLines}
          currentTime={3.0}
          syncMode="word"
          themeSungColor="#fbbf24"
          selectedTheme={KTV}
        />
      );
      expect(parseFloat(screen.getByTestId('word-sung-5').style.width)).toBe(100);
    });

    it('T2.7: Zero-duration word handling - Handled safely without NaN or infinite width', () => {
      const zeroDurLines: LyricLine[] = [
        {
          id: 50,
          text: 'Snap beat',
          start_time: 1.0,
          end_time: 3.0,
          words: [
            { word: 'Snap', start_time: 1.0, end_time: 1.0 }, // 0 dur
            { word: 'beat', start_time: 1.0, end_time: 2.5 },
          ],
        },
      ];

      render(<LyricDisplay lines={zeroDurLines} currentTime={1.5} syncMode="line" />);
      const word0 = screen.getByTestId('word-sung-0');
      expect(parseFloat(word0.style.width)).toBe(100);
      expect(word0.style.width).not.toContain('NaN');
    });

    it('T2.8: Single-word line renders 100% illuminated in line mode', () => {
      const singleWordLines: LyricLine[] = [
        {
          id: 1,
          text: 'Yeah!',
          start_time: 2.0,
          end_time: 4.0,
          words: [{ word: 'Yeah!', start_time: 2.0, end_time: 3.5 }],
        },
      ];

      render(<LyricDisplay lines={singleWordLines} currentTime={2.5} syncMode="line" />);
      const word0 = screen.getByTestId('word-sung-0');
      expect(parseFloat(word0.style.width)).toBe(100);
    });
  });

  // =========================================================================
  // Tier 3: Duets, Themes, Gaps & Component Integration
  // =========================================================================
  describe('Tier 3: Multi-Singer Duets, Themes & Gap Preservations', () => {
    it('T3.1: Singer 1 Lead line illuminates in themeSungColor under its part name in line mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          syncMode="line"
          themeSungColor="#fbbf24"
          selectedTheme={KTV}
        />
      );

      const name = screen.getByTestId('stage-part-name');
      expect(name).toHaveAttribute('data-line', '0');
      expect(name).toHaveTextContent('Singer 1');

      const sungSpan = screen.getByTestId('word-sung-0');
      expect(sungSpan).toHaveStyle({ color: '#fbbf24' });
      expect(parseFloat(sungSpan.style.width)).toBe(100);
    });

    it('T3.2: Singer 2 Partner line illuminates in singer2SungColor (#ec4899) under its part name in line mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.5}
          syncMode="line"
          singer2SungColor="#ec4899"
          selectedTheme={KTV}
        />
      );

      const name = screen.getByTestId('stage-part-name');
      expect(name).toHaveAttribute('data-line', '1');
      expect(name).toHaveTextContent('Singer 2');
      expect(ink(name)).toHaveStyle({ color: '#ec4899' });

      const sungSpan = screen.getByTestId('word-sung-0');
      expect(sungSpan).toHaveStyle({ color: '#ec4899' });
      expect(parseFloat(sungSpan.style.width)).toBe(100);
    });

    it('T3.3: Both / Duet line illuminates in bothSungColor (#10b981) under its part name in line mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={16.5}
          syncMode="line"
          bothSungColor="#10b981"
          selectedTheme={KTV}
        />
      );

      const name = screen.getByTestId('stage-part-name');
      expect(name).toHaveAttribute('data-line', '2');
      expect(name).toHaveTextContent('Both');
      expect(ink(name)).toHaveStyle({ color: '#10b981' });

      const sungSpan = screen.getByTestId('word-sung-0');
      expect(sungSpan).toHaveStyle({ color: '#10b981' });
      expect(parseFloat(sungSpan.style.width)).toBe(100);
    });

    it('T3.4: Upcoming line rendered below active line in a muted tone at a smaller size', () => {
      // The default look keeps the line to come under the one being sung
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      const activeLine = screen.getByTestId('active-lyrics-line');
      const upcomingLine = screen.getByTestId('stage-line');
      expect(upcomingLine).toHaveAttribute('data-role', 'next');
      expect(upcomingLine).toHaveTextContent('Second duet partner chorus');
      expect(ink(upcomingLine)).toHaveStyle({ color: getStageLook('marquee').palette.quiet });
      expect(sizeOf(upcomingLine)).toBeLessThan(sizeOf(activeLine));
      expect(Number(upcomingLine.style.getPropertyValue('--y'))).toBeGreaterThan(
        Number(activeLine.style.getPropertyValue('--y'))
      );
    });

    it('T3.5: Instrumental gap (>= 4.0s) counts in the next line in the matching singer color in line mode', () => {
      // Gap exists between Line 1 (ends at 7.0) and Line 2 (starts at 12.0) -> 5.0s gap
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={9.0}
          syncMode="line"
          singer2SungColor="#ec4899"
        />
      );

      const countIn = screen.getByTestId('stage-count-in');
      expect(countIn).toHaveTextContent(/^3$/);
      expect(countIn).toHaveAttribute('data-line', '1');
      expect(ink(countIn)).toHaveStyle({ color: '#ec4899' });
    });

    it('T3.6: 3-2-1 countdown cue dots appear in final 3 seconds before line start in line mode', () => {
      // Line 1 starts at 4.0s, after a gap; KTV counts in with dots, one going out each second
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={0.9} syncMode="line" selectedTheme={KTV} />
      );
      expect(screen.queryByTestId('stage-countin')).not.toBeInTheDocument();

      for (const [time, dots] of [
        [1.5, 3],
        [2.5, 2],
        [3.5, 1],
      ]) {
        rerender(
          <LyricDisplay
            lines={sampleLines}
            currentTime={time}
            syncMode="line"
            selectedTheme={KTV}
          />
        );
        expect(screen.getAllByTestId('stage-countin')).toHaveLength(dots);
      }
    });

    it('T3.7: Custom sung and unsung colors apply cleanly to line mode solid highlight', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          syncMode="line"
          themeSungColor="#00ffcc"
          themeUnsungColor="#333333"
        />
      );

      const sungSpan = screen.getByTestId('word-sung-0');
      expect(sungSpan).toHaveStyle({ color: '#00ffcc' });
      expect(parseFloat(sungSpan.style.width)).toBe(100);
    });

    it('T3.8: Font size scale adjustments scale active line in line mode', () => {
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" selectedTheme={KTV} />
      );
      const standard = sizeOf(screen.getByTestId('active-lyrics-line'));

      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          syncMode="line"
          selectedTheme={KTV}
          fontSizeScale={1.5}
        />
      );
      expect(sizeOf(screen.getByTestId('active-lyrics-line'))).toBeCloseTo(standard * 1.5, 5);
    });
  });

  // =========================================================================
  // Tier 4: Real-World Scenarios & Hook State Management
  // =========================================================================
  describe('Tier 4: Real-World Application Workflows & Responsive Verification', () => {
    it('T4.1: useVisualTheme hook manages syncMode, setSyncMode, and resets to "word" on resetThemeDefaults', () => {
      const { result } = renderHook(() => useVisualTheme());
      expect(result.current.syncMode).toBe('word');

      act(() => {
        result.current.setSyncMode('line');
      });
      expect(result.current.syncMode).toBe('line');

      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(result.current.syncMode).toBe('word');
    });

    it('T4.2: Highlight mode lives only in the stage toolbar, not in the Look panel', () => {
      const onSyncModeChange = vi.fn();
      render(
        <div>
          <VisualThemePicker
            selectedTheme={getStageLook('marquee')}
            onSelectTheme={vi.fn()}
            aspectRatio="16:9"
            onChangeAspectRatio={vi.fn()}
            onCustomBgUploaded={vi.fn()}
          />
          <LyricDisplay
            lines={sampleLines}
            currentTime={4.5}
            syncMode="word"
            onSyncModeChange={onSyncModeChange}
          />
        </div>
      );

      expect(screen.getAllByTestId('sync-mode-word')).toHaveLength(1);
      const wordBtn = screen.getByTestId('sync-mode-word');
      const lineBtn = screen.getByTestId('sync-mode-line');
      expect(wordBtn).toHaveAttribute('aria-pressed', 'true');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(lineBtn);
      expect(onSyncModeChange).toHaveBeenCalledWith('line');
    });

    it('T4.3: Fullscreen TV Stage navigation - Keyboard F enters stage, floating control toggles sync mode, Esc exits stage', () => {
      const onSyncModeChange = vi.fn();
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          syncMode="word"
          onSyncModeChange={onSyncModeChange}
        />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Press 'f' to enter stage mode
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Switch the highlight mode from the stage toolbar while in stage mode
      fireEvent.click(screen.getByTestId('sync-mode-line'));
      expect(onSyncModeChange).toHaveBeenCalledWith('line');

      // Press 'Escape' to exit stage mode
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('T4.4: Zero horizontal overflow at Mobile Small (320px) viewport in line mode', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('T4.5: Full user studio playback scenario - Seeks between lines while toggling modes cleanly', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.2} syncMode="word" onSeek={onSeek} />
      );

      // Verify word mode partial wipe at 4.2
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBeGreaterThan(0);

      // User toggles to line mode
      rerender(
        <LyricDisplay lines={sampleLines} currentTime={4.2} syncMode="line" onSeek={onSeek} />
      );
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(100);

      // User clicks word 'line' to seek
      const lineWordBtn = screen.getByRole('button', { name: /jump playback to word line/i });
      await user.click(lineWordBtn);
      expect(onSeek).toHaveBeenCalledWith(6.3);

      // Rerender at seek position in line mode
      rerender(
        <LyricDisplay lines={sampleLines} currentTime={6.3} syncMode="line" onSeek={onSeek} />
      );
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);

      // User switches back to word mode -> word sweep restored without corruption
      rerender(
        <LyricDisplay lines={sampleLines} currentTime={6.3} syncMode="word" onSeek={onSeek} />
      );
      // At 6.3, words 0, 1, 2 are 100%, word 3 starts at 6.3 (0%)
      expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
      expect(parseFloat(screen.getByTestId('word-sung-3').style.width)).toBe(0);
    });
  });

  // =========================================================================
  // Tier 5: Export Subtitle & Video Integration Tests
  // =========================================================================
  describe('Tier 5: Export Subtitle & Video Modal Integration', () => {
    const mockProject: ProjectState = {
      id: 'proj_sync_export_test',
      status: 'ready',
      progress: 100,
      title: 'Sync Test Song',
      artist: 'Sync Artist',
      lines: sampleLines,
      semitones: 0,
      guide_volume: 0,
    };

    it('T5.1: ExportSubtitleSection appends sync_mode=line to .ass export URL when line mode is active', async () => {
      const user = userEvent.setup();
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS Content'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Export.ass"',
        }),
      } as unknown as Response);

      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={getStageLook('marquee')}
          aspectRatio="16:9"
          syncMode="line"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/project/proj_sync_export_test/export/ass')
      );
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('sync_mode=line');
    });

    it('T5.2: ExportSubtitleSection subtitle sync mode buttons toggle between word and line', async () => {
      const user = userEvent.setup();
      const onSyncModeChange = vi.fn();
      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={getStageLook('marquee')}
          aspectRatio="16:9"
          syncMode="word"
          onSyncModeChange={onSyncModeChange}
        />
      );

      const lineBtn = screen.getByTestId('subtitle-sync-mode-line');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'false');

      await user.click(lineBtn);
      expect(onSyncModeChange).toHaveBeenCalledWith('line');
    });

    it('T5.3: ExportModal includes syncMode: "line" in onStartRender callback when line mode is selected', async () => {
      const user = userEvent.setup();
      const onStartRender = vi.fn();
      const idleProject: ProjectState = {
        ...mockProject,
        render_status: 'idle',
        video_url: undefined,
      };

      render(
        <ExportModal
          project={idleProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRender}
          syncMode="line"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
      await user.click(renderBtn);

      expect(onStartRender).toHaveBeenCalledWith({
        includeVisualizer: false,
        includeCountdown: true,
        syncMode: 'line',
      });
    });

    it('T5.4: ExportModal toggles video sync mode using export-sync-mode-selector', async () => {
      const user = userEvent.setup();
      const onSyncModeChange = vi.fn();
      const idleProject: ProjectState = {
        ...mockProject,
        render_status: 'idle',
        video_url: undefined,
      };

      render(
        <ExportModal
          project={idleProject}
          isOpen={true}
          onClose={vi.fn()}
          syncMode="word"
          onSyncModeChange={onSyncModeChange}
        />
      );

      const lineBtn = screen.getByTestId('export-sync-mode-line');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'false');

      await user.click(lineBtn);
      expect(onSyncModeChange).toHaveBeenCalledWith('line');
    });
  });
});
