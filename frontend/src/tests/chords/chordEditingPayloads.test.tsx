/**
 * Empirical Adversarial Challenger Test Suite: Milestone 2 Iteration 3
 * Focus: Stage Mode Chord Integration, UI Persistence & Monotonicity, and Line Budget Compliance
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';
import { LyricDisplay } from '../../components/LyricDisplay';
import { ChordSegment, LyricLine, ProjectState } from '../../types';

// ============================================================================
// Test Data & Fixtures
// ============================================================================

const mockLyricLines: LyricLine[] = [
  {
    id: 1,
    text: 'Harmonic chords ringing in the air',
    start_time: 1.0,
    end_time: 5.0,
    words: [
      { word: 'Harmonic', start_time: 1.0, end_time: 2.0 },
      { word: 'chords', start_time: 2.1, end_time: 3.0 },
      { word: 'ringing', start_time: 3.1, end_time: 4.0 },
      { word: 'in', start_time: 4.1, end_time: 4.4 },
      { word: 'the', start_time: 4.5, end_time: 4.7 },
      { word: 'air', start_time: 4.8, end_time: 5.0 },
    ],
    singer: 'singer1',
  },
  {
    id: 2,
    text: 'Melody soaring everywhere',
    start_time: 6.0,
    end_time: 10.0,
    words: [
      { word: 'Melody', start_time: 6.0, end_time: 7.5 },
      { word: 'soaring', start_time: 7.6, end_time: 8.8 },
      { word: 'everywhere', start_time: 8.9, end_time: 10.0 },
    ],
    singer: 'singer2',
  },
];

const mockChords: ChordSegment[] = [
  { id: 'chord-1', start: 0.0, end: 2.0, chord: 'C', confidence: 0.99 },
  { id: 'chord-2', start: 2.0, end: 4.0, chord: 'Am', confidence: 0.95 },
  { id: 'chord-3', start: 4.0, end: 6.0, chord: 'F', confidence: 0.93 },
  { id: 'chord-4', start: 6.0, end: 8.0, chord: 'G7', confidence: 0.97 },
  { id: 'chord-5', start: 8.0, end: 10.0, chord: 'C', confidence: 0.99 },
];

const mockProjectState: ProjectState = {
  id: 'proj-challenger-m2-iter3',
  title: 'Challenger Harmonic Symphony',
  artist: 'Orchestrator Enclave',
  status: 'ready',
  progress: 100,
  lines: mockLyricLines,
  chords: mockChords,
  semitones: 0,
  guide_volume: 0.0,
  duration: 12.0,
};

// Monotonicity verification oracle
function assertTimestampMonotonicity(chords: ChordSegment[]) {
  expect(Array.isArray(chords)).toBe(true);
  for (let i = 0; i < chords.length; i++) {
    const curr = chords[i];
    expect(Number.isFinite(curr.start)).toBe(true);
    expect(Number.isFinite(curr.end)).toBe(true);
    expect(curr.start).toBeGreaterThanOrEqual(0);
    expect(curr.start).toBeLessThan(curr.end); // start < end

    if (i < chords.length - 1) {
      const next = chords[i + 1];
      expect(curr.end).toBeLessThanOrEqual(next.start); // end_i <= start_{i+1}
    }
  }
}

describe('Empirical Challenger: Milestone 2 Iteration 3 Scope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Scope 1: Fullscreen TV Stage Mode Chord Integration & Floating Toggle
  // ==========================================================================
  describe('1. Fullscreen TV Stage Mode Chord Integration', () => {
    it('renders ChordBar strictly above active lyrics in TV Stage Mode with transposed badge and upcoming cues', () => {
      render(
        <LyricDisplay
          lines={mockLyricLines}
          currentTime={1.5}
          duration={12.0}
          isPlaying={true}
          chords={mockChords}
          semitones={2} // Transpose +2 semitones: C -> D, Am -> Bm, F -> G
          keyHint="D"
          showChordBar={true}
        />
      );

      // Enter fullscreen TV Stage Mode via button
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      const toggleFullscreenBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(toggleFullscreenBtn);

      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // 1. Verify ChordBar is rendered
      const chordBar = screen.getByTestId('chord-bar');
      expect(chordBar).toBeInTheDocument();

      // 2. Verify ChordBar is rendered ABOVE active lyrics line in DOM tree
      const activeLyrics = screen.getByTestId('active-lyrics-line');
      expect(activeLyrics).toBeInTheDocument();

      const positionComparison = chordBar.compareDocumentPosition(activeLyrics);
      // DOCUMENT_POSITION_FOLLOWING (4) means activeLyrics follows chordBar in DOM order
      expect(positionComparison & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // 3. Verify active chord badge is transposed by +2 semitones: C (0-2s) transposed +2 is 'D'
      const activeBadge = screen.getByTestId('active-chord-badge');
      expect(activeBadge).toHaveTextContent('D');

      // 4. Verify upcoming cues strip is rendered with transposed chords within lookahead window (4.0s)
      // At currentTime 1.5s, lookahead window is up to 5.5s.
      // Upcoming chords in window: chord-2 (start: 2.0, Am -> Bm) and chord-3 (start: 4.0, F -> G)
      const upcomingCues = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcomingCues.length).toBeGreaterThanOrEqual(2);
      expect(upcomingCues[0]).toHaveTextContent('Bm');
      expect(upcomingCues[1]).toHaveTextContent('G');
    });

    it('handles negative transposition with flat key enharmonic spelling in Stage Mode', () => {
      render(
        <LyricDisplay
          lines={mockLyricLines}
          currentTime={1.5}
          duration={12.0}
          isPlaying={true}
          chords={mockChords}
          semitones={-2} // C - 2 = Bb, Am - 2 = Gm, F - 2 = Eb
          keyHint="F" // Flat key
          showChordBar={true}
        />
      );

      // Enter Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const activeBadge = screen.getByTestId('active-chord-badge');
      expect(activeBadge).toHaveTextContent('Bb');

      const upcomingCues = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcomingCues[0]).toHaveTextContent('Gm');
      expect(upcomingCues[1]).toHaveTextContent('Eb');
    });

    it('floating chord toggle button in Stage Mode toggles chord bar visibility and conforms to >=44px touch targets', () => {
      render(
        <LyricDisplay
          lines={mockLyricLines}
          currentTime={1.5}
          duration={12.0}
          isPlaying={true}
          chords={mockChords}
        />
      );

      // Enter Fullscreen TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      // Verify floating controls container exists in stage mode
      const floatingControls = screen.getByTestId('stage-floating-controls');
      expect(floatingControls).toBeInTheDocument();

      // The chord toggle lives once in the stage toolbar (not duplicated into the playback bar)
      expect(screen.getAllByTestId('chord-bar-toggle')).toHaveLength(1);
      const chordToggleBtn = within(screen.getByTestId('stage-toolbar')).getByTestId(
        'chord-bar-toggle'
      );
      // Toggle semantics: a stable name with the state carried by aria-pressed
      expect(chordToggleBtn).toHaveAttribute('aria-label', 'Chord bar');
      expect(chordToggleBtn).toHaveAttribute('aria-pressed', 'false');

      // Verify touch target dimension classes (min-h-[44px] min-w-[44px])
      expect(chordToggleBtn.className).toContain('min-h-[44px]');
      expect(chordToggleBtn.className).toContain('min-w-[44px]');

      // Initially ChordBar is hidden by default
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();

      // Click to show ChordBar
      fireEvent.click(chordToggleBtn);

      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      expect(chordToggleBtn).toHaveAttribute('aria-label', 'Chord bar');
      expect(chordToggleBtn).toHaveAttribute('aria-pressed', 'true');

      // Click again to hide ChordBar
      fireEvent.click(chordToggleBtn);

      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
      expect(chordToggleBtn).toHaveAttribute('aria-label', 'Chord bar');
      expect(chordToggleBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('respects controlled onToggleChordBar and showChordBar props in Stage Mode', () => {
      const handleToggle = vi.fn();
      render(
        <LyricDisplay
          lines={mockLyricLines}
          currentTime={1.5}
          duration={12.0}
          isPlaying={true}
          chords={mockChords}
          showChordBar={true}
          onToggleChordBar={handleToggle}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const chordToggleBtn = screen.getByTestId('chord-bar-toggle');
      fireEvent.click(chordToggleBtn);

      expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    it('triggers seek when an upcoming chord cue is clicked in Stage Mode', () => {
      const handleSeek = vi.fn();
      render(
        <LyricDisplay
          lines={mockLyricLines}
          currentTime={1.5}
          duration={12.0}
          isPlaying={true}
          chords={mockChords}
          showChordBar={true}
          onSeek={handleSeek}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const upcomingCues = screen.getAllByTestId('upcoming-chord-cue');
      // Click chord-2 (start: 2.0)
      fireEvent.click(upcomingCues[0]);

      expect(handleSeek).toHaveBeenCalledWith(2.0);
    });
  });

  // ==========================================================================
  // Scope 2: Inline Chord Editing & Persistence (POST /api/project/${id}/chords)
  // ==========================================================================
  describe('2. Inline Chord Editing, Payload Format & Timestamp Monotonicity', () => {
    it('edits chord cue in Fullscreen Stage Mode, dispatches POST with strict timestamp monotonicity and valid format', async () => {
      window.history.pushState({}, '', '/?project=proj-challenger-m2-iter3');

      let interceptedRequest: {
        url: string;
        method: string;
        body: string;
        headers: HeadersInit;
      } | null = null;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (
            urlStr.includes('/api/project/proj-challenger-m2-iter3/chords') &&
            init?.method === 'POST'
          ) {
            interceptedRequest = {
              url: urlStr,
              method: init.method,
              body: init.body as string,
              headers: init.headers as HeadersInit,
            };
            const parsed = JSON.parse(init.body as string);
            return new Response(
              JSON.stringify({
                status: 'ok',
                project_id: 'proj-challenger-m2-iter3',
                chords_count: parsed.chords.length,
                chords: parsed.chords,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('/api/project/proj-challenger-m2-iter3')) {
            return new Response(JSON.stringify(mockProjectState), {
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

      await waitFor(() => {
        expect(screen.getByText('Challenger Harmonic Symphony')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      // Enter Fullscreen TV Stage Mode
      const stageToggle = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(stageToggle);

      expect(screen.getByTestId('lyric-display-stage')).toHaveAttribute('data-fullscreen', 'true');

      // Verify active chord badge is 'C'
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

      // Click edit active chord button
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('C');

      // Edit chord to 'Cmaj7' and click save button
      fireEvent.change(input, { target: { value: 'Cmaj7' } });
      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      // 1. Verify intercepted POST request
      await waitFor(() => {
        expect(interceptedRequest).not.toBeNull();
      });

      const req = interceptedRequest as { url: string; method: string; body: string } | null;
      expect(req?.url).toContain('/api/project/proj-challenger-m2-iter3/chords');
      expect(req?.method).toBe('POST');

      // 2. Parse and verify payload schema and content
      const payload = JSON.parse(req!.body);
      expect(payload).toHaveProperty('chords');
      expect(Array.isArray(payload.chords)).toBe(true);
      expect(payload.chords.length).toBe(mockChords.length);

      // Verify edited chord segment
      const editedSegment = payload.chords[0];
      expect(editedSegment.chord).toBe('Cmaj7');
      expect(editedSegment.start).toBe(0.0);
      expect(editedSegment.end).toBe(2.0);

      // 3. Empirical Monotonicity Oracle:
      // Must satisfy: for all i, start < end, and end_i <= start_{i+1}
      assertTimestampMonotonicity(payload.chords);

      // 4. Verify local active chord badge updated in Stage Mode
      await waitFor(() => {
        expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Cmaj7');
      });
    });

    it('cancelling chord edit in Stage Mode emits zero network requests and preserves baseline', async () => {
      window.history.pushState({}, '', '/?project=proj-challenger-m2-iter3');

      let postCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (
            urlStr.includes('/api/project/proj-challenger-m2-iter3/chords') &&
            init?.method === 'POST'
          ) {
            postCount++;
            return new Response(JSON.stringify({ chords: mockChords }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-challenger-m2-iter3')) {
            return new Response(JSON.stringify(mockProjectState), {
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

      await waitFor(() => {
        expect(screen.getByText('Challenger Harmonic Symphony')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      // Enter Fullscreen TV Stage Mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      // Start edit
      fireEvent.click(screen.getByTestId('edit-active-chord-btn'));
      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'Bbm' } });

      // Click cancel button
      const cancelBtn = screen.getByTestId('cancel-chord-edit-btn');
      fireEvent.click(cancelBtn);

      expect(screen.queryByTestId('chord-edit-input')).not.toBeInTheDocument();
      expect(postCount).toBe(0);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
    });

    it('Undo (Ctrl+Z) after inline edit triggers second POST with strictly monotonic restored progression', async () => {
      window.history.pushState({}, '', '/?project=proj-challenger-m2-iter3');

      const savedPayloads: { chords: ChordSegment[] }[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (
            urlStr.includes('/api/project/proj-challenger-m2-iter3/chords') &&
            init?.method === 'POST'
          ) {
            const parsed = JSON.parse(init.body as string);
            savedPayloads.push(parsed);
            return new Response(JSON.stringify({ chords: parsed.chords }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-challenger-m2-iter3')) {
            return new Response(JSON.stringify(mockProjectState), {
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

      await waitFor(() => {
        expect(screen.getByText('Challenger Harmonic Symphony')).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: 'c' });

      // Edit C -> G#dim
      fireEvent.click(screen.getByTestId('edit-active-chord-btn'));
      const input = screen.getByTestId('chord-edit-input');
      fireEvent.change(input, { target: { value: 'G#dim' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('save-chord-edit-btn'));
      });

      await waitFor(() => {
        expect(savedPayloads.length).toBe(1);
      });
      expect(savedPayloads[0].chords[0].chord).toBe('G#dim');
      assertTimestampMonotonicity(savedPayloads[0].chords);

      // Trigger Undo
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      // Second POST should be dispatched with restored original chord 'C'
      await waitFor(() => {
        expect(savedPayloads.length).toBe(2);
      });
      expect(savedPayloads[1].chords[0].chord).toBe('C');
      assertTimestampMonotonicity(savedPayloads[1].chords);
    });
  });

  // ==========================================================================
  // Scope 3: Architectural Budget Enforcement (LyricTimelineEditor.tsx)
  // ==========================================================================
  describe('3. Architectural Line & Length Limits on LyricTimelineEditor.tsx', () => {
    it('satisfies total line count <= 450 lines and zero lines > 200 chars', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeRequire = eval('require') as (mod: string) => any;
      const fsModule = nodeRequire('fs');
      const pathModule = nodeRequire('path');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeProcess = (globalThis as any).process;
      const editorPath = pathModule.resolve(
        nodeProcess.cwd(),
        'src/components/LyricTimelineEditor.tsx'
      );
      expect(fsModule.existsSync(editorPath)).toBe(true);

      const content: string = fsModule.readFileSync(editorPath, 'utf-8');
      const lines: string[] = content.split('\n');

      // 1. Total line count <= 450 lines
      const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;
      expect(lineCount).toBeLessThanOrEqual(450);

      // 2. Zero lines exceeding 200 characters
      const overLongLines: { lineNumber: number; length: number; text: string }[] = [];
      lines.forEach((lineText: string, idx: number) => {
        if (lineText.length > 200) {
          overLongLines.push({
            lineNumber: idx + 1,
            length: lineText.length,
            text: lineText,
          });
        }
      });

      expect(overLongLines).toEqual([]);
    });
  });
});
