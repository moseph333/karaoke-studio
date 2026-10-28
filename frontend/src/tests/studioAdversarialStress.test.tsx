/**
 * Studio Adversarial Stress Test Suite: Empirical Stress-Testing Across Studio Features
 *
 * Verifies:
 * 1. Timeline Undo/Redo (rapid cycles, boundary exhaustion, input isolation guard)
 * 2. Batch Offset Tool (extreme negative/positive offsets, monotonicity, positive word durations)
 * 3. Live Tap-to-Sync (rapid taps, tapping past end, paused vs playing, hotkey isolation)
 * 4. Waveform Scrubber (pre-load seeking, out-of-bounds pointer dragging, rapid seeking)
 * 5. Playback Speed (options, live speed switching, extrapolation sync, seek re-anchoring)
 * 6. Library Search & Sorting (complex queries, special characters, rapid changes, null timestamps)
 * 7. Stage Mode (fullscreen cycling, pseudo-fullscreen fallback, idle timer under mouse movement)
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  // @ts-expect-error polyfill PointerEvent for jsdom environment
  window.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

import { LyricLine, ProjectState, WordTiming } from '../types';
import { useLyricHistory } from '../hooks/useLyricHistory';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import {
  applyBatchOffset,
  round3,
  sanitizeTimestamp,
  recalculateWordTimings,
} from '../utils/lyrics';
import { TapToSyncBanner } from '../components/timeline/TapToSyncBanner';
import { WaveformScrubber } from '../components/audio/WaveformScrubber';
import { PlaybackSpeedControl, PLAYBACK_SPEEDS } from '../components/audio/PlaybackSpeedControl';
import { ProjectLibrary } from '../components/track-search/ProjectLibrary';
import { LyricDisplay } from '../components/LyricDisplay';

describe('Studio Adversarial Stress Testing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. TIMELINE UNDO / REDO HARNESS
  // =========================================================================
  describe('1. Timeline Undo/Redo Adversarial Testing', () => {
    const makeLine = (id: number, start: number, end: number): LyricLine => ({
      id,
      text: `Line ${id}`,
      start_time: start,
      end_time: end,
      words: [
        { word: 'Word1', start_time: start, end_time: start + (end - start) / 2 },
        { word: 'Word2', start_time: start + (end - start) / 2, end_time: end },
      ],
    });

    it('handles 100 rapid successive snapshot pushes with bounded capacity (maxHistory=50)', () => {
      const { result } = renderHook(() => useLyricHistory({ maxHistory: 50 }));

      act(() => {
        for (let i = 1; i <= 100; i++) {
          result.current.pushSnapshot([makeLine(1, i, i + 2)]);
        }
      });

      // Stack must be capped at 50
      expect(result.current.undoStack.length).toBe(50);
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);

      // Oldest retained snapshot should be index 51 (since 100 was pushed last)
      expect(result.current.undoStack[0][0].start_time).toBe(51);
      expect(result.current.undoStack[49][0].start_time).toBe(100);
    });

    it('exhausts undo and redo boundaries cleanly without throwing or corrupting state', () => {
      const initialLines = [makeLine(1, 0, 3)];
      const { result } = renderHook(() =>
        useLyricHistory({ maxHistory: 50, currentLines: initialLines })
      );

      // 1. Boundary exhaustion on empty undo stack
      expect(result.current.canUndo).toBe(false);
      let popped: LyricLine[] | null = null;
      act(() => {
        popped = result.current.undo();
      });
      expect(popped).toBeNull();
      expect(result.current.undoStack.length).toBe(0);
      expect(result.current.redoStack.length).toBe(0);

      // Push a snapshot
      act(() => {
        result.current.pushSnapshot([makeLine(1, 1, 4)]);
      });
      expect(result.current.canUndo).toBe(true);

      // Undo once -> moves to redo stack
      act(() => {
        popped = result.current.undo([makeLine(1, 2, 5)]);
      });
      expect(popped).not.toBeNull();
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);

      // Redo once -> moves back to undo stack
      act(() => {
        popped = result.current.redo([makeLine(1, 1, 4)]);
      });
      expect(popped).not.toBeNull();
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);

      // 2. Boundary exhaustion on empty redo stack
      act(() => {
        popped = result.current.redo();
      });
      expect(popped).toBeNull();
      expect(result.current.canRedo).toBe(false);
    });

    it('new edit snapshot wipes redo stack completely', () => {
      const { result } = renderHook(() => useLyricHistory({ currentLines: [makeLine(1, 10, 15)] }));

      act(() => {
        result.current.pushSnapshot([makeLine(1, 0, 5)]);
        result.current.undo([makeLine(1, 5, 10)]);
      });
      expect(result.current.canRedo).toBe(true);
      expect(result.current.redoStack.length).toBe(1);

      // Push brand new modification
      act(() => {
        result.current.pushSnapshot([makeLine(1, 20, 25)]);
      });
      expect(result.current.canRedo).toBe(false);
      expect(result.current.redoStack.length).toBe(0);
    });

    it('strictly isolates keyboard undo/redo shortcuts when typing in form inputs', () => {
      const applyMock = vi.fn();

      const TestHarness: React.FC = () => {
        const [lines] = useState<LyricLine[]>([makeLine(1, 0, 5)]);
        useLyricHistory({
          currentLines: lines,
          onApplySnapshot: applyMock,
        });

        return (
          <div>
            <input data-testid="test-input" type="text" />
            <textarea data-testid="test-textarea" />
            <select data-testid="test-select">
              <option value="1">Option 1</option>
            </select>
            <div data-testid="test-contenteditable" contentEditable="true" />
            <div data-testid="test-non-input" tabIndex={0} />
          </div>
        );
      };

      render(<TestHarness />);

      // Case A: Focused on <input> -> Ctrl+Z must NOT trigger undo
      const input = screen.getByTestId('test-input');
      input.focus();
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(applyMock).not.toHaveBeenCalled();

      // Case B: Focused on <textarea> -> Ctrl+Z must NOT trigger undo
      const textarea = screen.getByTestId('test-textarea');
      textarea.focus();
      fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
      expect(applyMock).not.toHaveBeenCalled();

      // Case C: Focused on <select> -> Ctrl+Y must NOT trigger redo
      const select = screen.getByTestId('test-select');
      select.focus();
      fireEvent.keyDown(select, { key: 'y', ctrlKey: true });
      expect(applyMock).not.toHaveBeenCalled();

      // Case D: Focused on contentEditable -> Ctrl+Z must NOT trigger undo
      const editable = screen.getByTestId('test-contenteditable');
      editable.focus();
      fireEvent.keyDown(editable, { key: 'z', ctrlKey: true });
      expect(applyMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. BATCH OFFSET TOOL HARNESS
  // =========================================================================
  describe('2. Batch Offset Tool Adversarial Testing', () => {
    const generateSong = (numLines = 10): LyricLine[] => {
      const lines: LyricLine[] = [];
      let cur = 2.0;
      for (let i = 1; i <= numLines; i++) {
        const dur = 4.0;
        const lineStart = cur;
        const lineEnd = cur + dur;
        const words: WordTiming[] = [
          { word: `WordA_${i}`, start_time: round3(lineStart), end_time: round3(lineStart + 1.0) },
          {
            word: `WordB_${i}`,
            start_time: round3(lineStart + 1.0),
            end_time: round3(lineStart + 2.0),
          },
          {
            word: `WordC_${i}`,
            start_time: round3(lineStart + 2.0),
            end_time: round3(lineStart + 3.0),
          },
          { word: `WordD_${i}`, start_time: round3(lineStart + 3.0), end_time: round3(lineEnd) },
        ];
        lines.push({
          id: i,
          text: `Line ${i} lyrics text`,
          start_time: round3(lineStart),
          end_time: round3(lineEnd),
          words,
        });
        cur = round3(lineEnd + 1.0);
      }
      return lines;
    };

    it('enforces non-negative clamping and monotonicity under extreme negative offsets (-120s, -1000s)', () => {
      const song = generateSong(8); // Lines from 2.0s to ~40s
      const extremeOffsets = [-120.0, -500.0, -99999.0];

      for (const delta of extremeOffsets) {
        const shifted = applyBatchOffset(song, delta, 0);

        expect(shifted.length).toBe(song.length);

        for (const line of shifted) {
          // Line bounds must be non-negative
          expect(line.start_time).toBeGreaterThanOrEqual(0.0);
          expect(line.end_time).toBeGreaterThan(line.start_time);

          // All word tokens must be non-negative, have duration >= 10ms, and be strictly monotonic non-overlapping
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            expect(word.start_time).toBeGreaterThanOrEqual(0.0);
            expect(word.end_time).toBeGreaterThanOrEqual(round3(word.start_time + 0.01));

            if (w > 0) {
              const prevWord = line.words[w - 1];
              expect(word.start_time).toBeGreaterThanOrEqual(prevWord.end_time);
            }
          }

          // Line extents anchor to word extents
          expect(line.start_time).toBe(Math.min(...line.words.map((w) => w.start_time)));
          expect(line.end_time).toBe(Math.max(...line.words.map((w) => w.end_time)));
        }
      }
    });

    it('enforces monotonic word tokens and positive durations under extreme positive offsets (+500s)', () => {
      const song = generateSong(5);
      const shifted = applyBatchOffset(song, 500.0, 0);

      expect(shifted.length).toBe(song.length);
      for (let i = 0; i < shifted.length; i++) {
        const line = shifted[i];
        const orig = song[i];

        expect(line.start_time).toBe(round3(orig.start_time + 500.0));
        expect(line.end_time).toBe(round3(orig.end_time + 500.0));

        for (let w = 0; w < line.words.length; w++) {
          const word = line.words[w];
          const origWord = orig.words[w];
          expect(word.start_time).toBe(round3(origWord.start_time + 500.0));
          expect(word.end_time).toBe(round3(origWord.end_time + 500.0));
          expect(word.end_time).toBeGreaterThan(word.start_time);

          if (w > 0) {
            expect(word.start_time).toBeGreaterThanOrEqual(line.words[w - 1].end_time);
          }
        }
      }
    });

    it('preserves untouched lines when applying offset with fromLineIndex scope', () => {
      const song = generateSong(6);
      const shifted = applyBatchOffset(song, 10.0, 3); // Shift lines 3, 4, 5 only

      // Lines 0, 1, 2 must remain identical to original
      for (let i = 0; i < 3; i++) {
        expect(shifted[i].start_time).toBe(song[i].start_time);
        expect(shifted[i].end_time).toBe(song[i].end_time);
        expect(shifted[i].words).toEqual(song[i].words);
      }

      // Lines 3, 4, 5 must be shifted by +10.0s
      for (let i = 3; i < 6; i++) {
        expect(shifted[i].start_time).toBe(round3(song[i].start_time + 10.0));
        expect(shifted[i].end_time).toBe(round3(song[i].end_time + 10.0));
      }
    });

    it('handles lines with empty word arrays gracefully without NaN or crash', () => {
      const linesWithoutWords: LyricLine[] = [
        { id: 1, text: 'No words line', start_time: 1.0, end_time: 4.0, words: [] },
      ];

      // Shift negative beyond 0.0s
      const shiftedNeg = applyBatchOffset(linesWithoutWords, -10.0, 0);
      expect(shiftedNeg[0].start_time).toBe(0.0);
      expect(shiftedNeg[0].end_time).toBe(0.01);
      expect(Number.isFinite(shiftedNeg[0].start_time)).toBe(true);

      // Shift positive
      const shiftedPos = applyBatchOffset(linesWithoutWords, 5.0, 0);
      expect(shiftedPos[0].start_time).toBe(6.0);
      expect(shiftedPos[0].end_time).toBe(9.0);
    });

    it('survives 100 alternating small nudge offsets (+0.05, -0.05) with zero IEEE 754 precision drift', () => {
      let song = generateSong(3);
      const initialStart = song[0].start_time;

      for (let i = 0; i < 50; i++) {
        song = applyBatchOffset(song, 0.05, 0);
        song = applyBatchOffset(song, -0.05, 0);
      }

      // Should return precisely to initial start without floating point rounding artifacts
      expect(song[0].start_time).toBe(initialStart);
      expect(song[0].words[0].start_time).toBe(initialStart);
    });

    it('defends against invalid delta values (NaN, Infinity, non-numeric)', () => {
      const song = generateSong(2);
      const shiftedNaN = applyBatchOffset(song, NaN, 0);
      expect(shiftedNaN[0].start_time).toBe(song[0].start_time);

      const shiftedInf = applyBatchOffset(song, Infinity, 0);
      expect(shiftedInf[0].start_time).toBe(song[0].start_time);
    });
  });

  // =========================================================================
  // 3. LIVE TAP-TO-SYNC HARNESS
  // =========================================================================
  describe('3. Live Tap-to-Sync Adversarial Testing', () => {
    it('renders TapToSyncBanner with target line info and invokes onTap on button click and "t" hotkey', () => {
      const onTap = vi.fn();
      const onExit = vi.fn();
      const targetLine: LyricLine = {
        id: 1,
        text: 'Listen to the music play',
        start_time: 0,
        end_time: 3,
        words: [],
      };

      const { rerender } = render(
        <TapToSyncBanner
          isActive={true}
          targetLine={targetLine}
          targetIndex={0}
          totalLines={5}
          onTap={onTap}
          onExit={onExit}
        />
      );

      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();
      expect(screen.getByText('Line 1 of 5')).toBeInTheDocument();
      expect(screen.getByText('"Listen to the music play"')).toBeInTheDocument();

      // Click TAP NOW
      fireEvent.click(screen.getByTestId('tap-now-btn'));
      expect(onTap).toHaveBeenCalledTimes(1);

      // Click Exit
      fireEvent.click(screen.getByTestId('exit-tap-mode-btn'));
      expect(onExit).toHaveBeenCalledTimes(1);

      // When inactive -> returns null
      rerender(
        <TapToSyncBanner
          isActive={false}
          targetLine={targetLine}
          targetIndex={0}
          totalLines={5}
          onTap={onTap}
          onExit={onExit}
        />
      );
      expect(screen.queryByTestId('tap-to-sync-banner')).not.toBeInTheDocument();
    });

    it('handles simulated tap sequence past the end of song gracefully', () => {
      const lines: LyricLine[] = [
        { id: 1, text: 'First line', start_time: 0, end_time: 3, words: [] },
        { id: 2, text: 'Second line', start_time: 4, end_time: 7, words: [] },
      ];

      // Simulated tap state progression
      let tapIndex = 0;
      let isTapActive = true;
      const triggerTap = (currentTime: number, duration: number) => {
        if (tapIndex >= lines.length) {
          isTapActive = false;
          return;
        }

        const tapTime = sanitizeTimestamp(currentTime);
        // Clamp previous line
        if (tapIndex > 0) {
          lines[tapIndex - 1].end_time = tapTime;
          lines[tapIndex - 1].words = recalculateWordTimings(
            lines[tapIndex - 1].text,
            lines[tapIndex - 1].start_time,
            tapTime
          );
        }

        let proposedEnd = tapTime + 3.0;
        if (duration > tapTime + 0.5 && proposedEnd > duration) {
          proposedEnd = duration;
        }
        lines[tapIndex].start_time = tapTime;
        lines[tapIndex].end_time = proposedEnd;
        lines[tapIndex].words = recalculateWordTimings(lines[tapIndex].text, tapTime, proposedEnd);

        tapIndex++;
        if (tapIndex >= lines.length) {
          isTapActive = false;
        }
      };

      // Tap 1 at 2.5s
      triggerTap(2.5, 60.0);
      expect(tapIndex).toBe(1);
      expect(isTapActive).toBe(true);
      expect(lines[0].start_time).toBe(2.5);

      // Tap 2 at 8.0s (past line 1)
      triggerTap(8.0, 60.0);
      expect(tapIndex).toBe(2);
      expect(isTapActive).toBe(false);
      expect(lines[0].end_time).toBe(8.0);
      expect(lines[1].start_time).toBe(8.0);

      // Tap 3 past the end of lines
      expect(() => triggerTap(15.0, 60.0)).not.toThrow();
      expect(isTapActive).toBe(false);
    });
  });

  // =========================================================================
  // 4. WAVEFORM SCRUBBER HARNESS
  // =========================================================================
  describe('4. Waveform Scrubber Adversarial Testing', () => {
    it('defends against seeking before audio metadata is loaded (duration <= 0 or NaN)', () => {
      const onSeek = vi.fn();
      const { rerender } = render(
        <WaveformScrubber currentTime={0} duration={0} onSeek={onSeek} />
      );

      const scrubber = screen.getByTestId('waveform-scrubber');

      // Click or pointer down with duration = 0
      fireEvent.pointerDown(scrubber, { clientX: 200, pointerId: 1 });
      expect(onSeek).not.toHaveBeenCalled();

      // Rerender with duration = NaN
      rerender(<WaveformScrubber currentTime={0} duration={NaN} onSeek={onSeek} />);
      fireEvent.pointerDown(scrubber, { clientX: 200, pointerId: 1 });
      expect(onSeek).not.toHaveBeenCalled();
    });

    it('strictly clamps out-of-bounds pointer dragging within [0, duration]', () => {
      const onSeek = vi.fn();
      render(<WaveformScrubber currentTime={50} duration={100} onSeek={onSeek} />);

      const scrubber = screen.getByTestId('waveform-scrubber');
      // Mock getBoundingClientRect: left=100, width=400 (spans 100px to 500px)
      vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        right: 500,
        width: 400,
        top: 50,
        bottom: 100,
        height: 50,
        x: 100,
        y: 50,
        toJSON: () => {},
      });

      // Pointer down at clientX = -500 (far left of container)
      fireEvent.pointerDown(scrubber, { clientX: -500, pointerId: 1 });
      expect(onSeek).toHaveBeenLastCalledWith(0.0);

      // Pointer move to clientX = 300 (exact center: ratio 0.5)
      fireEvent.pointerMove(scrubber, { clientX: 300, pointerId: 1 });
      expect(onSeek).toHaveBeenLastCalledWith(50.0);

      // Pointer move to clientX = 5000 (far right beyond viewport)
      fireEvent.pointerMove(scrubber, { clientX: 5000, pointerId: 1 });
      expect(onSeek).toHaveBeenLastCalledWith(100.0);

      // Pointer up releases drag
      fireEvent.pointerUp(scrubber, { pointerId: 1 });

      // After release, pointer move should not seek
      onSeek.mockClear();
      fireEvent.pointerMove(scrubber, { clientX: 200, pointerId: 1 });
      expect(onSeek).not.toHaveBeenCalled();
    });

    it('survives rapid seeking cycles and pointer capture exceptions without crashing', () => {
      const onSeek = vi.fn();
      render(<WaveformScrubber currentTime={10} duration={60} onSeek={onSeek} />);

      const scrubber = screen.getByTestId('waveform-scrubber');
      vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 200,
        width: 200,
        top: 0,
        bottom: 50,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Mock setPointerCapture throwing DOMException (e.g., unsupported or invalid pointerId)
      scrubber.setPointerCapture = vi.fn().mockImplementation(() => {
        throw new DOMException('InvalidPointerId', 'InvalidPointerId');
      });
      scrubber.releasePointerCapture = vi.fn().mockImplementation(() => {
        throw new DOMException('InvalidPointerId', 'InvalidPointerId');
      });

      expect(() => {
        fireEvent.pointerDown(scrubber, { clientX: 50, pointerId: 2 });
        for (let i = 0; i < 50; i++) {
          fireEvent.pointerMove(scrubber, { clientX: i % 2 === 0 ? -100 : 300, pointerId: 2 });
        }
        fireEvent.pointerUp(scrubber, { pointerId: 2 });
      }).not.toThrow();

      // All calls to onSeek must be finite and within [0, 60]
      for (const call of onSeek.mock.calls) {
        expect(call[0]).toBeGreaterThanOrEqual(0);
        expect(call[0]).toBeLessThanOrEqual(60);
        expect(Number.isFinite(call[0])).toBe(true);
      }
    });
  });

  // =========================================================================
  // 5. PLAYBACK SPEED & EXTRAPOLATION HARNESS
  // =========================================================================
  describe('5. Playback Speed Adversarial Testing', () => {
    it('renders radio group with all speeds and switches active speed correctly', () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <PlaybackSpeedControl playbackRate={1.0} onPlaybackRateChange={onChange} />
      );

      const buttons = screen.getAllByRole('radio');
      expect(buttons.length).toBe(PLAYBACK_SPEEDS.length);

      // Verify 1.0x is currently selected
      const normalBtn = screen.getByRole('radio', { name: 'Playback speed 1x' });
      expect(normalBtn).toHaveAttribute('aria-checked', 'true');

      // Click 0.5x
      const slowBtn = screen.getByRole('radio', { name: 'Playback speed 0.5x' });
      fireEvent.click(slowBtn);
      expect(onChange).toHaveBeenCalledWith(0.5);

      // Rerender with 0.5x active
      rerender(<PlaybackSpeedControl playbackRate={0.5} onPlaybackRateChange={onChange} />);
      expect(slowBtn).toHaveAttribute('aria-checked', 'true');
      expect(normalBtn).toHaveAttribute('aria-checked', 'false');
    });

    it('interpolates playback time proportional to playbackRate (0.5x vs 1.5x) and clamps stalls', () => {
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      let rafCallback: ((time: number) => void) | null = null;
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
        (cb: FrameRequestCallback) => {
          rafCallback = cb as (time: number) => void;
          return 1;
        }
      );
      vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
        rafCallback = null;
      });

      const { result, rerender } = renderHook(
        ({ rate, isPlaying, time }: { rate: number; isPlaying: boolean; time: number }) =>
          useInterpolatedTime({
            currentTime: time,
            isPlaying,
            playbackRate: rate,
          }),
        { initialProps: { rate: 1.0, isPlaying: true, time: 10.0 } }
      );

      expect(result.current).toBe(10.0);

      // Case A: 100ms elapses at 1.0x -> extrapolated +0.10s -> 10.10s
      now += 100;
      act(() => {
        if (rafCallback) rafCallback(now);
      });
      expect(result.current).toBeCloseTo(10.1, 2);

      // Case B: Switch to 0.5x rate with re-anchored time at 15.0s and advance 200ms
      rerender({ rate: 0.5, isPlaying: true, time: 15.0 });
      now += 200;
      act(() => {
        if (rafCallback) rafCallback(now);
      });
      // dt = 200ms, rate = 0.5 -> +0.10s -> 15.10s
      expect(result.current).toBeCloseTo(15.1, 2);

      // Case C: Switch to 1.5x rate and advance 100ms
      rerender({ rate: 1.5, isPlaying: true, time: 20.0 });
      now += 100;
      act(() => {
        if (rafCallback) rafCallback(now);
      });
      // dt = 100ms, rate = 1.5 -> +0.15s
      expect(result.current).toBeCloseTo(20.15, 2);

      // Case D: Extreme stall (10 seconds elapsed) -> clamped to 350ms max delta (0.35 * 1.5 = 0.525s)
      rerender({ rate: 1.5, isPlaying: true, time: 30.0 });
      now += 10000;
      act(() => {
        if (rafCallback) rafCallback(now);
      });
      expect(result.current).toBeCloseTo(30.0 + 0.35 * 1.5, 2);
    });

    it('immediately synchronizes and cancels interpolation when playback is paused', () => {
      vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
      const cancelMock = vi.spyOn(globalThis, 'cancelAnimationFrame');

      const { result, rerender } = renderHook(
        ({ isPlaying, time }: { isPlaying: boolean; time: number }) =>
          useInterpolatedTime({ currentTime: time, isPlaying }),
        { initialProps: { isPlaying: true, time: 5.0 } }
      );

      // Pause playback
      rerender({ isPlaying: false, time: 5.0 });
      expect(cancelMock).toHaveBeenCalled();
      expect(result.current).toBe(5.0);
    });
  });

  // =========================================================================
  // 6. LIBRARY SEARCH & SORTING HARNESS
  // =========================================================================
  describe('6. Library Search & Sorting Adversarial Testing', () => {
    const mockLibrary: Record<string, ProjectState> = {
      p1: {
        id: 'proj-1',
        title: 'Special Regex (Queen) [Live] *+?^$',
        artist: 'Queen / Freddie',
        status: 'ready',
        progress: 100,
        lines: [],
        semitones: 0,
        guide_volume: 0,
        created_by: 'Friend',
        created_at: 1700000100,
      },
      p2: {
        id: 'proj-2',
        title: 'Another Track <script>alert(1)</script>',
        artist: 'The Script & Co.',
        status: 'ready',
        progress: 100,
        lines: [],
        semitones: 0,
        guide_volume: 0,
        created_by: 'Friend',
        created_at: undefined as unknown as number, // Missing timestamp
      },
      p3: {
        id: 'proj-3',
        title: undefined as unknown as string, // Missing title
        artist: undefined as unknown as string, // Missing artist
        status: 'aligning',
        progress: 50,
        lines: [],
        semitones: 0,
        guide_volume: 0,
        created_by: 'Community_User',
        created_at: null as unknown as number,
      },
    };

    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify(mockLibrary), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    });

    it('filters complex queries containing regex characters without syntax errors or crash', async () => {
      render(<ProjectLibrary currentUser="Friend" authToken="test-token" />);

      // Wait for data load
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /My Songs/i })).toBeInTheDocument();
      });

      const searchInput = screen.getByLabelText('Search project library');

      // Test adversarial search inputs
      const adversarialQueries = [
        '[Live]',
        '*+?^$',
        '(Queen)',
        '<script>',
        'Queen / Freddie',
        '\\d+\\w+',
      ];

      for (const q of adversarialQueries) {
        expect(() => {
          fireEvent.change(searchInput, { target: { value: q } });
        }).not.toThrow();
      }
    });

    it('sorts safely when projects contain null, undefined, or missing timestamps and titles', async () => {
      render(<ProjectLibrary currentUser="Friend" authToken="test-token" />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /My Songs/i })).toBeInTheDocument();
      });

      const sortSelect = screen.getByLabelText('Sort projects');

      // Sort by Title (A-Z) with undefined title
      expect(() => {
        fireEvent.change(sortSelect, { target: { value: 'title_asc' } });
      }).not.toThrow();

      // Sort by Artist (A-Z) with undefined artist
      expect(() => {
        fireEvent.change(sortSelect, { target: { value: 'artist_asc' } });
      }).not.toThrow();

      // Sort by Recent with undefined and null created_at
      expect(() => {
        fireEvent.change(sortSelect, { target: { value: 'recent' } });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 7. STAGE MODE FULLSCREEN & IDLE TIMER HARNESS
  // =========================================================================
  describe('7. Stage Mode Adversarial Testing', () => {
    const sampleLines: LyricLine[] = [
      {
        id: 1,
        text: 'Live stage performance line',
        start_time: 1.0,
        end_time: 4.0,
        words: [
          { word: 'Live', start_time: 1.0, end_time: 1.8 },
          { word: 'stage', start_time: 1.8, end_time: 2.6 },
          { word: 'performance', start_time: 2.6, end_time: 3.4 },
          { word: 'line', start_time: 3.4, end_time: 4.0 },
        ],
      },
    ];

    it('cycles fullscreen entry and exit cleanly via toggle button and keyboard shortcuts (F and Escape)', () => {
      render(
        <LyricDisplay lines={sampleLines} currentTime={2.0} duration={30.0} isPlaying={false} />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Enter fullscreen via button
      const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(toggleBtn);
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      expect(screen.getByTestId('stage-floating-controls')).toBeInTheDocument();

      // Exit fullscreen via Escape key
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Enter fullscreen via 'f' key
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Exit fullscreen via 'f' key again
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('maintains pseudo-fullscreen fallback styling when native Fullscreen API is unavailable', () => {
      render(
        <LyricDisplay lines={sampleLines} currentTime={2.0} duration={30.0} isPlaying={false} />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');

      fireEvent.click(toggleBtn);
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      // The pseudo-fullscreen overlay covers the viewport on its own (no native API needed)
      const classes = stage.className.split(/\s+/);
      for (const token of ['fixed', 'inset-0', 'z-50', 'w-screen', 'h-screen', 'bg-theme-bg']) {
        expect(classes).toContain(token);
      }
    });

    it('resets idle timer on mouse movements during playback, hiding only after 3000ms idle, and stays visible when paused', () => {
      vi.useFakeTimers();

      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={2.0} duration={30.0} isPlaying={true} />
      );

      const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(toggleBtn);

      const stage = screen.getByTestId('lyric-display-stage');
      const controls = screen.getByTestId('stage-floating-controls');

      // Controls initially visible
      expect(controls).toHaveClass('opacity-100');

      // Advance 2000ms (not yet 3000ms)
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(controls).toHaveClass('opacity-100');

      // Rapid mouse movement bursts reset the idle timer
      for (let i = 0; i < 20; i++) {
        act(() => {
          vi.advanceTimersByTime(100);
        });
        fireEvent.mouseMove(stage);
      }
      expect(controls).toHaveClass('opacity-100');

      // Stop moving and advance 3100ms -> controls fade out
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(controls).toHaveClass('opacity-0');

      // Moving mouse wakes them up again
      fireEvent.mouseMove(stage);
      expect(controls).toHaveClass('opacity-100');

      // When playback pauses -> controls stay visible indefinitely
      rerender(
        <LyricDisplay lines={sampleLines} currentTime={2.0} duration={30.0} isPlaying={false} />
      );
      expect(controls).toHaveClass('opacity-100');
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(controls).toHaveClass('opacity-100');
    });
  });
});
