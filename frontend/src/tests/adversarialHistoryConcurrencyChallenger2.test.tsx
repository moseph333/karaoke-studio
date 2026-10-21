/**
 * Empirical Adversarial Challenger 2 Test Suite:
 * History Bounds, Deep Immutability, Concurrency, and Dirty Lifecycle
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import App from '../App';
import { ToastProvider } from '../hooks/useToast';
import { useChordHistory } from '../hooks/useChordHistory';
import { ChordBar } from '../components/ChordBar';
import { StudioHeader } from '../components/StudioHeader';
import { ChordSegment, ProjectState, LyricLine } from '../types';

describe('Empirical Challenger 2: History Bounds, Deep Immutability & Concurrency', () => {
  const baseProgression: ChordSegment[] = [
    { id: '1', start: 0.0, end: 2.0, chord: 'C' },
    { id: '2', start: 2.0, end: 4.0, chord: 'Am' },
    { id: '3', start: 4.0, end: 6.0, chord: 'F' },
    { id: '4', start: 6.0, end: 8.0, chord: 'G' },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Scope 1: 50-step bounded history stack
  // =========================================================================
  describe('Scope 1: 50-step Bounded History Stack & Deep Immutability', () => {
    it('1.1: Push 100 consecutive edits to useChordHistory; stack size never exceeds 50', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Verify that across every push from 1 to 100, stack length is always exactly min(i, 50)
      for (let i = 1; i <= 100; i++) {
        act(() => {
          result.current.pushSnapshot([{ id: 'c1', start: 0.0, end: 2.0, chord: `Chord_${i}` }]);
        });
        expect(result.current.undoStack.length).toBe(Math.min(i, 50));
        expect(result.current.undoStack.length).toBeLessThanOrEqual(50);
      }

      // Check oldest and newest snapshots in bounded stack
      expect(result.current.undoStack).toHaveLength(50);
      expect(result.current.undoStack[0][0].chord).toBe('Chord_51');
      expect(result.current.undoStack[49][0].chord).toBe('Chord_100');
    });

    it('1.2: Undo past bottom is a safe no-op returning null without throwing', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Push 5 items
      act(() => {
        for (let i = 1; i <= 5; i++) {
          result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: `C_${i}` }]);
        }
      });
      expect(result.current.undoStack).toHaveLength(5);

      // Undo 5 times to exhaust stack
      for (let i = 5; i >= 1; i--) {
        act(() => {
          const snapshot = result.current.undo([
            { id: '1', start: 0, end: 2, chord: `Current_${i}` },
          ]);
          expect(snapshot).not.toBeNull();
          expect(snapshot![0].chord).toBe(`C_${i}`);
        });
      }

      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);

      // Undo 20 more times past the bottom
      for (let i = 0; i < 20; i++) {
        act(() => {
          const excess = result.current.undo([{ id: '1', start: 0, end: 2, chord: 'C_bottom' }]);
          expect(excess).toBeNull();
          result.current.handleUndo();
        });
        expect(result.current.undoStack).toHaveLength(0);
        expect(result.current.canUndo).toBe(false);
      }
    });

    it('1.3: Redo past top is a safe no-op returning null without throwing', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Push 5 items
      act(() => {
        for (let i = 1; i <= 5; i++) {
          result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: `C_${i}` }]);
        }
      });

      // Undo 5 times -> redoStack has 5 items
      for (let i = 5; i >= 1; i--) {
        act(() => {
          result.current.undo([{ id: '1', start: 0, end: 2, chord: `State_${i}` }]);
        });
      }
      expect(result.current.redoStack).toHaveLength(5);
      expect(result.current.canRedo).toBe(true);

      // Redo 5 times to reach top
      for (let i = 1; i <= 5; i++) {
        act(() => {
          const snapshot = result.current.redo([
            { id: '1', start: 0, end: 2, chord: `UndoState_${i}` },
          ]);
          expect(snapshot).not.toBeNull();
        });
      }
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.canRedo).toBe(false);

      // Redo 20 more times past top
      for (let i = 0; i < 20; i++) {
        act(() => {
          const excess = result.current.redo([{ id: '1', start: 0, end: 2, chord: 'Top' }]);
          expect(excess).toBeNull();
          result.current.handleRedo();
        });
        expect(result.current.redoStack).toHaveLength(0);
        expect(result.current.canRedo).toBe(false);
      }
    });

    it('1.4: Snapshots are immutable deep copies across pushes, undos, and redos', () => {
      const externalObj = { id: 'orig', start: 0.0, end: 2.0, chord: 'Initial' };
      const externalProgression: ChordSegment[] = [externalObj];

      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: externalProgression,
          currentChords: externalProgression,
          maxHistory: 50,
        })
      );

      act(() => {
        result.current.pushSnapshot(externalProgression);
      });

      // Mutate external object
      externalObj.chord = 'MUTATED_EXTERNAL';
      externalObj.start = 999.0;
      externalProgression.push({ id: 'injected', start: 10, end: 12, chord: 'HACK' });

      // Internal snapshot must be unaffected
      const stored = result.current.undoStack[0];
      expect(stored).toHaveLength(1);
      expect(stored[0].chord).toBe('Initial');
      expect(stored[0].start).toBe(0.0);

      // Verify undo returns a clone, not the internal reference
      let poppedSnapshot: ChordSegment[] | null = null;
      act(() => {
        poppedSnapshot = result.current.undo([{ id: 'curr', start: 0, end: 2, chord: 'Current' }]);
      });
      expect(poppedSnapshot).not.toBeNull();
      // Mutating popped snapshot
      poppedSnapshot![0].chord = 'POPPED_MUTATION';

      // Redo must receive the unmutated target that was saved to redoStack
      let redoSnapshot: ChordSegment[] | null = null;
      act(() => {
        redoSnapshot = result.current.redo([
          { id: 'redo_curr', start: 0, end: 2, chord: 'RedoCurr' },
        ]);
      });
      expect(redoSnapshot).not.toBeNull();
      expect(redoSnapshot![0].chord).toBe('Current');
    });
  });

  // =========================================================================
  // Scope 2: Dynamic state synchronization & Concurrency
  // =========================================================================
  describe('Scope 2: Dynamic State Synchronization & Concurrency', () => {
    it('2.1: Rapidly toggle chord bar visibility while scrubbing audio across sub-frame boundaries', () => {
      const testChords: ChordSegment[] = [
        { id: '1', start: 1.0, end: 2.5, chord: 'C' },
        { id: '2', start: 2.5, end: 4.0, chord: 'G7' },
        { id: '3', start: 5.0, end: 7.0, chord: 'Am' },
      ];

      // Harness that simulates rapid scrubbing and toggling
      const ConcurrencyHarness = ({
        time,
        visible,
        semitones,
      }: {
        time: number;
        visible: boolean;
        semitones: number;
      }) => (
        <ChordBar
          chords={testChords}
          currentTime={time}
          visible={visible}
          semitones={semitones}
          onEditChord={vi.fn()}
        />
      );

      const { rerender } = render(<ConcurrencyHarness time={0.0} visible={true} semitones={0} />);

      // Initial state: before start (0.0s) -> display '—'
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');

      // 100 interleaved sub-frame scrub and toggle operations
      const scrubTimes = [
        0.999999, // before c1
        1.0, // exact start c1 -> C
        1.750123, // inside c1 -> C
        2.499999, // last epsilon of c1 -> C
        2.5, // exact boundary transition c1 -> c2 (G7)
        3.999999, // inside c2 -> G7
        4.0, // gap [4.0, 5.0) -> '—'
        4.5, // gap -> '—'
        5.0, // exact start c3 -> Am
        6.999999, // inside c3 -> Am
        7.0, // after c3 -> '—'
      ];

      let toggleState = true;
      for (let cycle = 0; cycle < 10; cycle++) {
        for (const t of scrubTimes) {
          toggleState = !toggleState;
          rerender(<ConcurrencyHarness time={t} visible={toggleState} semitones={cycle % 3} />);

          if (!toggleState) {
            // Unmounted cleanly
            expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
          } else {
            // Mounted and synchronized
            expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
            const badge = screen.getByTestId('active-chord-badge');

            // Exact sub-frame truth verification
            if (t >= 1.0 && t < 2.5) {
              // C transposed by (cycle % 3)
              const expectedRoot = cycle % 3 === 0 ? 'C' : cycle % 3 === 1 ? 'C#' : 'D';
              expect(badge.textContent).toBe(expectedRoot);
            } else if (t >= 2.5 && t < 4.0) {
              const expectedRoot = cycle % 3 === 0 ? 'G7' : cycle % 3 === 1 ? 'G#7' : 'A7';
              expect(badge.textContent).toBe(expectedRoot);
            } else if (t >= 5.0 && t < 7.0) {
              const expectedRoot = cycle % 3 === 0 ? 'Am' : cycle % 3 === 1 ? 'A#m' : 'Bm';
              expect(badge.textContent).toBe(expectedRoot);
            } else {
              expect(badge.textContent).toBe('—');
            }
          }
        }
      }
    });

    it('2.2: StudioHeader dirty indicator reflects chord changes and clears upon save or undo', () => {
      // Mock window.confirm
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const onNewSongSpy = vi.fn();

      const mockProject: ProjectState = {
        id: 'p_dirty_test',
        title: 'Dirty Indicator Test',
        artist: 'Tester',
        status: 'ready',
        progress: 100,
        lines: [],
        semitones: 0,
        guide_volume: 0,
        chords: baseProgression,
      };

      // Integrated harness connecting useChordHistory to StudioHeader
      const StudioIntegrationHarness = () => {
        const [currentChords, setCurrentChords] = React.useState<ChordSegment[]>(baseProgression);
        const [baseline, setBaseline] = React.useState<ChordSegment[]>(baseProgression);

        const history = useChordHistory({
          projectId: 'p_dirty_test',
          initialChords: baseline,
          currentChords,
          onApplySnapshot: (restored) => {
            setCurrentChords(restored);
          },
        });

        const handleEdit = () => {
          history.pushSnapshot(currentChords);
          const updated = currentChords.map((c, i) => (i === 0 ? { ...c, chord: 'Cmaj7' } : c));
          setCurrentChords(updated);
        };

        const handleSave = () => {
          setBaseline(currentChords);
          history.clearHistory();
        };

        const handleUndoClick = () => {
          const prev = history.undo(currentChords);
          if (prev) {
            setCurrentChords(prev);
          }
        };

        return (
          <div>
            <StudioHeader
              currentUser="Tester"
              project={mockProject}
              isLyricsDirty={history.isDirty}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={onNewSongSpy}
              onStartRender={vi.fn()}
            />
            <button data-testid="edit-btn" onClick={handleEdit}>
              Edit Chord
            </button>
            <button data-testid="save-btn" onClick={handleSave}>
              Save Chords
            </button>
            <button data-testid="undo-btn" onClick={handleUndoClick}>
              Undo Chords
            </button>
            <span data-testid="dirty-status">{history.isDirty ? 'DIRTY' : 'CLEAN'}</span>
          </div>
        );
      };

      render(<StudioIntegrationHarness />);

      const newSongBtn = screen.getByRole('button', { name: /new song/i });
      const editBtn = screen.getByTestId('edit-btn');
      const saveBtn = screen.getByTestId('save-btn');
      const undoBtn = screen.getByTestId('undo-btn');
      const dirtyStatus = screen.getByTestId('dirty-status');

      // 1. Initial State: Clean
      expect(dirtyStatus).toHaveTextContent('CLEAN');
      fireEvent.click(newSongBtn);
      // Clean -> onNewSong called immediately without confirm dialog
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onNewSongSpy).toHaveBeenCalledTimes(1);

      // 2. Edit Chord -> Dirty
      fireEvent.click(editBtn);
      expect(dirtyStatus).toHaveTextContent('DIRTY');

      // Attempting New Song when dirty MUST trigger confirm dialog
      confirmSpy.mockClear();
      onNewSongSpy.mockClear();
      fireEvent.click(newSongBtn);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unsaved lyric timing edits. Discard and return to song search?'
      );
      expect(onNewSongSpy).toHaveBeenCalledTimes(1);

      // 3. Undo back to baseline -> Clears dirty state back to Clean
      fireEvent.click(undoBtn);
      expect(dirtyStatus).toHaveTextContent('CLEAN');

      // New Song now proceeds cleanly without confirm dialog
      confirmSpy.mockClear();
      onNewSongSpy.mockClear();
      fireEvent.click(newSongBtn);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onNewSongSpy).toHaveBeenCalledTimes(1);

      // 4. Edit Chord again -> Dirty
      fireEvent.click(editBtn);
      expect(dirtyStatus).toHaveTextContent('DIRTY');

      // 5. Save Chords -> Clears dirty state back to Clean
      fireEvent.click(saveBtn);
      expect(dirtyStatus).toHaveTextContent('CLEAN');

      // New Song proceeds cleanly without confirm dialog
      confirmSpy.mockClear();
      onNewSongSpy.mockClear();
      fireEvent.click(newSongBtn);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onNewSongSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Scope 3: Undo Persistence Across Saves & Redo in Full App Context
  // =========================================================================
  describe('Scope 3: Undo-after-Save & Redo Re-Persistence Lifecycle in App', () => {
    const mockLines: LyricLine[] = [
      {
        id: 1,
        text: 'Harmonic progression test line',
        start_time: 1.0,
        end_time: 5.0,
        words: [{ word: 'Harmonic', start_time: 1.0, end_time: 5.0 }],
      },
    ];

    const mockAppProject: ProjectState = {
      id: 'p_history_challenger',
      title: 'Adversarial History Song',
      artist: 'Challenger Studio',
      status: 'ready',
      progress: 100,
      lines: mockLines,
      chords: baseProgression,
      semitones: 0,
      guide_volume: 0,
      duration: 10.0,
    };

    it('3.1: Edits chord -> auto-saves (POST #1); Ctrl+Z -> restores prior chord and re-saves (POST #2); Ctrl+Y -> re-applies edit and re-saves (POST #3)', async () => {
      window.history.pushState({}, '', '/?project=p_history_challenger');

      const savedPayloads: Array<{ chords: ChordSegment[] }> = [];

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (
            urlStr.includes('/api/project/p_history_challenger/chords') &&
            init?.method === 'POST'
          ) {
            const body = JSON.parse(init.body as string);
            savedPayloads.push(body);
            return new Response(
              JSON.stringify({
                project_id: 'p_history_challenger',
                chords: body.chords,
                detected: true,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('/api/project/p_history_challenger')) {
            return new Response(JSON.stringify(mockAppProject), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('{}', { status: 200 });
        }
      );

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      // Wait for project and active chord badge to load
      await waitFor(() => {
        expect(screen.getByText('Adversarial History Song')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
      });

      // 1. Edit C -> Cmaj7
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'Cmaj7' } });

      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // Verify POST #1
      await waitFor(() => {
        expect(savedPayloads.length).toBe(1);
      });
      expect(savedPayloads[0].chords[0].chord).toBe('Cmaj7');
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Cmaj7');
      });

      // 2. Press Ctrl+Z (Undo)
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      // Verify POST #2 occurs with restored baseline chord 'C'
      await waitFor(() => {
        expect(savedPayloads.length).toBe(2);
      });
      expect(savedPayloads[1].chords[0].chord).toBe('C');
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
      });

      // 3. Press Ctrl+Y (Redo)
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

      // Verify POST #3 occurs with re-applied edit 'Cmaj7'
      await waitFor(() => {
        expect(savedPayloads.length).toBe(3);
      });
      expect(savedPayloads[2].chords[0].chord).toBe('Cmaj7');
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Cmaj7');
      });

      // 4. Excess Redo past top is safe no-op
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
      expect(savedPayloads.length).toBe(3);

      // 5. Excess Undo past bottom
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      await waitFor(() => {
        expect(savedPayloads.length).toBe(4);
      });
      expect(savedPayloads[3].chords[0].chord).toBe('C');

      // Second undo past bottom: no-op, no 5th POST
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      expect(savedPayloads.length).toBe(4);
    });
  });

  // =========================================================================
  // Scope 4: Concurrency, Rapid Bursts & Keyboard Shortcut Isolation
  // =========================================================================
  describe('Scope 4: Concurrency, Rapid Bursts & Keyboard Shortcut Isolation', () => {
    const mockLines: LyricLine[] = [
      {
        id: 1,
        text: 'Concurrency lyric line',
        start_time: 1.0,
        end_time: 5.0,
        words: [{ word: 'Concurrency', start_time: 1.0, end_time: 5.0 }],
      },
    ];

    const mockConcurrencyProject: ProjectState = {
      id: 'p_concurrency_challenger',
      title: 'Concurrency Stress Song',
      artist: 'Challenger Studio',
      status: 'ready',
      progress: 100,
      lines: mockLines,
      chords: baseProgression,
      semitones: 0,
      guide_volume: 0,
      duration: 10.0,
    };

    it('4.1: Rapid burst of consecutive undo and redo operations does not corrupt stack or throw', () => {
      const initial = [{ id: '1', start: 0, end: 2, chord: 'Root' }];
      const onApply = vi.fn();

      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: initial,
          currentChords: initial,
          maxHistory: 50,
          onApplySnapshot: onApply,
        })
      );

      // Push 10 distinct edits
      for (let i = 1; i <= 10; i++) {
        act(() => {
          result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: `Edit_${i}` }]);
        });
      }
      expect(result.current.undoStack).toHaveLength(10);
      expect(result.current.redoStack).toHaveLength(0);

      // Rapidly fire 20 undo operations (10 valid + 10 past bottom)
      for (let i = 0; i < 20; i++) {
        act(() => {
          result.current.handleUndo();
        });
      }

      // Undo stack exhausted cleanly, redo stack holds the 10 prior states
      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.redoStack).toHaveLength(10);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);

      // Rapidly fire 20 redo operations (10 valid + 10 past top)
      for (let i = 0; i < 20; i++) {
        act(() => {
          result.current.handleRedo();
        });
      }

      // Redo stack exhausted cleanly, undo stack restored to 10
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.undoStack).toHaveLength(10);
      expect(result.current.canRedo).toBe(false);
      expect(result.current.canUndo).toBe(true);
    });

    it('4.2: Rapidly toggle chord bar visibility ("C" key) while scrubbing audio across timeline', async () => {
      window.history.pushState({}, '', '/?project=p_concurrency_challenger');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/p_concurrency_challenger')) {
          return new Response(JSON.stringify(mockConcurrencyProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Concurrency Stress Song')).toBeInTheDocument();
      });

      // Initially ChordBar is visible
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();

      // Rapidly alternate 'C' keypresses (30 rapid toggles)
      for (let i = 0; i < 30; i++) {
        act(() => {
          fireEvent.keyDown(window, { key: i % 2 === 0 ? 'c' : 'C' });
        });
        if (i % 2 === 0) {
          // Toggled OFF
          expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
        } else {
          // Toggled back ON
          expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
        }
      }

      // Final state: 30 iterations (even number) -> ON
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
    });

    it('4.3: Keyboard shortcut isolation: "c" key in inputs does NOT toggle chord bar', async () => {
      window.history.pushState({}, '', '/?project=p_concurrency_challenger');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/p_concurrency_challenger')) {
          return new Response(JSON.stringify(mockConcurrencyProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Concurrency Stress Song')).toBeInTheDocument();
      });
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();

      // Open inline chord edit input
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      expect(input).toBeInTheDocument();

      // Press 'c' inside input element
      fireEvent.keyDown(input, { key: 'c' });
      // ChordBar must remain open
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();

      // Press 'C' inside input element
      fireEvent.keyDown(input, { key: 'C' });
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();

      // Cancel inline edit
      fireEvent.keyDown(input, { key: 'Escape' });

      // Now press 'c' on window (outside input) -> ChordBar must hide
      fireEvent.keyDown(window, { key: 'c' });
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();

      // Press 'c' again -> ChordBar must reappear
      fireEvent.keyDown(window, { key: 'c' });
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Scope 5: Project Transition Boundary
  // =========================================================================
  describe('Scope 5: Project Transition History Boundary', () => {
    it('5.1: Switching project ID resets undo and redo stacks to prevent cross-project history leakage', () => {
      const projAChords = [{ id: 'a1', start: 0, end: 2, chord: 'C' }];
      const projBChords = [{ id: 'b1', start: 0, end: 2, chord: 'G' }];

      const { result, rerender } = renderHook(
        (props: { projectId: string; initialChords: ChordSegment[] }) =>
          useChordHistory({
            projectId: props.projectId,
            initialChords: props.initialChords,
            currentChords: props.initialChords,
            maxHistory: 50,
          }),
        {
          initialProps: {
            projectId: 'proj_A',
            initialChords: projAChords,
          },
        }
      );

      // Perform edits on project A
      act(() => {
        result.current.pushSnapshot(projAChords);
        result.current.pushSnapshot([{ id: 'a1', start: 0, end: 2, chord: 'Dm' }]);
      });
      expect(result.current.undoStack).toHaveLength(2);
      expect(result.current.canUndo).toBe(true);

      // Undo one to populate redoStack
      act(() => {
        result.current.undo([{ id: 'a1', start: 0, end: 2, chord: 'Dm' }]);
      });
      expect(result.current.undoStack).toHaveLength(1);
      expect(result.current.redoStack).toHaveLength(1);
      expect(result.current.canRedo).toBe(true);

      // Switch to project B
      rerender({
        projectId: 'proj_B',
        initialChords: projBChords,
      });

      // Both undo and redo stacks MUST be completely reset for the new project
      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });
  });
});
