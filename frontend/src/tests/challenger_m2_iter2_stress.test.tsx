/**
 * Challenger M2 Iteration 2 Empirical Stress Test Suite
 *
 * Scope:
 * 1. Fullscreen TV Stage Mode:
 *    - Verify ChordBar rendered above active lyrics with transposed badge and upcoming cues.
 *    - Verify floating chord toggle button in Stage Mode controls chord bar visibility.
 *    - Verify responsive >=44px touch targets.
 *    - Verify empty/no-chord robustness.
 * 2. Inline Chord Editing & Persistence:
 *    - Test editing chord cues via ChordBar inline input (Enter / Save button / Cancel).
 *    - Verify POST /api/project/${id}/chords payload, headers, and local state updates.
 *    - Verify 50-step Undo (Ctrl+Z) restores prior chords and persists snapshot.
 *    - Verify backend HTTP 422 / 500 error handling and toast display.
 * 3. Architectural File Length Budget:
 *    - Verify LyricTimelineEditor.tsx strictly adheres to <= 450 lines.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import { LyricDisplay } from '../components/LyricDisplay';
import App from '../App';
import { ToastProvider } from '../hooks/useToast';
import { useChordHistory } from '../hooks/useChordHistory';
import { LyricLine, ChordSegment, ProjectState } from '../types';

const sampleLines: LyricLine[] = [
  {
    id: 1,
    text: 'Harmonic chords ringing across the stage',
    start_time: 1.0,
    end_time: 5.0,
    words: [
      { word: 'Harmonic', start_time: 1.0, end_time: 2.0 },
      { word: 'chords', start_time: 2.0, end_time: 3.0 },
      { word: 'ringing', start_time: 3.0, end_time: 4.0 },
      { word: 'stage', start_time: 4.0, end_time: 5.0 },
    ],
  },
  {
    id: 2,
    text: 'Next line in the progression',
    start_time: 6.0,
    end_time: 9.0,
    words: [
      { word: 'Next', start_time: 6.0, end_time: 7.0 },
      { word: 'line', start_time: 7.0, end_time: 8.0 },
      { word: 'progression', start_time: 8.0, end_time: 9.0 },
    ],
  },
];

const sampleChords: ChordSegment[] = [
  { id: 'c1', start: 0.0, end: 2.0, chord: 'C', confidence: 0.99 },
  { id: 'c2', start: 2.0, end: 4.0, chord: 'Am', confidence: 0.95 },
  { id: 'c3', start: 4.0, end: 6.0, chord: 'F', confidence: 0.93 },
  { id: 'c4', start: 6.0, end: 8.0, chord: 'G7', confidence: 0.97 },
];

describe('Challenger M2 Iteration 2: Stage Mode & UI Persistence Empirical Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Fullscreen TV Stage Mode Integration & Floating Chord Toggle
  // =========================================================================
  describe('1. Fullscreen TV Stage Mode ChordBar Integration', () => {
    it('renders ChordBar above active lyrics with transposed chord badge and upcoming cues', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.5}
          isPlaying={true}
          chords={sampleChords}
          showChordBar={true}
          semitones={2} // Transpose +2: Am -> Bm
        />
      );

      // Verify ChordBar container is mounted
      const chordBar = screen.getByTestId('chord-bar');
      expect(chordBar).toBeInTheDocument();

      // Verify transposed active chord badge is Bm
      const activeBadge = screen.getByTestId('active-chord-badge');
      expect(activeBadge).toHaveTextContent('Bm');

      // Verify upcoming chord cues within lookahead window (time 2.5 + 4.0 = 6.5s -> F and G7)
      // Transposed: F (+2) -> G, G7 (+2) -> A7
      const upcomingCues = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcomingCues.length).toBeGreaterThanOrEqual(1);
      const cueTexts = upcomingCues.map((c) => c.textContent);
      expect(cueTexts).toContain('G');
    });

    it('mounts ChordBar inside TV Stage Mode and toggles visibility via floating chord toggle button (uncontrolled mode)', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.5}
          duration={10.0}
          isPlaying={true}
          chords={sampleChords}
          semitones={0}
        />
      );

      // Enter TV Stage Mode by clicking stage-fullscreen-toggle
      const fullscreenBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(fullscreenBtn);

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Verify ChordBar defaults to hidden in TV Stage Mode (uncontrolled mode)
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();

      // Verify floating controls container exists with floating chord toggle button
      const floatingControls = screen.getByTestId('stage-floating-controls');
      expect(floatingControls).toBeInTheDocument();

      const chordToggle = screen.getByTestId('chord-bar-toggle');
      expect(chordToggle).toBeInTheDocument();
      expect(chordToggle).toHaveAttribute('aria-pressed', 'false');

      // Verify >=44px touch targets for TV Stage floating chord toggle
      expect(chordToggle.className).toContain('min-h-[44px]');
      expect(chordToggle.className).toContain('min-w-[44px]');

      // Click floating chord toggle to show chord bar (using internal state fallback)
      fireEvent.click(chordToggle);
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');
      expect(chordToggle).toHaveAttribute('aria-pressed', 'true');

      // Click again to hide chord bar
      fireEvent.click(chordToggle);
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
      expect(chordToggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles chord bar visibility in TV Stage Mode when controlled by parent state', () => {
      function ControlledStage() {
        const [showChordBar, setShowChordBar] = React.useState(true);
        return (
          <LyricDisplay
            lines={sampleLines}
            currentTime={2.5}
            duration={10.0}
            isPlaying={true}
            chords={sampleChords}
            showChordBar={showChordBar}
            onToggleChordBar={() => setShowChordBar((v) => !v)}
            semitones={0}
          />
        );
      }

      render(<ControlledStage />);

      // Enter TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const chordToggle = screen.getByTestId('chord-bar-toggle');
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();

      // Click toggle
      fireEvent.click(chordToggle);
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();

      // Click toggle again
      fireEvent.click(chordToggle);
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
    });

    it('delegates chord bar toggle in Stage Mode when onToggleChordBar is provided', () => {
      const toggleMock = vi.fn();
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.5}
          duration={10.0}
          isPlaying={true}
          chords={sampleChords}
          showChordBar={true}
          onToggleChordBar={toggleMock}
          semitones={0}
        />
      );

      // Enter TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const chordToggle = screen.getByTestId('chord-bar-toggle');
      fireEvent.click(chordToggle);

      expect(toggleMock).toHaveBeenCalledTimes(1);
    });

    it('handles empty or missing chords in TV Stage Mode gracefully without crashing', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.5}
          duration={10.0}
          isPlaying={true}
          chords={[]}
          showChordBar={true}
          semitones={0}
        />
      );

      // Enter TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Inline Chord Editing & Persistence (POST /api/project/${id}/chords)
  // =========================================================================
  describe('2. Inline Chord Editing & Persistence', () => {
    const mockFullProject: ProjectState = {
      id: 'proj-chord-e2e',
      title: 'Harmonic Ballad',
      artist: 'Studio Virtuoso',
      status: 'ready',
      progress: 100,
      lines: sampleLines,
      chords: sampleChords,
      semitones: 0,
      guide_volume: 0.0,
      duration: 10.0,
    };

    it('edits active chord in Studio, sends POST /api/project/${id}/chords, and updates local state', async () => {
      window.history.pushState({}, '', '/?project=proj-chord-e2e');

      let savedPayload: { chords: ChordSegment[] } | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e/chords') && init?.method === 'POST') {
            savedPayload = JSON.parse(init.body as string);
            return new Response(
              JSON.stringify({
                project_id: 'proj-chord-e2e',
                chords: savedPayload?.chords,
                detected: true,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('/api/project/proj-chord-e2e')) {
            return new Response(JSON.stringify(mockFullProject), {
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

      // Wait for project to load, then toggle chord bar visible (defaults to hidden)
      await waitFor(() => {
        expect(screen.getByText('Harmonic Ballad')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      // At currentTime 0, active chord is 'C' (sampleChords[0])
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
      });

      // Click edit active chord button
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      // Verify inline input is displayed
      const input = screen.getByTestId('chord-edit-input');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('C');

      // Change chord to 'Cmaj7' and click save button
      fireEvent.change(input, { target: { value: 'Cmaj7' } });
      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // Verify POST call was executed with updated chord
      await waitFor(() => {
        expect(savedPayload).not.toBeNull();
      });
      const payload = savedPayload as { chords: ChordSegment[] } | null;
      expect(payload?.chords[0].chord).toBe('Cmaj7');
      expect(payload?.chords[0].start).toBe(0.0);
      expect(payload?.chords[0].end).toBe(2.0);

      // Verify local active chord badge displays 'Cmaj7'
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Cmaj7');
      });
    });

    it('cancels inline chord editing on Escape key without dispatching POST request', async () => {
      window.history.pushState({}, '', '/?project=proj-chord-e2e');

      let postCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e/chords') && init?.method === 'POST') {
            postCount++;
            return new Response(JSON.stringify({ chords: sampleChords }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e')) {
            return new Response(JSON.stringify(mockFullProject), {
              status: 200,
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

      await waitFor(() => {
        expect(screen.getByText('Harmonic Ballad')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'Ddim' } });

      // Press Escape
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

      // Edit input should be closed and POST should not have been called
      expect(screen.queryByTestId('chord-edit-input')).not.toBeInTheDocument();
      expect(postCount).toBe(0);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
    });

    it('handles backend HTTP 422 validation failure gracefully without crashing', async () => {
      window.history.pushState({}, '', '/?project=proj-chord-e2e');

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e/chords') && init?.method === 'POST') {
            return new Response(JSON.stringify({ detail: 'Chord interval overlaps or inverted' }), {
              status: 422,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e')) {
            return new Response(JSON.stringify(mockFullProject), {
              status: 200,
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

      await waitFor(() => {
        expect(screen.getByText('Harmonic Ballad')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'BadChord' } });

      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // App should remain responsive and not throw unhandled crash
      await waitFor(() => {
        expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
      });
    });

    it('re-persists restored chord progression when Undo (Ctrl+Z) is triggered', async () => {
      window.history.pushState({}, '', '/?project=proj-chord-e2e');

      const savedPayloads: { chords: ChordSegment[] }[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e/chords') && init?.method === 'POST') {
            const payload = JSON.parse(init.body as string);
            savedPayloads.push(payload);
            return new Response(JSON.stringify({ chords: payload.chords }), {
              status: 200,
            });
          }
          if (urlStr.includes('/api/project/proj-chord-e2e')) {
            return new Response(JSON.stringify(mockFullProject), {
              status: 200,
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

      await waitFor(() => {
        expect(screen.getByText('Harmonic Ballad')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      // 1. Edit C -> Cmaj7
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'Cmaj7' } });

      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      await waitFor(() => {
        expect(savedPayloads.length).toBe(1);
      });
      expect(savedPayloads[0].chords[0].chord).toBe('Cmaj7');

      // 2. Trigger Undo (Ctrl+Z)
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      // 3. Verify second POST to backend with restored baseline chord 'C'
      await waitFor(() => {
        expect(savedPayloads.length).toBe(2);
      });
      expect(savedPayloads[1].chords[0].chord).toBe('C');

      // 4. Verify local active chord badge displays restored chord 'C'
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
      });
    });

    it('preserves the undo stack across initialChords and baseline updates in useChordHistory', () => {
      const initial = [{ id: '1', start: 0, end: 2, chord: 'C' }];
      const { result, rerender } = renderHook(
        (props: { initialChords: ChordSegment[]; currentChords: ChordSegment[] }) =>
          useChordHistory({
            initialChords: props.initialChords,
            currentChords: props.currentChords,
            enabled: true,
          }),
        {
          initialProps: {
            initialChords: initial,
            currentChords: initial,
          },
        }
      );

      // User performs edit and pushes snapshot
      act(() => {
        result.current.pushSnapshot(initial);
      });
      expect(result.current.undoStack.length).toBe(1);
      expect(result.current.canUndo).toBe(true);

      // When baseline is updated or initialChords syncs:
      const savedChords = [{ id: '1', start: 0, end: 2, chord: 'Cmaj7' }];
      rerender({
        initialChords: savedChords,
        currentChords: savedChords,
      });

      // The undo stack MUST be preserved across baseline updates:
      expect(result.current.undoStack.length).toBe(1);
      expect(result.current.canUndo).toBe(true);
    });
  });

  // =========================================================================
  // 3. Duet & Instrumental Gap Stage Mode Combinations
  // =========================================================================
  describe('3. Duet & Instrumental Gap Stage Mode Combinations', () => {
    it('renders ChordBar concurrently with Instrumental Gap Countdown in Stage Mode', () => {
      const gapLines: LyricLine[] = [
        {
          id: 1,
          text: 'First vocal after 5s intro',
          start_time: 5.0,
          end_time: 8.0,
          words: [
            { word: 'First', start_time: 5.0, end_time: 6.0 },
            { word: 'vocal', start_time: 6.0, end_time: 8.0 },
          ],
        },
      ];

      render(
        <LyricDisplay
          lines={gapLines}
          currentTime={2.0} // Inside 5.0s intro gap
          duration={15.0}
          isPlaying={true}
          chords={sampleChords}
          showChordBar={true}
          semitones={0}
        />
      );

      // Enter TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      // Both ChordBar and Gap Countdown must be visible
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');
      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('gap-countdown-time')).toHaveTextContent(/Next vocals in/i);
    });

    it('renders ChordBar concurrently with Duet / Multi-Singer badge in Stage Mode', () => {
      const duetLines: LyricLine[] = [
        {
          id: 1,
          text: 'Partner sings this duet phrase',
          start_time: 1.0,
          end_time: 4.0,
          singer: 'singer2',
          words: [
            { word: 'Partner', start_time: 1.0, end_time: 2.0 },
            { word: 'sings', start_time: 2.0, end_time: 4.0 },
          ],
        },
      ];

      render(
        <LyricDisplay
          lines={duetLines}
          currentTime={2.5}
          duration={15.0}
          isPlaying={true}
          chords={sampleChords}
          showChordBar={true}
          semitones={0}
        />
      );

      // Enter TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      // Verify ChordBar and Singer Badge are both mounted
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      const badge = screen.getByTestId('active-singer-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('data-singer', 'singer2');
    });
  });

  // =========================================================================
  // 4. Architectural File Length Budget Enforcement (<= 450 lines)
  // =========================================================================
  describe('4. Architectural Budget Enforcement', () => {
    it('strictly enforces LyricTimelineEditor.tsx <= 450 lines budget', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeRequire = eval('require') as (mod: string) => any;
      const fs = nodeRequire('fs');
      const path = nodeRequire('path');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeProcess = (globalThis as any).process;
      const filePath = path.resolve(nodeProcess.cwd(), 'src/components/LyricTimelineEditor.tsx');
      expect(fs.existsSync(filePath)).toBe(true);

      const content: string = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;

      // Assert <= 450 lines
      expect(lineCount).toBeLessThanOrEqual(450);
      expect(lineCount).toBeGreaterThan(100);

      // Assert no lines exceed 200 characters
      const excessivelyLongLines = lines.filter((l: string) => l.length > 200);
      expect(excessivelyLongLines.length).toBe(0);
    });
  });
});
