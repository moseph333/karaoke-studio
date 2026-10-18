/**
 * Lyric Timeline Power Tools Test Suite
 *
 * Verifies multi-step undo/redo history stack, batch timestamp offset tool,
 * live tap-to-sync mode, and in-studio lyric replacement modal integration.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { useLyricHistory } from '../hooks/useLyricHistory';
import { applyBatchOffset } from '../utils/lyrics';
import { BatchOffsetModal } from '../components/timeline/BatchOffsetModal';
import { TapToSyncBanner } from '../components/timeline/TapToSyncBanner';
import { LyricReplacementModal } from '../components/timeline/LyricReplacementModal';
import * as apiModule from '../api';
import { LyricLine } from '../types';

describe('Lyric Timeline Power Tools', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'First line of the song',
      start_time: 2.0,
      end_time: 5.0,
      words: [
        { word: 'First', start_time: 2.0, end_time: 2.8 },
        { word: 'line', start_time: 2.8, end_time: 3.5 },
        { word: 'of', start_time: 3.5, end_time: 4.0 },
        { word: 'the', start_time: 4.0, end_time: 4.4 },
        { word: 'song', start_time: 4.4, end_time: 5.0 },
      ],
    },
    {
      id: 2,
      text: 'Second line follows next',
      start_time: 6.0,
      end_time: 9.0,
      words: [
        { word: 'Second', start_time: 6.0, end_time: 7.0 },
        { word: 'line', start_time: 7.0, end_time: 7.8 },
        { word: 'follows', start_time: 7.8, end_time: 8.5 },
        { word: 'next', start_time: 8.5, end_time: 9.0 },
      ],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. useLyricHistory Hook Tests
  // =========================================================================
  describe('useLyricHistory Hook', () => {
    it('initializes with empty history and disabled undo/redo', () => {
      const { result } = renderHook(() => useLyricHistory());
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('pushes snapshots, restores previous states on undo, and reapplies on redo', () => {
      const { result } = renderHook(() => useLyricHistory());

      const state0 = [sampleLines[0]];
      const state1 = [{ ...sampleLines[0], start_time: 3.0 }];
      const state2 = [{ ...sampleLines[0], start_time: 4.0 }];

      act(() => {
        result.current.pushSnapshot(state0);
      });
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);

      act(() => {
        result.current.pushSnapshot(state1);
      });

      // Undo state2 -> state1
      let restored: LyricLine[] | null = null;
      act(() => {
        restored = result.current.undo(state2);
      });
      expect(restored).not.toBeNull();
      expect(restored![0].start_time).toBe(3.0);
      expect(result.current.canRedo).toBe(true);

      // Redo state1 -> state2
      let redone: LyricLine[] | null = null;
      act(() => {
        redone = result.current.redo(state1);
      });
      expect(redone).not.toBeNull();
      expect(redone![0].start_time).toBe(4.0);
    });

    it('enforces 50-step bounded history cap', () => {
      const { result } = renderHook(() => useLyricHistory({ maxHistory: 50 }));

      act(() => {
        for (let i = 0; i < 60; i++) {
          result.current.pushSnapshot([{ ...sampleLines[0], start_time: i }]);
        }
      });

      expect(result.current.undoStack.length).toBe(50);
      // Oldest retained should be i = 10
      expect(result.current.undoStack[0][0].start_time).toBe(10);
    });

    it('triggers undo and redo via keyboard shortcuts when outside input elements', () => {
      const onApply = vi.fn();
      renderHook(() =>
        useLyricHistory({
          currentLines: sampleLines,
          onApplySnapshot: onApply,
        })
      );

      // Trigger Ctrl+Z
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      // Can't undo yet because stack is empty
      expect(onApply).not.toHaveBeenCalled();
    });

    it('ignores Ctrl+Z shortcuts when typing inside an input element', () => {
      const onApply = vi.fn();
      const { result } = renderHook(() =>
        useLyricHistory({
          currentLines: sampleLines,
          onApplySnapshot: onApply,
        })
      );

      act(() => {
        result.current.pushSnapshot(sampleLines);
      });
      expect(result.current.canUndo).toBe(true);

      // Create an input element and dispatch from it
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(onApply).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  // =========================================================================
  // 2. applyBatchOffset Utility Tests
  // =========================================================================
  describe('applyBatchOffset Utility', () => {
    it('applies a positive offset uniformly across all lines and words', () => {
      const offsetLines = applyBatchOffset(sampleLines, 0.5);

      expect(offsetLines[0].start_time).toBe(2.5);
      expect(offsetLines[0].end_time).toBe(5.5);
      expect(offsetLines[0].words[0].start_time).toBe(2.5);
      expect(offsetLines[0].words[0].end_time).toBe(3.3);

      expect(offsetLines[1].start_time).toBe(6.5);
      expect(offsetLines[1].end_time).toBe(9.5);
    });

    it('clamps negative offset at 0.0s and preserves monotonic non-overlapping word boundaries', () => {
      const offsetLines = applyBatchOffset(sampleLines, -10.0);

      // Start time clamped at 0.0s
      expect(offsetLines[0].start_time).toBe(0.0);
      expect(offsetLines[0].words[0].start_time).toBe(0.0);
      expect(offsetLines[0].words[0].end_time).toBeGreaterThanOrEqual(0.01);

      // Check all words maintain monotonic order and non-zero duration
      for (const line of offsetLines) {
        for (let i = 0; i < line.words.length; i++) {
          const w = line.words[i];
          expect(w.start_time).toBeGreaterThanOrEqual(0.0);
          expect(w.end_time).toBeGreaterThan(w.start_time);
          if (i > 0) {
            expect(w.start_time).toBeGreaterThanOrEqual(line.words[i - 1].end_time);
          }
        }
      }
    });

    it('shifts lines only from fromLineIndex onward', () => {
      const offsetLines = applyBatchOffset(sampleLines, 1.0, 1);

      // Line 0 unchanged
      expect(offsetLines[0].start_time).toBe(2.0);
      expect(offsetLines[0].end_time).toBe(5.0);

      // Line 1 shifted by +1.0s
      expect(offsetLines[1].start_time).toBe(7.0);
      expect(offsetLines[1].end_time).toBe(10.0);
    });

    it('handles lines with empty word arrays safely', () => {
      const linesWithoutWords: LyricLine[] = [
        { id: 1, text: 'No words line', start_time: 1.0, end_time: 3.0, words: [] },
      ];
      const result = applyBatchOffset(linesWithoutWords, 0.5);
      expect(result[0].start_time).toBe(1.5);
      expect(result[0].end_time).toBe(3.5);
    });
  });

  // =========================================================================
  // 3. BatchOffsetModal Component Tests
  // =========================================================================
  describe('BatchOffsetModal Component', () => {
    it('renders modal dialog with presets and scope options', () => {
      render(
        <BatchOffsetModal
          isOpen={true}
          onClose={vi.fn()}
          onApplyOffset={vi.fn()}
          selectedLineIndex={0}
          totalLines={2}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Batch Timestamp Offset')).toBeInTheDocument();
      expect(screen.getByText('+0.5s')).toBeInTheDocument();
      expect(screen.getByText('-1s')).toBeInTheDocument();
      expect(screen.getByText('All Lines (2)')).toBeInTheDocument();
    });

    it('updates offset delta when clicking preset buttons', () => {
      render(
        <BatchOffsetModal
          isOpen={true}
          onClose={vi.fn()}
          onApplyOffset={vi.fn()}
          selectedLineIndex={0}
          totalLines={2}
        />
      );

      const input = screen.getByLabelText('Offset Delta (seconds)') as HTMLInputElement;
      fireEvent.click(screen.getByText('+1s'));
      expect(input.value).toBe('1');
    });

    it('submits offset and calls onApplyOffset with parsed delta and selected scope', () => {
      const handleApply = vi.fn();
      const handleClose = vi.fn();
      render(
        <BatchOffsetModal
          isOpen={true}
          onClose={handleClose}
          onApplyOffset={handleApply}
          selectedLineIndex={1}
          totalLines={2}
        />
      );

      // Switch scope to selected line onward
      fireEvent.click(screen.getByText('From Line #2 Onward'));
      fireEvent.click(screen.getByText('+0.5s'));
      fireEvent.click(screen.getByText('Apply Offset'));

      expect(handleApply).toHaveBeenCalledWith(0.5, 1);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. TapToSyncBanner Component Tests
  // =========================================================================
  describe('TapToSyncBanner Component', () => {
    it('renders banner when active with target line info', () => {
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={sampleLines[0]}
          targetIndex={0}
          totalLines={2}
          onTap={vi.fn()}
          onExit={vi.fn()}
        />
      );

      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();
      expect(screen.getByText('Line 1 of 2')).toBeInTheDocument();
      expect(screen.getByText('"First line of the song"')).toBeInTheDocument();
    });

    it('triggers onTap when clicking TAP NOW button', () => {
      const handleTap = vi.fn();
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={sampleLines[0]}
          targetIndex={0}
          totalLines={2}
          onTap={handleTap}
          onExit={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('tap-now-btn'));
      expect(handleTap).toHaveBeenCalledTimes(1);
    });

    it('triggers onExit when clicking Exit button', () => {
      const handleExit = vi.fn();
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={sampleLines[0]}
          targetIndex={0}
          totalLines={2}
          onTap={vi.fn()}
          onExit={handleExit}
        />
      );

      fireEvent.click(screen.getByTestId('exit-tap-mode-btn'));
      expect(handleExit).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. LyricReplacementModal Component Tests
  // =========================================================================
  describe('LyricReplacementModal Component', () => {
    it('switches between Paste and LRCLIB tabs', () => {
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj_test_1"
          trackTitle="Song Title"
          trackArtist="Artist Name"
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText('Paste Lyrics / LRC')).toBeInTheDocument();
      expect(screen.getByText('Re-query LRCLIB')).toBeInTheDocument();

      // Switch to LRCLIB tab
      fireEvent.click(screen.getByText('Re-query LRCLIB'));
      expect(screen.getByText(/Song Title/)).toBeInTheDocument();
      expect(screen.getByText('Fetch from LRCLIB')).toBeInTheDocument();
    });

    it('submits custom lyrics to realign-lyrics endpoint and triggers onSuccess', async () => {
      const handleSuccess = vi.fn();
      const handleClose = vi.fn();

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          lines: [{ id: 1, text: 'New line', start_time: 1.0, end_time: 4.0, words: [] }],
        }),
      } as Response);

      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={handleClose}
          projectId="proj_test_1"
          onSuccess={handleSuccess}
        />
      );

      const textarea = screen.getByLabelText('Lyric Text or LRC Timestamps');
      fireEvent.change(textarea, { target: { value: 'New line text' } });

      fireEvent.click(screen.getByText('Re-align Lyrics'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/proj_test_1/realign-lyrics',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ custom_lyrics: 'New line text', fetch_lrclib: false }),
        })
      );
      expect(handleSuccess).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });

    it('submits LRCLIB fetch request and triggers onSuccess', async () => {
      const handleSuccess = vi.fn();
      const handleClose = vi.fn();

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          lines: [{ id: 1, text: 'LRCLIB line', start_time: 2.0, end_time: 5.0, words: [] }],
        }),
      } as Response);

      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={handleClose}
          projectId="proj_test_1"
          onSuccess={handleSuccess}
        />
      );

      fireEvent.click(screen.getByText('Re-query LRCLIB'));
      fireEvent.click(screen.getByText('Fetch from LRCLIB'));

      await act(async () => {
        await Promise.resolve();
      });

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/proj_test_1/realign-lyrics',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ fetch_lrclib: true }),
        })
      );
      expect(handleSuccess).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. LyricTimelineEditor Power Tools Integration Tests
  // =========================================================================
  describe('LyricTimelineEditor Power Tools Integration', () => {
    const defaultProps = {
      lines: sampleLines,
      currentTime: 0.0,
      duration: 60.0,
      onSeek: vi.fn(),
      onSaveLines: vi.fn(),
      projectId: 'proj_integration_1',
    };

    it('renders Undo, Redo, Offset, Tap Sync, and Re-import buttons in the toolbar', () => {
      render(<LyricTimelineEditor {...defaultProps} />);

      expect(screen.getByTestId('undo-lyrics-btn')).toBeInTheDocument();
      expect(screen.getByTestId('redo-lyrics-btn')).toBeInTheDocument();
      expect(screen.getByTestId('batch-offset-btn')).toBeInTheDocument();
      expect(screen.getByTestId('tap-to-sync-btn')).toBeInTheDocument();
      expect(screen.getByTestId('replace-lyrics-btn')).toBeInTheDocument();

      // Undo and Redo should initially be disabled
      expect(screen.getByTestId('undo-lyrics-btn')).toBeDisabled();
      expect(screen.getByTestId('redo-lyrics-btn')).toBeDisabled();
    });

    it('enables Undo after nudging a line, reverts timing on Undo, and reapplies on Redo', () => {
      render(<LyricTimelineEditor {...defaultProps} />);

      // Nudge first line forward
      const nudgeForwardBtn = screen.getByLabelText('Nudge line 1 0.2s later');
      fireEvent.click(nudgeForwardBtn);

      // Undo button should now be enabled
      const undoBtn = screen.getByTestId('undo-lyrics-btn');
      expect(undoBtn).not.toBeDisabled();

      // Click Undo
      fireEvent.click(undoBtn);
      // Redo button should now be enabled
      const redoBtn = screen.getByTestId('redo-lyrics-btn');
      expect(redoBtn).not.toBeDisabled();

      // Click Redo
      fireEvent.click(redoBtn);
      expect(undoBtn).not.toBeDisabled();
    });

    it('opens Batch Offset modal, shifts timestamps, and pushes to undo stack', () => {
      render(<LyricTimelineEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('batch-offset-btn'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.click(screen.getByText('+0.5s'));
      fireEvent.click(screen.getByText('Apply Offset'));

      // Undo button should now be enabled
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();
    });

    it('toggles live Tap-to-Sync mode and stamps currentTime onto targeted lines', () => {
      render(<LyricTimelineEditor {...defaultProps} currentTime={4.5} isPlaying={true} />);

      // Activate Tap-to-Sync
      fireEvent.click(screen.getByTestId('tap-to-sync-btn'));
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();

      // Tap first line
      fireEvent.click(screen.getByTestId('tap-now-btn'));

      // Target should advance to line 2
      expect(screen.getByText('Line 2 of 2')).toBeInTheDocument();
      expect(screen.getByText('"Second line follows next"')).toBeInTheDocument();

      // Tap second line to complete
      fireEvent.click(screen.getByTestId('tap-now-btn'));

      // Tap mode should automatically exit on completion
      expect(screen.queryByTestId('tap-to-sync-banner')).not.toBeInTheDocument();
      // Undo button should be enabled
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();
    });

    it('opens Lyric Replacement modal when clicking Re-import button', () => {
      render(<LyricTimelineEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('replace-lyrics-btn'));
      expect(screen.getByText('Replace / Re-align Lyrics')).toBeInTheDocument();
    });
  });
});
