/**
 * Empirical Adversarial Challenger 2 Test Suite:
 * Frontend Workstation & UI Integration Adversarial Hardening (Milestone 4 - Phase 2)
 *
 * Scope:
 * 1. Real-time scrolling and sub-frame sync:
 *    - Stress test ChordBar.tsx and useInterpolatedTime.ts under rapid playback speeds (0.5x, 0.75x, 1.0x, 1.25x, 1.5x) and frequent seeks.
 *    - Verify active chord highlight never drifts out of sync with audio time.
 * 2. History stack bounds & persistence:
 *    - Stress test 50-step bounded undo/redo across rapid consecutive edits and saves.
 *    - Verify deep state immutability.
 * 3. Keyboard navigation & isolation:
 *    - Test 'C' / 'c' toggle under all input contexts (inputs, textareas, contenteditable, modals).
 *    - Test modifier combinations (Ctrl+C, Cmd+C).
 * 4. Responsive & accessibility audits:
 *    - Audit touch targets (all interactive elements >= 44px).
 *    - Audit viewport layout down to 320px for zero horizontal overflow.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';

import { ChordBar } from '../components/ChordBar';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { useChordHistory } from '../hooks/useChordHistory';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { LyricDisplay } from '../components/LyricDisplay';
import { HelpModal } from '../components/HelpModal';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { ChordSegment, ProjectState } from '../types';
import * as apiModule from '../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
  BREAKPOINTS,
} from './responsiveTestUtils';

describe('Adversarial Workstation & UI Integration Stress Suite (Challenger 2)', () => {
  const denseProgression: ChordSegment[] = [
    { id: 'c1', start: 0.0, end: 1.0, chord: 'C' },
    { id: 'c2', start: 1.0, end: 2.0, chord: 'Am' },
    { id: 'c3', start: 2.0, end: 3.0, chord: 'F' },
    { id: 'c4', start: 3.0, end: 4.0, chord: 'G7' },
    { id: 'c5', start: 4.0, end: 5.0, chord: 'Cmaj7' },
    { id: 'c6', start: 5.0, end: 6.0, chord: 'Dm7' },
    { id: 'c7', start: 6.0, end: 7.0, chord: 'N' },
    { id: 'c8', start: 7.0, end: 8.5, chord: 'Em' },
    { id: 'c9', start: 8.5, end: 10.0, chord: 'A7' },
  ];

  const sampleProject: ProjectState = {
    id: 'resp_proj',
    title: 'Responsive Ballad',
    artist: 'Responsive Artist',
    status: 'ready',
    progress: 100,
    guide_volume: 0.0,
    duration: 10.0,
    lines: [
      {
        id: 1,
        text: 'Testing responsive layout and touch targets',
        start_time: 0.0,
        end_time: 4.0,
        words: [
          { word: 'Testing', start_time: 0.0, end_time: 1.0 },
          { word: 'responsive', start_time: 1.0, end_time: 2.0 },
        ],
      },
    ],
    semitones: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestViewport();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: REAL-TIME SCROLLING & SUB-FRAME SYNC
  // =========================================================================
  describe('1. Real-Time Scrolling & Sub-Frame Sync Stress', () => {
    describe('useInterpolatedTime hook under variable playback speeds and seeks', () => {
      it('1.1: scales extrapolated time accurately across 0.5x, 0.75x, 1.0x, 1.25x, 1.5x rates', () => {
        const rates = [0.5, 0.75, 1.0, 1.25, 1.5];

        rates.forEach((rate) => {
          let perfNow = 1000;
          vi.spyOn(performance, 'now').mockImplementation(() => perfNow);

          let rAFCallback: FrameRequestCallback | null = null;
          vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rAFCallback = cb;
            return 123;
          });
          vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
            rAFCallback = null;
          });

          const { result, unmount } = renderHook(() =>
            useInterpolatedTime({
              currentTime: 2.0,
              isPlaying: true,
              playbackRate: rate,
            })
          );

          expect(result.current).toBe(2.0);

          // Advance performance.now by 100ms (0.1s)
          perfNow = 1100;
          act(() => {
            if (rAFCallback) rAFCallback(perfNow);
          });

          // Expected time = 2.0 + 0.1 * rate
          const expected = 2.0 + 0.1 * rate;
          expect(result.current).toBeCloseTo(expected, 4);

          unmount();
          vi.restoreAllMocks();
        });
      });

      it('1.2: clamps runaway extrapolation to 350ms during audio stall or tab suspension', () => {
        let perfNow = 2000;
        vi.spyOn(performance, 'now').mockImplementation(() => perfNow);

        let rAFCallback: FrameRequestCallback | null = null;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
          rAFCallback = cb;
          return 1;
        });

        const { result, unmount } = renderHook(() =>
          useInterpolatedTime({
            currentTime: 5.0,
            isPlaying: true,
            playbackRate: 1.0,
          })
        );

        expect(result.current).toBe(5.0);

        // Huge time jump (e.g. 5.0 seconds of stall/suspension)
        perfNow = 7000;
        act(() => {
          if (rAFCallback) rAFCallback(perfNow);
        });

        // Clamped at 350ms delta (5.0 + 0.35 = 5.35), avoiding wild jumps
        expect(result.current).toBeCloseTo(5.35, 3);
        unmount();
      });

      it('1.3: re-anchors base timestamp immediately upon frequent seeks without drift', () => {
        let perfNow = 10000;
        vi.spyOn(performance, 'now').mockImplementation(() => perfNow);

        let rAFCallback: FrameRequestCallback | null = null;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
          rAFCallback = cb;
          return 1;
        });

        const { result, rerender, unmount } = renderHook(
          ({ time }) =>
            useInterpolatedTime({
              currentTime: time,
              isPlaying: true,
              playbackRate: 1.0,
            }),
          { initialProps: { time: 0.0 } }
        );

        // Frequent rapid seeks
        const seekTargets = [1.5, 4.25, 0.2, 7.8, 3.1, 0.0, 9.9];
        seekTargets.forEach((targetTime) => {
          perfNow += 20; // 20ms later
          act(() => {
            rerender({ time: targetTime });
          });
          expect(result.current).toBe(targetTime);

          // Simulate 1 frame (16.6ms) after seek
          perfNow += 16.6;
          act(() => {
            if (rAFCallback) rAFCallback(perfNow);
          });
          expect(result.current).toBeCloseTo(targetTime + 0.0166, 3);
        });

        unmount();
      });

      it('1.4: immediately suspends interpolation and resets to currentTime when isPlaying becomes false', () => {
        let cancelCalled = false;
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
          cancelCalled = true;
        });

        const { result, rerender } = renderHook(
          ({ isPlaying }) =>
            useInterpolatedTime({
              currentTime: 4.5,
              isPlaying,
              playbackRate: 1.0,
            }),
          { initialProps: { isPlaying: true } }
        );

        expect(result.current).toBe(4.5);

        // Pause audio
        act(() => {
          rerender({ isPlaying: false });
        });

        expect(cancelCalled).toBe(true);
        expect(result.current).toBe(4.5);
      });
    });

    describe('ChordBar active chord highlight precision and zero drift', () => {
      it('1.5: active chord matches ground-truth interval with sub-frame precision at transition boundaries', () => {
        const { rerender } = render(
          <ChordBar chords={denseProgression} currentTime={0.0} visible={true} />
        );

        // At exact start t=0.0 -> 'C'
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

        // At sub-frame epsilon before end: t=0.999 -> 'C'
        rerender(<ChordBar chords={denseProgression} currentTime={0.999} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

        // At boundary transition: t=1.000 -> 'Am'
        rerender(<ChordBar chords={denseProgression} currentTime={1.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');

        // At sub-frame epsilon before end: t=1.999 -> 'Am'
        rerender(<ChordBar chords={denseProgression} currentTime={1.999} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');

        // At boundary transition: t=2.000 -> 'F'
        rerender(<ChordBar chords={denseProgression} currentTime={2.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('F');

        // Transition into 7th chord: t=3.0 -> 'G7'
        rerender(<ChordBar chords={denseProgression} currentTime={3.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('G7');

        // Transition into maj7: t=4.0 -> 'Cmaj7'
        rerender(<ChordBar chords={denseProgression} currentTime={4.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Cmaj7');

        // Transition into m7: t=5.0 -> 'Dm7'
        rerender(<ChordBar chords={denseProgression} currentTime={5.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Dm7');

        // Transition into silent/no-chord region: t=6.0 -> 'N'
        rerender(<ChordBar chords={denseProgression} currentTime={6.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('N');
      });

      it('1.6: handles out-of-range timestamps gracefully (negative, beyond total duration, empty chords)', () => {
        const { rerender } = render(
          <ChordBar chords={denseProgression} currentTime={-5.0} visible={true} />
        );

        // Negative time -> dash placeholder
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');

        // Beyond end of song -> dash placeholder
        rerender(<ChordBar chords={denseProgression} currentTime={999.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');

        // Empty chord list -> dash placeholder without throwing
        rerender(<ChordBar chords={[]} currentTime={2.0} visible={true} />);
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');
      });

      it('1.7: dynamic pitch shift stepper updates active and upcoming cues instantly without timing jitter', () => {
        const { rerender } = render(
          <ChordBar chords={denseProgression} currentTime={0.5} semitones={0} visible={true} />
        );

        // C at 0 semitones
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

        // Pitch shift +2 semitones: C -> D, Am -> Bm
        rerender(
          <ChordBar chords={denseProgression} currentTime={0.5} semitones={2} visible={true} />
        );
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('D');

        // Upcoming cues also transposed
        const upcoming = screen.getAllByTestId('upcoming-chord-cue');
        expect(upcoming[0]).toHaveTextContent('Bm'); // Am + 2 = Bm

        // Pitch shift -3 semitones: C -> A, Am -> F#m
        rerender(
          <ChordBar chords={denseProgression} currentTime={0.5} semitones={-3} visible={true} />
        );
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('A');
      });

      it('1.8: clicking upcoming chord cue invokes onSeek with cue start timestamp', () => {
        const onSeekSpy = vi.fn();
        render(
          <ChordBar chords={denseProgression} currentTime={0.5} onSeek={onSeekSpy} visible={true} />
        );

        const upcomingCues = screen.getAllByTestId('upcoming-chord-cue');
        expect(upcomingCues.length).toBeGreaterThan(0);

        // Click first upcoming cue (Am starting at 1.0)
        fireEvent.click(upcomingCues[0]);
        expect(onSeekSpy).toHaveBeenCalledWith(1.0);
      });
    });
  });

  // =========================================================================
  // SECTION 2: HISTORY STACK BOUNDS & PERSISTENCE
  // =========================================================================
  describe('2. History Stack Bounds, Persistence & Immutability Stress', () => {
    it('2.1: 50-step bounded undo/redo across 150 consecutive rapid edits strictly maintains bounds', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: denseProgression,
          currentChords: denseProgression,
          maxHistory: 50,
        })
      );

      // Perform 150 rapid consecutive edits
      for (let i = 1; i <= 150; i++) {
        act(() => {
          result.current.pushSnapshot([
            { id: 'c1', start: 0.0, end: 1.0, chord: `ChordEdit_${i}` },
          ]);
        });

        // Invariant: length must never exceed 50
        expect(result.current.undoStack.length).toBeLessThanOrEqual(50);
        expect(result.current.undoStack.length).toBe(Math.min(i, 50));
      }

      // Exact bound is 50
      expect(result.current.undoStack).toHaveLength(50);
      // FIFO eviction: oldest snapshot is edit 101, newest is 150
      expect(result.current.undoStack[0][0].chord).toBe('ChordEdit_101');
      expect(result.current.undoStack[49][0].chord).toBe('ChordEdit_150');
    });

    it('2.2: multiple undos past empty stack safely return null and do not throw', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: denseProgression,
          currentChords: denseProgression,
          maxHistory: 50,
        })
      );

      act(() => {
        result.current.pushSnapshot([{ id: 'c1', start: 0, end: 1, chord: 'Edit_1' }]);
        result.current.pushSnapshot([{ id: 'c1', start: 0, end: 1, chord: 'Edit_2' }]);
      });
      expect(result.current.undoStack).toHaveLength(2);

      // Undo twice
      act(() => {
        const u1 = result.current.undo([{ id: 'c1', start: 0, end: 1, chord: 'Current' }]);
        expect(u1![0].chord).toBe('Edit_2');
      });
      act(() => {
        const u2 = result.current.undo([{ id: 'c1', start: 0, end: 1, chord: 'Edit_2' }]);
        expect(u2![0].chord).toBe('Edit_1');
      });

      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);

      // Undo 10 more times past empty stack
      for (let k = 0; k < 10; k++) {
        act(() => {
          const res = result.current.undo([{ id: 'c1', start: 0, end: 1, chord: 'Edit_1' }]);
          expect(res).toBeNull();
        });
      }
      expect(result.current.undoStack).toHaveLength(0);
    });

    it('2.3: pushing new edit when redoStack is populated completely invalidates redo history', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: denseProgression,
          currentChords: denseProgression,
          maxHistory: 50,
        })
      );

      // Push 3 edits
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 1, chord: 'A' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 1, chord: 'B' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 1, chord: 'C' }]);
      });

      // Undo 2 times -> redoStack has 2 entries
      act(() => {
        result.current.undo([{ id: '1', start: 0, end: 1, chord: 'Current_D' }]);
        result.current.undo([{ id: '1', start: 0, end: 1, chord: 'C' }]);
      });
      expect(result.current.redoStack).toHaveLength(2);
      expect(result.current.canRedo).toBe(true);

      // Push a divergent edit
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 1, chord: 'Divergent' }]);
      });

      // Redo stack must be completely wiped
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.canRedo).toBe(false);
    });

    it('2.4: deep state immutability: external mutations never mutate undo/redo snapshots', () => {
      const originalInput: ChordSegment[] = [
        { id: 'c1', start: 0.0, end: 2.0, chord: 'MutableChord' },
      ];

      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: originalInput,
          currentChords: originalInput,
          maxHistory: 50,
        })
      );

      act(() => {
        result.current.pushSnapshot(originalInput);
      });

      // Mutate originalInput array and its object directly
      originalInput[0].chord = 'CorruptedExternally';
      originalInput.push({ id: 'c2', start: 2.0, end: 4.0, chord: 'Injected' });

      // Invariant: Snapshot inside undoStack must remain unchanged
      expect(result.current.undoStack[0]).toHaveLength(1);
      expect(result.current.undoStack[0][0].chord).toBe('MutableChord');

      // Undo should return a cloned snapshot, not an internal reference
      let popped: ChordSegment[] | null = null;
      act(() => {
        popped = result.current.undo([{ id: 'c1', start: 0.0, end: 2.0, chord: 'Current' }]);
      });

      expect(popped).not.toBeNull();
      expect(popped![0].chord).toBe('MutableChord');

      // Mutating popped snapshot must not affect redoStack
      popped![0].chord = 'MutatingPopped';
      expect(result.current.redoStack[0][0].chord).toBe('Current');
    });

    it('2.5: saveChords rejects malformed intervals (start >= end) with descriptive error', async () => {
      const { result } = renderHook(() =>
        useChordHistory({
          projectId: 'test_proj',
          initialChords: denseProgression,
          currentChords: denseProgression,
        })
      );

      const invalidInverted: ChordSegment[] = [
        { id: 'bad1', start: 3.5, end: 2.0, chord: 'BadInterval' },
      ];

      await expect(result.current.saveChords(invalidInverted)).rejects.toThrow(
        /start must be strictly less than end/i
      );
    });

    it('2.6: saveChords rejects overlapping intervals (end_i > start_{i+1}) with descriptive error', async () => {
      const { result } = renderHook(() =>
        useChordHistory({
          projectId: 'test_proj',
          initialChords: denseProgression,
          currentChords: denseProgression,
        })
      );

      const invalidOverlapping: ChordSegment[] = [
        { id: '1', start: 0.0, end: 2.5, chord: 'C' },
        { id: '2', start: 2.0, end: 4.0, chord: 'Am' }, // Overlaps C [0, 2.5]
      ];

      await expect(result.current.saveChords(invalidOverlapping)).rejects.toThrow(
        /overlapping chords/i
      );
    });

    it('2.7: saveChords atomically persists valid progression and clears isDirty', async () => {
      const apiSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      } as Response);

      const current = [
        { id: '1', start: 0.0, end: 2.0, chord: 'C' },
        { id: '2', start: 2.0, end: 4.0, chord: 'G' },
      ];

      const { result } = renderHook(() =>
        useChordHistory({
          projectId: 'valid_proj',
          initialChords: denseProgression,
          currentChords: current,
        })
      );

      expect(result.current.isDirty).toBe(true);

      let success = false;
      await act(async () => {
        success = await result.current.saveChords(current);
      });

      expect(success).toBe(true);
      expect(apiSpy).toHaveBeenCalledWith('/api/project/valid_proj/chords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chords: current }),
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 3: KEYBOARD NAVIGATION & ISOLATION
  // =========================================================================
  describe('3. Keyboard Navigation & Strict Isolation Stress', () => {
    function KeyboardHarness({ onToggle }: { onToggle: () => void }) {
      useKeyboardShortcuts({
        enabled: true,
        onToggleChordBar: onToggle,
      });

      return (
        <div>
          <button data-testid="neutral-target">Neutral Target</button>
          <input data-testid="input-text" type="text" defaultValue="Singing" />
          <input data-testid="input-number" type="number" defaultValue={42} />
          <input data-testid="input-search" type="search" defaultValue="Search query" />
          <textarea data-testid="textarea-notes" defaultValue="Line notes here" />
          <select data-testid="select-key" defaultValue="C">
            <option value="C">C Major</option>
            <option value="G">G Major</option>
          </select>
          <div data-testid="editable-div" contentEditable={true}>
            <p data-testid="editable-paragraph">Nested text in contenteditable</p>
          </div>
          <div role="textbox" data-testid="role-textbox" tabIndex={0}>
            Aria Textbox Content
          </div>
          <div role="searchbox" data-testid="role-searchbox" tabIndex={0}>
            Aria Searchbox Content
          </div>
          <div role="spinbutton" data-testid="role-spinbutton" tabIndex={0}>
            100
          </div>
          <div role="slider" data-testid="role-slider" tabIndex={0}>
            50
          </div>
        </div>
      );
    }

    it('3.1: background "c" and "C" cleanly toggle ChordBar', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(2);
    });

    it('3.2: key repeat (holding C down) does not trigger repeated toggles', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: true });
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', repeat: true });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.3: Shift+C does not toggle ChordBar (reserved for possible chord editing/formatting)', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', shiftKey: true });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.4: clipboard copy combinations (Ctrl+C, Cmd+C, Alt+C) never trigger ChordBar toggle', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      // Windows/Linux Ctrl+C
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(toggleSpy).not.toHaveBeenCalled();

      // macOS Cmd+C / Meta+C
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });
      expect(toggleSpy).not.toHaveBeenCalled();

      // Alt+C
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', altKey: true });
      expect(toggleSpy).not.toHaveBeenCalled();

      // Ctrl+Shift+C / Cmd+Shift+C
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.5: typing C in any text input, number input, search input is isolated', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      ['input-text', 'input-number', 'input-search'].forEach((testId) => {
        const el = screen.getByTestId(testId);
        el.focus();
        fireEvent.keyDown(el, { key: 'c', code: 'KeyC' });
        fireEvent.keyDown(el, { key: 'C', code: 'KeyC' });
      });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.6: typing C in textarea or select dropdown is isolated', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      const textarea = screen.getByTestId('textarea-notes');
      textarea.focus();
      fireEvent.keyDown(textarea, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(textarea, { key: 'C', code: 'KeyC' });

      const select = screen.getByTestId('select-key');
      select.focus();
      fireEvent.keyDown(select, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(select, { key: 'C', code: 'KeyC' });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.7: typing C inside contenteditable elements and nested nodes is isolated', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      const editable = screen.getByTestId('editable-div');
      editable.focus();
      fireEvent.keyDown(editable, { key: 'c', code: 'KeyC' });

      const nested = screen.getByTestId('editable-paragraph');
      fireEvent.keyDown(nested, { key: 'c', code: 'KeyC' });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.8: typing C inside ARIA text controls (textbox, searchbox, spinbutton, slider) is isolated', () => {
      const toggleSpy = vi.fn();
      render(<KeyboardHarness onToggle={toggleSpy} />);

      ['role-textbox', 'role-searchbox', 'role-spinbutton', 'role-slider'].forEach((id) => {
        const el = screen.getByTestId(id);
        el.focus();
        fireEvent.keyDown(el, { key: 'c', code: 'KeyC' });
        fireEvent.keyDown(el, { key: 'C', code: 'KeyC' });
      });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('3.9: open modal dialog suppresses "C" shortcut completely', () => {
      const toggleSpy = vi.fn();
      const { rerender } = render(
        <div>
          <KeyboardHarness onToggle={toggleSpy} />
          <HelpModal isOpen={true} onClose={() => {}} />
        </div>
      );

      // With HelpModal open, 'c' must NOT toggle ChordBar
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      // Render with ExportModal open
      rerender(
        <div>
          <KeyboardHarness onToggle={toggleSpy} />
          <ExportModal isOpen={true} onClose={() => {}} project={sampleProject} />
        </div>
      );

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SECTION 4: RESPONSIVE & ACCESSIBILITY AUDITS
  // =========================================================================
  describe('4. Responsive Layout & Accessibility Audits', () => {
    it('4.1: ChordBar interactive elements satisfy >= 44px touch targets', () => {
      render(
        <ChordBar
          chords={denseProgression}
          currentTime={0.5}
          onEditChord={() => {}}
          onSeek={() => {}}
          visible={true}
        />
      );

      const container = screen.getByTestId('chord-bar');
      assertTouchTargets(container);

      // Verify active chord badge satisfies min 44px
      const badge = screen.getByTestId('active-chord-badge');
      expect(badge.className).toContain('min-h-[44px]');
      expect(badge.className).toContain('min-w-[44px]');

      // Verify edit button satisfies min 44px
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      expect(editBtn.className).toContain('min-h-[44px]');
      expect(editBtn.className).toContain('min-w-[44px]');
    });

    it('4.2: ChordBar inline edit controls satisfy >= 44px touch targets', () => {
      render(
        <ChordBar
          chords={denseProgression}
          currentTime={0.5}
          onEditChord={() => {}}
          visible={true}
        />
      );

      // Click edit active chord button to switch to inline editor
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      const cancelBtn = screen.getByTestId('cancel-chord-edit-btn');
      const input = screen.getByTestId('chord-edit-input');

      expect(saveBtn.className).toContain('min-h-[44px]');
      expect(saveBtn.className).toContain('min-w-[44px]');
      expect(cancelBtn.className).toContain('min-h-[44px]');
      expect(cancelBtn.className).toContain('min-w-[44px]');
      expect(input.className).toContain('min-h-[44px]');
    });

    it('4.3: Stage Mode Chord Bar toggle button satisfies >= 44px touch target', () => {
      render(
        <LyricDisplay
          lines={sampleProject.lines!}
          currentTime={2.0}
          duration={10.0}
          chords={denseProgression}
          showChords={true}
        />
      );

      // Enter fullscreen stage mode by clicking fullscreen toggle
      const fullscreenBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(fullscreenBtn);

      const chordToggleBtn = screen.getByTestId('chord-bar-toggle');
      expect(chordToggleBtn).toBeInTheDocument();
      expect(chordToggleBtn.className).toContain('min-h-[44px]');
      expect(chordToggleBtn.className).toContain('min-w-[44px]');
    });

    it('4.4: Zero horizontal overflow in ChordBar across 320px, 375px, 768px, and 1280px viewports', () => {
      BREAKPOINTS.forEach((bp) => {
        setTestViewport(bp.width, bp.height);
        const { unmount } = render(
          <div style={{ width: `${bp.width}px`, maxWidth: `${bp.width}px`, overflow: 'hidden' }}>
            <ChordBar
              chords={denseProgression}
              currentTime={1.5}
              semitones={2}
              onEditChord={() => {}}
              visible={true}
            />
          </div>
        );

        const chordBar = screen.getByTestId('chord-bar');
        assertZeroHorizontalOverflow(chordBar, bp.width);
        unmount();
      });
    });

    it('4.5: Zero horizontal overflow in LyricDisplay embedding ChordBar across all breakpoints', () => {
      BREAKPOINTS.forEach((bp) => {
        setTestViewport(bp.width, bp.height);
        const { unmount } = render(
          <div style={{ width: `${bp.width}px`, maxWidth: `${bp.width}px`, overflow: 'hidden' }}>
            <LyricDisplay
              lines={sampleProject.lines!}
              currentTime={1.5}
              duration={10.0}
              chords={denseProgression}
              showChords={true}
            />
          </div>
        );

        const chordBar = screen.getByTestId('chord-bar');
        expect(chordBar).toBeInTheDocument();
        assertZeroHorizontalOverflow(chordBar, bp.width);
        unmount();
      });
    });

    it('4.6: ExportSubtitleSection and ExportModal chord controls have zero horizontal overflow at 320px', () => {
      setTestViewport(320, 568);

      const { unmount: unmountSection } = render(
        <div style={{ width: '320px', maxWidth: '320px', overflow: 'hidden' }}>
          <ExportSubtitleSection project={sampleProject} activeSemitones={0} />
        </div>
      );
      const section = screen.getByTestId('include-chords-subtitle-container');
      assertZeroHorizontalOverflow(section, 320);
      assertTouchTargets(section);
      unmountSection();

      const { unmount: unmountModal } = render(
        <div style={{ width: '320px', maxWidth: '320px', overflow: 'hidden' }}>
          <ExportModal
            isOpen={true}
            onClose={() => {}}
            project={sampleProject}
            activeSemitones={2}
          />
        </div>
      );
      const modal = screen.getByRole('dialog');
      assertZeroHorizontalOverflow(modal, 320);
      unmountModal();
    });
  });
});
