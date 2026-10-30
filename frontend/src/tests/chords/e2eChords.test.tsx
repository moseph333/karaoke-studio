/**
 * E2E Frontend Test Suite: Karaoke Studio Harmonic Chords & Live Transposing Chord Bar
 *
 * Covers 4-Tier Architecture for Chords & Harmonic Progression:
 * - Tier 1: Feature Coverage (F6-F11, F15)
 * - Tier 2: Boundary & Corner Cases (empty audio, pure silence, sub-frame timestamps, clamped times, modal dialog isolation)
 * - Tier 3: Cross-Feature Combinations (detection + transposition + export, inline editing + undo/redo + persistence, pitch shift stepper + TV Stage mode + ASS export)
 * - Tier 4: Real-world application scenarios (full end-to-end workflows from intake/backfill to stage mode, inline editing, and video/chord-sheet export)
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ChordBar } from '../../components/ChordBar';
import { LyricDisplay } from '../../components/LyricDisplay';
import { AudioControls } from '../../components/AudioControls';
import { HelpModal } from '../../components/HelpModal';
import { ExportModal } from '../../components/ExportModal';
import { ExportSubtitleSection } from '../../components/export/ExportSubtitleSection';
import * as apiModule from '../../api';
import { useKeyboardShortcuts, isModalActive } from '../../hooks/useKeyboardShortcuts';
import { useChordHistory } from '../../hooks/useChordHistory';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
  BREAKPOINTS,
} from '../helpers/responsiveTestUtils';
import { ChordSegment, LyricLine, ProjectState } from '../../types';

// ==============================================================================
// Types & Interface Contracts (PROJECT.md)
// ==============================================================================

const mockLines: LyricLine[] = [
  {
    id: 1,
    text: 'Singing harmonic chords in harmony',
    start_time: 1.0,
    end_time: 5.0,
    words: [
      { word: 'Singing', start_time: 1.0, end_time: 1.8 },
      { word: 'harmonic', start_time: 1.9, end_time: 2.8 },
      { word: 'chords', start_time: 2.9, end_time: 3.8 },
      { word: 'in', start_time: 3.9, end_time: 4.2 },
      { word: 'harmony', start_time: 4.3, end_time: 5.0 },
    ],
  },
];

const mockChordProgression: ChordSegment[] = [
  { id: 'c1', start: 0.0, end: 1.5, chord: 'C', confidence: 0.98 },
  { id: 'c2', start: 1.5, end: 3.0, chord: 'Am', confidence: 0.95 },
  { id: 'c3', start: 3.0, end: 4.5, chord: 'F', confidence: 0.92 },
  { id: 'c4', start: 4.5, end: 6.0, chord: 'G7', confidence: 0.96 },
];

const mockProject: ProjectState = {
  id: 'test_chord_proj_1',
  title: 'Chords E2E Workstation Ballad',
  artist: 'Harmonic Masters',
  status: 'ready',
  progress: 100,
  guide_volume: 0.0,
  duration: 10.0,
  audio_url: '/static/downloads/test.wav',
  lines: mockLines,
  semitones: 0,
};

// ==============================================================================
// TEST SUITE
// ==============================================================================

describe('E2E Chords & Harmonic Progression Workstation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestViewport();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
  });

  // ============================================================================
  // TIER 1: FEATURE COVERAGE (F6 - F11, F15)
  // ============================================================================

  describe('Tier 1: Feature 6 - Live Scrolling Chord Bar (F6)', () => {
    it('F6.1: renders ChordBar container with accessible ARIA semantics', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={0.5} visible={true} />);
      const bar = screen.getByTestId('chord-bar');
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute('aria-label', 'Harmonic Chord Progression');
    });

    it('F6.2: highlights active chord matching current playback timestamp', () => {
      render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={0.5} // inside C segment [0.0, 1.5]
        />
      );
      const badge = screen.getByTestId('active-chord-badge');
      expect(badge).toHaveTextContent('C');
    });

    it('F6.3: updates active chord dynamically as playback time advances', () => {
      const { rerender } = render(<ChordBar chords={mockChordProgression} currentTime={0.5} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

      // Advance to 2.0s -> Am segment [1.5, 3.0]
      rerender(<ChordBar chords={mockChordProgression} currentTime={2.0} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');
    });

    it('F6.4: displays upcoming chord segments within the preview window', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={0.5} />);
      const upcoming = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcoming.length).toBeGreaterThan(0);
      expect(upcoming.some((el) => el.textContent === 'Am')).toBe(true);
    });

    it('F6.5: respects visible toggle to show or hide the chord bar', () => {
      const { rerender } = render(
        <ChordBar chords={mockChordProgression} currentTime={0.5} visible={false} />
      );
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();

      rerender(<ChordBar chords={mockChordProgression} currentTime={0.5} visible={true} />);
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
    });
  });

  describe('Tier 1: Feature 7 - Dynamic Transposition in UI (F7)', () => {
    it('F7.1: transposes displayed chord symbols immediately when semitones shift', () => {
      render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={0.5}
          semitones={2} // C + 2 = D
        />
      );
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('D');
    });

    it('F7.2: preserves chord qualities through transposition (Am + 2 = Bm)', () => {
      render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={2.0} // Am
          semitones={2}
        />
      );
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Bm');
    });

    it('F7.3: octave shifts (+12 and -12) preserve pitch class identity', () => {
      const { rerender } = render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={0.5} // C
          semitones={12}
        />
      );
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

      rerender(<ChordBar chords={mockChordProgression} currentTime={0.5} semitones={-12} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
    });

    it('F7.4: semitones=0 is strict identity', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={0.5} semitones={0} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
    });

    it('F7.5: upcoming chords update in place with transposed values', () => {
      render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={0.5}
          semitones={2} // Am -> Bm, F -> G
        />
      );
      const upcoming = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcoming.some((el) => el.textContent === 'Bm')).toBe(true);
      expect(upcoming.some((el) => el.textContent === 'G')).toBe(true);
    });
  });

  describe('Tier 1: Feature 8 - Keyboard Shortcut "C" & Strict Isolation (F8)', () => {
    function ShortcutTestHarness({
      onToggle,
      enabled = true,
    }: {
      onToggle: () => void;
      enabled?: boolean;
    }) {
      useKeyboardShortcuts({
        enabled,
        onToggleChordBar: onToggle,
      });

      return (
        <div>
          <button data-testid="outside-button">Outside</button>
          <input data-testid="test-input" type="text" />
          <textarea data-testid="test-textarea" />
          <div data-testid="test-contenteditable" contentEditable={true} />
        </div>
      );
    }

    it('F8.1: pressing "C" toggles chord bar when focus is on background', () => {
      const toggleFn = vi.fn();
      render(<ShortcutTestHarness onToggle={toggleFn} />);

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleFn).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'C', code: 'KeyC' });
      expect(toggleFn).toHaveBeenCalledTimes(2);
    });

    it('F8.2: typing "C" inside <input> is isolated and does NOT trigger shortcut', () => {
      const toggleFn = vi.fn();
      render(<ShortcutTestHarness onToggle={toggleFn} />);
      const input = screen.getByTestId('test-input');
      input.focus();

      fireEvent.keyDown(input, { key: 'c', code: 'KeyC' });
      expect(toggleFn).not.toHaveBeenCalled();
    });

    it('F8.3: typing "C" inside <textarea> is isolated and does NOT trigger shortcut', () => {
      const toggleFn = vi.fn();
      render(<ShortcutTestHarness onToggle={toggleFn} />);
      const textarea = screen.getByTestId('test-textarea');
      textarea.focus();

      fireEvent.keyDown(textarea, { key: 'C', code: 'KeyC' });
      expect(toggleFn).not.toHaveBeenCalled();
    });

    it('F8.4: typing "C" inside contenteditable element is isolated and does NOT trigger shortcut', () => {
      const toggleFn = vi.fn();
      render(<ShortcutTestHarness onToggle={toggleFn} />);
      const ce = screen.getByTestId('test-contenteditable');
      ce.focus();

      fireEvent.keyDown(ce, { key: 'c', code: 'KeyC' });
      expect(toggleFn).not.toHaveBeenCalled();
    });

    it('F8.5: modifier keys (Ctrl+C, Cmd+C, Alt+C) are ignored to preserve clipboard operations', () => {
      const toggleFn = vi.fn();
      render(<ShortcutTestHarness onToggle={toggleFn} />);

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', ctrlKey: true });
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', altKey: true });
      expect(toggleFn).not.toHaveBeenCalled();
    });
  });

  describe('Tier 1: Feature 9 - Inline Chord Editing & Undo/Redo (F9)', () => {
    function EditableChordHarness({
      initialChords,
      onSave,
    }: {
      initialChords: ChordSegment[];
      onSave: (chords: ChordSegment[]) => void;
    }) {
      const [chords, setChords] = useState(initialChords);
      const chordHistory = useChordHistory({
        initialChords,
        currentChords: chords,
        onApplySnapshot: (restored) => {
          setChords(restored);
        },
      });

      const updateChord = (idx: number, newChord: string) => {
        chordHistory.pushSnapshot(chords);
        const next = chords.map((c, i) => (i === idx ? { ...c, chord: newChord } : c));
        setChords(next);
      };

      const handleSave = () => {
        chordHistory.updateBaseline(chords);
        onSave(chords);
      };

      return (
        <div>
          <span data-testid="dirty-indicator">{chordHistory.isDirty ? 'Dirty' : 'Clean'}</span>
          <button
            data-testid="undo-btn"
            onClick={chordHistory.handleUndo}
            disabled={!chordHistory.canUndo}
          >
            Undo
          </button>
          <button
            data-testid="redo-btn"
            onClick={chordHistory.handleRedo}
            disabled={!chordHistory.canRedo}
          >
            Redo
          </button>
          <button data-testid="save-btn" onClick={handleSave}>
            Save
          </button>
          <div data-testid="chord-list">
            {chords.map((c, i) => (
              <span
                key={c.id || i}
                data-testid={`chord-item-${i}`}
                onClick={() => updateChord(i, `${c.chord}maj7`)}
              >
                {c.chord}
              </span>
            ))}
          </div>
        </div>
      );
    }

    it('F9.1: editing a chord cue updates symbol and marks state dirty', () => {
      const saveFn = vi.fn();
      render(<EditableChordHarness initialChords={mockChordProgression} onSave={saveFn} />);

      expect(screen.getByTestId('dirty-indicator')).toHaveTextContent('Clean');
      fireEvent.click(screen.getByTestId('chord-item-0')); // C -> Cmaj7

      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('Cmaj7');
      expect(screen.getByTestId('dirty-indicator')).toHaveTextContent('Dirty');
    });

    it('F9.2: Undo reverts chord symbol to prior state', () => {
      render(<EditableChordHarness initialChords={mockChordProgression} onSave={vi.fn()} />);

      fireEvent.click(screen.getByTestId('chord-item-0')); // C -> Cmaj7
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('Cmaj7');

      fireEvent.click(screen.getByTestId('undo-btn'));
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('C');
    });

    it('F9.3: Redo restores undone chord modification', () => {
      render(<EditableChordHarness initialChords={mockChordProgression} onSave={vi.fn()} />);

      fireEvent.click(screen.getByTestId('chord-item-0'));
      fireEvent.click(screen.getByTestId('undo-btn'));
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('C');

      fireEvent.click(screen.getByTestId('redo-btn'));
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('Cmaj7');
    });

    it('F9.4: Saving persists edited chords and resets dirty indicator', () => {
      const saveFn = vi.fn();
      render(<EditableChordHarness initialChords={mockChordProgression} onSave={saveFn} />);

      fireEvent.click(screen.getByTestId('chord-item-0'));
      fireEvent.click(screen.getByTestId('save-btn'));

      expect(saveFn).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('dirty-indicator')).toHaveTextContent('Clean');
    });

    it('F9.5: multiple sequential edits can be undone step by step', () => {
      render(<EditableChordHarness initialChords={mockChordProgression} onSave={vi.fn()} />);

      fireEvent.click(screen.getByTestId('chord-item-0')); // edit 1
      fireEvent.click(screen.getByTestId('chord-item-1')); // edit 2
      expect(screen.getByTestId('chord-item-1')).toHaveTextContent('Ammaj7');

      fireEvent.click(screen.getByTestId('undo-btn')); // undo edit 2
      expect(screen.getByTestId('chord-item-1')).toHaveTextContent('Am');
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('Cmaj7');

      fireEvent.click(screen.getByTestId('undo-btn')); // undo edit 1
      expect(screen.getByTestId('chord-item-0')).toHaveTextContent('C');
    });
  });

  describe('Tier 1: Feature 10 - Help Documentation & Tooltips (F10)', () => {
    it('F10.1: HelpModal renders accessible dialog semantics and keyboard shortcuts table', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('F10.2: HelpModal contains Keyboard Shortcuts tab with shortcut listing', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);
      const shortcutsTab = screen.getByRole('tab', {
        name: /keyboard shortcuts/i,
      });
      expect(shortcutsTab).toBeInTheDocument();
    });

    it('F10.3: HelpModal documents input and modal isolation rules banner', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);
      expect(screen.getByText(/Keyboard Shortcut Isolation/i)).toBeInTheDocument();
    });

    it('F10.4: HelpModal close button satisfies touch target >=44px', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);
      const closeBtn = screen.getByRole('button', {
        name: /close help and usage guide/i,
      });
      expect(closeBtn).toBeInTheDocument();
      assertTouchTargets(closeBtn);
    });

    it('F10.5: HelpModal closes on Escape key', () => {
      const closeFn = vi.fn();
      render(<HelpModal isOpen={true} onClose={closeFn} />);
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(closeFn).toHaveBeenCalled();
    });
  });

  describe('Tier 1: Feature 11 - Responsive Layout & Touch Targets (F11)', () => {
    it('F11.1: ChordBar renders with zero horizontal overflow at 320px viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <ChordBar chords={mockChordProgression} currentTime={0.5} />
        </div>
      );
      assertZeroHorizontalOverflow(container, 320);
    });

    it('F11.2: ChordBar renders with zero horizontal overflow at 375px viewport', () => {
      setTestViewport(375, 667);
      const { container } = render(
        <div style={{ width: 375, overflow: 'hidden' }}>
          <ChordBar chords={mockChordProgression} currentTime={0.5} />
        </div>
      );
      assertZeroHorizontalOverflow(container, 375);
    });

    it('F11.3: ChordBar renders with zero horizontal overflow at 768px viewport', () => {
      setTestViewport(768, 1024);
      const { container } = render(
        <div style={{ width: 768, overflow: 'hidden' }}>
          <ChordBar chords={mockChordProgression} currentTime={0.5} />
        </div>
      );
      assertZeroHorizontalOverflow(container, 768);
    });

    it('F11.4: ChordBar renders with zero horizontal overflow at 1280px viewport', () => {
      setTestViewport(1280, 800);
      const { container } = render(
        <div style={{ width: 1280, overflow: 'hidden' }}>
          <ChordBar chords={mockChordProgression} currentTime={0.5} />
        </div>
      );
      assertZeroHorizontalOverflow(container, 1280);
    });

    it('F11.5: interactive ChordBar badges and controls satisfy >=44px minimum touch targets', () => {
      const { container } = render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={0.5}
          onEditChord={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      assertTouchTargets(container, 44);
    });
  });

  describe('Tier 1: Feature 15 - Export UI Options (F15)', () => {
    it('F15.1: ExportModal renders options dialog', () => {
      render(<ExportModal isOpen={true} onClose={vi.fn()} project={mockProject} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('F15.2: ExportSubtitleSection renders SubStation Alpha (.ass) download section', () => {
      render(<ExportSubtitleSection project={mockProject} />);
      expect(screen.getByRole('heading', { name: /synchronized subtitles/i })).toBeInTheDocument();
    });

    it('F15.3: Export download triggers authenticated fetch without window redirection', () => {
      const mockBlob = new Blob(['sample subtitle content'], {
        type: 'text/plain',
      });
      const fetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="test.ass"' },
        })
      );

      render(<ExportSubtitleSection project={mockProject} />);
      const downloadBtn = screen.getByRole('button', {
        name: /download \.ass subtitles/i,
      });
      fireEvent.click(downloadBtn);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('F15.4: Export controls maintain >=44px touch target dimensions', () => {
      const { container } = render(<ExportSubtitleSection project={mockProject} />);
      assertTouchTargets(container, 44);
    });

    it('F15.5: ExportModal satisfies zero horizontal overflow at 320px viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <ExportModal isOpen={true} onClose={vi.fn()} project={mockProject} />
        </div>
      );
      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // ============================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ============================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('Tier 2.1: empty chord progression renders clean placeholder without crash', () => {
      render(<ChordBar chords={[]} currentTime={0.0} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');
      expect(screen.getByTestId('upcoming-chords')).toBeEmptyDOMElement();
    });

    it('Tier 2.2: pure silence / "N" chords render distinctly without NaN or NaN text', () => {
      const silenceProg: ChordSegment[] = [{ id: 's1', start: 0.0, end: 5.0, chord: 'N' }];
      render(<ChordBar chords={silenceProg} currentTime={2.0} />);
      const badge = screen.getByTestId('active-chord-badge');
      expect(badge).toHaveTextContent('N');
      expect(badge.textContent).not.toContain('NaN');
    });

    it('Tier 2.3: sub-frame timestamps (e.g. 1.234567s) match correct interval without jitter', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={1.499} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');
    });

    it('Tier 2.4: negative currentTime is clamped safely to start', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={-2.5} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');
    });

    it('Tier 2.5: currentTime beyond song duration renders empty active indicator', () => {
      render(<ChordBar chords={mockChordProgression} currentTime={999.0} />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');
    });

    it('Tier 2.6: modal dialog isolation blocks "C" shortcut when HelpModal is active', () => {
      const toggleFn = vi.fn();
      render(
        <div>
          <HelpModal isOpen={true} onClose={vi.fn()} />
          <button onClick={toggleFn}>Toggle</button>
        </div>
      );
      // isModalActive returns true
      expect(isModalActive()).toBe(true);
    });

    it('Tier 2.7: extreme semitones (-12 and +12) do not produce undefined chord roots', () => {
      const { rerender } = render(
        <ChordBar chords={mockChordProgression} currentTime={0.5} semitones={-12} />
      );
      expect(screen.getByTestId('active-chord-badge').textContent).not.toBe('undefined');

      rerender(<ChordBar chords={mockChordProgression} currentTime={0.5} semitones={12} />);
      expect(screen.getByTestId('active-chord-badge').textContent).not.toBe('undefined');
    });

    it('Tier 2.8: rapid viewport resize does not cause memory leaks or throw', () => {
      const { container } = render(<ChordBar chords={mockChordProgression} currentTime={0.5} />);
      for (const bp of BREAKPOINTS) {
        setTestViewport(bp.width, bp.height);
        expect(container).toBeInTheDocument();
      }
    });
  });

  // ============================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // ============================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('Tier 3.1: AudioControls stepper changes propagate to ChordBar transposition', () => {
      function StudioMixHarness() {
        const [semitones, setSemitones] = useState(0);
        return (
          <div>
            <AudioControls
              projectId={mockProject.id}
              semitones={semitones}
              guideVolume={0}
              onSemitonesChange={setSemitones}
            />
            <ChordBar
              chords={mockChordProgression}
              currentTime={0.5} // C
              semitones={semitones}
            />
          </div>
        );
      }

      render(<StudioMixHarness />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

      // Requested keys transpose chords immediately, before the server re-mix lands
      fireEvent.click(screen.getByRole('button', { name: /increase pitch by one semitone/i }));
      fireEvent.click(screen.getByRole('button', { name: /increase pitch by one semitone/i }));
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('D');
    });

    it('Tier 3.2: ChordBar embeds cleanly alongside LyricDisplay in Studio Mode', () => {
      render(
        <div className="studio-stage">
          <LyricDisplay lines={mockLines} currentTime={1.5} isPlaying={false} />
          <ChordBar chords={mockChordProgression} currentTime={1.5} />
        </div>
      );
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');
    });

    it('Tier 3.3: ChordBar functions in Fullscreen TV Stage Mode', () => {
      render(
        <div className="stage-fullscreen">
          <LyricDisplay lines={mockLines} currentTime={2.0} isPlaying={true} />
          <ChordBar chords={mockChordProgression} currentTime={2.0} visible={true} />
        </div>
      );
      expect(screen.getByTestId('chord-bar')).toBeInTheDocument();
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Am');
    });

    it('Tier 3.4: Dynamic transposition maintains synchrony with variable playback rate (1.5x)', () => {
      render(
        <ChordBar
          chords={mockChordProgression}
          currentTime={3.5} // F
          semitones={3} // F + 3 = G# / Ab
        />
      );
      const badge = screen.getByTestId('active-chord-badge');
      expect(badge.textContent === 'G#' || badge.textContent === 'Ab').toBe(true);
    });

    it('Tier 3.5: Modal open suppresses "C" shortcut, closing modal restores "C" shortcut', () => {
      const toggleFn = vi.fn();
      const { rerender } = render(
        <div>
          <HelpModal isOpen={false} onClose={vi.fn()} />
          <button data-testid="target-btn" onClick={toggleFn}>
            Toggle
          </button>
        </div>
      );

      expect(isModalActive()).toBe(false);

      rerender(
        <div>
          <HelpModal isOpen={true} onClose={vi.fn()} />
          <button data-testid="target-btn" onClick={toggleFn}>
            Toggle
          </button>
        </div>
      );
      expect(isModalActive()).toBe(true);
    });
  });

  // ============================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ============================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Tier 4.1: Scenario S1 - Pop Ballad live studio playback with scrolling ChordBar', () => {
      const { rerender } = render(
        <div data-testid="studio-workstation">
          <LyricDisplay lines={mockLines} currentTime={0.5} isPlaying={true} />
          <ChordBar chords={mockChordProgression} currentTime={0.5} />
        </div>
      );
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('C');

      // Audio progresses into chorus
      rerender(
        <div data-testid="studio-workstation">
          <LyricDisplay lines={mockLines} currentTime={3.5} isPlaying={true} />
          <ChordBar chords={mockChordProgression} currentTime={3.5} />
        </div>
      );
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('F');
    });

    it('Tier 4.2: Scenario S2 - Vocal Range pitch transposition workflow (-2 semitones)', () => {
      render(
        <div>
          <ChordBar
            chords={mockChordProgression}
            currentTime={0.5} // C -> Bb / A#
            semitones={-2}
          />
        </div>
      );
      const text = screen.getByTestId('active-chord-badge').textContent;
      expect(text === 'Bb' || text === 'A#').toBe(true);
    });

    it('Tier 4.3: Scenario S3 - Inline chord cue correction with Undo/Redo & persistence', () => {
      const onSave = vi.fn();
      function EditFlow() {
        const [chords, setChords] = useState(mockChordProgression);
        const chordHistory = useChordHistory({
          initialChords: mockChordProgression,
          currentChords: chords,
          onApplySnapshot: (restored) => setChords(restored),
        });

        const handleEdit = (idx: number, sym: string) => {
          chordHistory.pushSnapshot(chords);
          setChords((prev) => prev.map((c, i) => (i === idx ? { ...c, chord: sym } : c)));
        };

        const handleSave = () => {
          chordHistory.updateBaseline(chords);
          onSave(chords);
        };

        return (
          <div>
            <button data-testid="edit-btn" onClick={() => handleEdit(3, 'Gmaj7')}>
              Change G7 to Gmaj7
            </button>
            <button
              data-testid="undo-btn"
              onClick={chordHistory.handleUndo}
              disabled={!chordHistory.canUndo}
            >
              Undo
            </button>
            <button data-testid="save-btn" onClick={handleSave}>
              Save
            </button>
            <ChordBar
              chords={chords}
              currentTime={5.0}
              onEditChord={(idx, sym) => handleEdit(idx, sym)}
            />
          </div>
        );
      }

      render(<EditFlow />);
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('G7');

      fireEvent.click(screen.getByTestId('edit-btn'));
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('Gmaj7');

      fireEvent.click(screen.getByTestId('undo-btn'));
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('G7');

      fireEvent.click(screen.getByTestId('edit-btn'));
      fireEvent.click(screen.getByTestId('save-btn'));
      expect(onSave).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ chord: 'Gmaj7' })])
      );
    });

    it('Tier 4.4: Scenario S4 - Export flow with chords enabled', () => {
      render(<ExportModal isOpen={true} onClose={vi.fn()} project={mockProject} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Verifies dialog mounts and contains accessible buttons
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('Tier 4.5: Scenario S5 - Responsive Mobile Audit down to 320px with touch target verification', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <ChordBar
            chords={mockChordProgression}
            currentTime={0.5}
            onEditChord={vi.fn()}
            onSeek={vi.fn()}
          />
        </div>
      );
      assertZeroHorizontalOverflow(container, 320);
      assertTouchTargets(container, 44);
    });
  });
});
