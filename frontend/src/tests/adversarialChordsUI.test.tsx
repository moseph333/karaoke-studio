/**
 * Empirical Adversarial Test Suite for Milestone 2:
 * UI Adversarial, Keyboard Shortcut Isolation, History Stress & Responsive Touch Targets
 *
 * Scope:
 * 1. Keyboard shortcut 'C' / 'c' isolation:
 *    - Typing in <input>, <textarea>, <select>, contenteditable="true"
 *    - Clipboard copy modifiers (Ctrl+C, Cmd+C, Alt+C, Shift+C)
 *    - Open modal dialogs (HelpModal, AuthModal, ExportModal, custom dialogs)
 * 2. Undo/Redo history stress (useChordHistory):
 *    - 100 consecutive edits bounded strictly to maxHistory (50)
 *    - Multiple undos past empty stack are safe no-ops
 *    - Redo stack cleared on new push
 *    - Safe no-ops on empty redo
 * 3. Responsive geometry & touch targets:
 *    - All interactive controls in ChordBar satisfy >= 44px
 *    - Zero horizontal overflow at 320px, 375px, 768px, 1280px
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';

import { useKeyboardShortcuts, isInputElement, isModalActive } from '../hooks/useKeyboardShortcuts';
import { useChordHistory } from '../hooks/useChordHistory';
import { ChordBar } from '../components/ChordBar';
import { HelpModal } from '../components/HelpModal';
import { AuthModal } from '../components/AuthModal';
import { ExportModal } from '../components/ExportModal';
import { LyricDisplay } from '../components/LyricDisplay';
import { AudioControls } from '../components/AudioControls';
import { ChordSegment, LyricLine, ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
  BREAKPOINTS,
} from './responsiveTestUtils';

describe('Milestone 2 Empirical Challenger: Adversarial Stress Suite', () => {
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
  // 1. KEYBOARD SHORTCUT 'C' ISOLATION
  // =========================================================================
  describe('1. Keyboard Shortcut "C" / "c" Isolation Stress', () => {
    function ShortcutTestBed({ onToggle }: { onToggle: () => void }) {
      useKeyboardShortcuts({
        enabled: true,
        onToggleChordBar: onToggle,
      });

      return (
        <div>
          <button data-testid="outside-btn">Outside Focus</button>
          <input data-testid="test-input" type="text" defaultValue="typing here" />
          <textarea data-testid="test-textarea" defaultValue="longer text typing" />
          <select data-testid="test-select" defaultValue="opt1">
            <option value="opt1">Option 1</option>
            <option value="opt2">Option 2</option>
          </select>
          <div data-testid="test-contenteditable" contentEditable={true}>
            <span data-testid="nested-editable">Editable inner content</span>
          </div>
          <div role="textbox" data-testid="aria-textbox" tabIndex={0}>
            Aria Textbox
          </div>
          <div role="searchbox" data-testid="aria-searchbox" tabIndex={0}>
            Aria Searchbox
          </div>
          <div role="spinbutton" data-testid="aria-spinbutton" tabIndex={0}>
            50
          </div>
          <div role="slider" data-testid="aria-slider" tabIndex={0}>
            Slider
          </div>
        </div>
      );
    }

    it('1.1: background keypresses of "c" and "C" cleanly toggle ChordBar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);

      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(2);
    });

    it('1.2: typing "c" or "C" in <input> NEVER toggles the chord bar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);
      const input = screen.getByTestId('test-input');
      expect(isInputElement(input)).toBe(true);
      input.focus();

      fireEvent.keyDown(input, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(input, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.3: typing "c" or "C" in <textarea> NEVER toggles the chord bar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);
      const textarea = screen.getByTestId('test-textarea');
      textarea.focus();

      fireEvent.keyDown(textarea, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(textarea, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.4: typing "c" or "C" in <select> NEVER toggles the chord bar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);
      const select = screen.getByTestId('test-select');
      select.focus();

      fireEvent.keyDown(select, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(select, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.5: typing "c" or "C" in contenteditable="true" (and nested children) NEVER toggles the chord bar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);
      const ce = screen.getByTestId('test-contenteditable');
      const inner = screen.getByTestId('nested-editable');

      ce.focus();
      fireEvent.keyDown(ce, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(ce, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      inner.focus();
      fireEvent.keyDown(inner, { key: 'c', code: 'KeyC' });
      fireEvent.keyDown(inner, { key: 'C', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.6: typing "c" or "C" in ARIA text roles (textbox, searchbox, spinbutton, slider) NEVER toggles', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);

      ['aria-textbox', 'aria-searchbox', 'aria-spinbutton', 'aria-slider'].forEach((id) => {
        const el = screen.getByTestId(id);
        el.focus();
        fireEvent.keyDown(el, { key: 'c', code: 'KeyC' });
        fireEvent.keyDown(el, { key: 'C', code: 'KeyC' });
      });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.7: clipboard shortcuts (Ctrl+C, Cmd+C, Alt+C, Shift+C) NEVER toggle chord bar', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);

      // Windows/Linux Ctrl+C
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', ctrlKey: true });
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', ctrlKey: true });

      // macOS Cmd+C / Meta+C
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', metaKey: true });

      // Alt+C combinations
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', altKey: true });
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', altKey: true });

      // Shift+C without modifier is also guarded in useKeyboardShortcuts
      fireEvent.keyDown(window, { key: 'C', code: 'KeyC', shiftKey: true });

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it('1.8: active modal dialogs (HTML dialog, role="dialog", HelpModal, AuthModal, ExportModal) strictly suppress "c"', () => {
      const toggleSpy = vi.fn();
      const mockModalProject: ProjectState = {
        id: 'p1',
        status: 'ready',
        progress: 100,
        title: 'Modal Test',
        artist: 'Tester',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      const ModalHarness = ({ activeModal }: { activeModal: string | null }) => {
        useKeyboardShortcuts({
          enabled: true,
          onToggleChordBar: toggleSpy,
        });

        return (
          <div>
            {activeModal === 'help' && <HelpModal isOpen={true} onClose={vi.fn()} />}
            {activeModal === 'auth' && (
              <AuthModal isOpen={true} onClose={vi.fn()} onSuccess={vi.fn()} />
            )}
            {activeModal === 'export' && (
              <ExportModal isOpen={true} onClose={vi.fn()} project={mockModalProject} />
            )}
            {activeModal === 'custom' && (
              <div role="dialog" aria-modal="true">
                <button>Dialog Button</button>
              </div>
            )}
          </div>
        );
      };

      const { rerender } = render(<ModalHarness activeModal={null} />);

      // Baseline: shortcut works when no modal is open
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(1);
      toggleSpy.mockClear();

      // HelpModal open
      rerender(<ModalHarness activeModal="help" />);
      expect(isModalActive()).toBe(true);
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      // AuthModal open
      rerender(<ModalHarness activeModal="auth" />);
      expect(isModalActive()).toBe(true);
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      // ExportModal open
      rerender(<ModalHarness activeModal="export" />);
      expect(isModalActive()).toBe(true);
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      // Custom dialog open
      rerender(<ModalHarness activeModal="custom" />);
      expect(isModalActive()).toBe(true);
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).not.toHaveBeenCalled();

      // Close all modals -> shortcut works again
      rerender(<ModalHarness activeModal={null} />);
      expect(isModalActive()).toBe(false);
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC' });
      expect(toggleSpy).toHaveBeenCalledTimes(1);
    });

    it('1.9: key repeat events (holding "c" down) are suppressed', () => {
      const toggleSpy = vi.fn();
      render(<ShortcutTestBed onToggle={toggleSpy} />);

      // First strike
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: false });
      expect(toggleSpy).toHaveBeenCalledTimes(1);

      // Held key repeat strikes
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: true });
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: true });
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: true });
      expect(toggleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. UNDO/REDO STRESS (useChordHistory)
  // =========================================================================
  describe('2. Undo/Redo Stress & Stack Bound Tests (useChordHistory)', () => {
    const baseProgression: ChordSegment[] = [
      { id: '1', start: 0.0, end: 2.0, chord: 'C' },
      { id: '2', start: 2.0, end: 4.0, chord: 'Am' },
      { id: '3', start: 4.0, end: 6.0, chord: 'F' },
      { id: '4', start: 6.0, end: 8.0, chord: 'G' },
    ];

    it('2.1: pushing 100 consecutive edits strictly bounds undoStack to maxHistory (50)', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);

      // Perform 100 consecutive snapshots
      act(() => {
        for (let i = 1; i <= 100; i++) {
          result.current.pushSnapshot([
            { id: '1', start: 0.0, end: 2.0, chord: `Chord_${i}` },
            { id: '2', start: 2.0, end: 4.0, chord: 'Am' },
          ]);
        }
      });

      // Verification: undoStack MUST NOT exceed 50
      expect(result.current.undoStack).toHaveLength(50);
      expect(result.current.canUndo).toBe(true);

      // The earliest surviving item should be Chord_51 (items 1..50 shifted out)
      expect(result.current.undoStack[0][0].chord).toBe('Chord_51');
      // The latest item in the stack is Chord_100
      expect(result.current.undoStack[49][0].chord).toBe('Chord_100');
    });

    it('2.2: multiple undos past empty stack are safe no-ops without error', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Push 3 snapshots
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C1' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C2' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C3' }]);
      });

      expect(result.current.undoStack).toHaveLength(3);

      // Undo 3 times
      let res1: ChordSegment[] | null = null;
      let res2: ChordSegment[] | null = null;
      let res3: ChordSegment[] | null = null;
      act(() => {
        res1 = result.current.undo([{ id: '1', start: 0, end: 2, chord: 'Current' }]);
        res2 = result.current.undo(res1!);
        res3 = result.current.undo(res2!);
      });

      expect(res1).not.toBeNull();
      expect(res2).not.toBeNull();
      expect(res3).not.toBeNull();
      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);

      // Multiple undos past the first state (exhausted stack)
      act(() => {
        for (let i = 0; i < 10; i++) {
          const excessUndo = result.current.undo([{ id: '1', start: 0, end: 2, chord: 'C1' }]);
          expect(excessUndo).toBeNull();
          // handleUndo also safe
          result.current.handleUndo();
        }
      });

      expect(result.current.undoStack).toHaveLength(0);
      expect(result.current.canUndo).toBe(false);
    });

    it('2.3: redo stack is completely cleared upon a new pushSnapshot', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Push snapshot 1 and 2
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'Step1' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'Step2' }]);
      });

      // Undo once to populate redo stack
      act(() => {
        result.current.undo([{ id: '1', start: 0, end: 2, chord: 'Step2' }]);
      });

      expect(result.current.redoStack).toHaveLength(1);
      expect(result.current.canRedo).toBe(true);

      // Now push a new snapshot (branching history)
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'Step3_Branch' }]);
      });

      // Redo stack MUST be wiped clean
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.canRedo).toBe(false);

      // Attempting redo returns null
      act(() => {
        const redoRes = result.current.redo([{ id: '1', start: 0, end: 2, chord: 'Current' }]);
        expect(redoRes).toBeNull();
      });
    });

    it('2.4: multiple redos past empty stack are safe no-ops without error', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseProgression,
          currentChords: baseProgression,
          maxHistory: 50,
        })
      );

      // Calling redo on initial clean state returns null
      act(() => {
        for (let i = 0; i < 5; i++) {
          expect(result.current.redo()).toBeNull();
          result.current.handleRedo();
        }
      });

      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.canRedo).toBe(false);
    });

    it('2.5: snapshots are cloned immutably, preventing external reference mutations', () => {
      const mutableProgression = [{ id: '1', start: 0, end: 2, chord: 'Original' }];

      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: mutableProgression,
          currentChords: mutableProgression,
          maxHistory: 50,
        })
      );

      act(() => {
        result.current.pushSnapshot(mutableProgression);
      });

      // Mutate the original object outside the hook
      mutableProgression[0].chord = 'Hacked';

      // Internal snapshot must NOT be affected
      expect(result.current.undoStack[0][0].chord).toBe('Original');
    });
  });

  // =========================================================================
  // 3. RESPONSIVE GEOMETRY & TOUCH TARGETS
  // =========================================================================
  describe('3. Responsive Geometry & Touch Targets (ChordBar.tsx)', () => {
    const sampleChords: ChordSegment[] = [
      { id: '1', start: 0.0, end: 2.0, chord: 'C' },
      { id: '2', start: 2.0, end: 4.0, chord: 'Am7' },
      { id: '3', start: 4.0, end: 6.0, chord: 'F#m' },
      { id: '4', start: 6.0, end: 8.0, chord: 'G7' },
    ];

    it('3.1: all interactive controls in ChordBar satisfy >= 44px touch targets in view mode', () => {
      const { container } = render(
        <ChordBar
          chords={sampleChords}
          currentTime={1.0}
          semitones={0}
          onEditChord={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Verify assertTouchTargets returns zero failures on buttons/inputs
      const res = assertTouchTargets(container, 44);
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.failed).toHaveLength(0);

      // Specifically verify edit button min dimensions
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      expect(editBtn.className).toContain('min-h-[44px]');
      expect(editBtn.className).toContain('min-w-[44px]');

      // Active badge min dimensions
      const activeBadge = screen.getByTestId('active-chord-badge');
      expect(activeBadge.className).toContain('min-h-[44px]');
      expect(activeBadge.className).toContain('min-w-[44px]');
    });

    it('3.2: all interactive controls in ChordBar satisfy >= 44px touch targets in edit mode', () => {
      const { container } = render(
        <ChordBar
          chords={sampleChords}
          currentTime={1.0}
          semitones={0}
          onEditChord={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Enter edit mode
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      // Inspect edit controls
      const input = screen.getByTestId('chord-edit-input');
      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      const cancelBtn = screen.getByTestId('cancel-chord-edit-btn');

      expect(input.className).toContain('min-h-[44px]');
      expect(saveBtn.className).toContain('min-h-[44px]');
      expect(saveBtn.className).toContain('min-w-[44px]');
      expect(cancelBtn.className).toContain('min-h-[44px]');
      expect(cancelBtn.className).toContain('min-w-[44px]');

      // Complete touch target evaluation
      const res = assertTouchTargets(container, 44);
      expect(res.total).toBe(3);
      expect(res.failed).toHaveLength(0);
    });

    it('3.3: ChordBar renders with zero horizontal overflow across all standard breakpoints (320px, 375px, 768px, 1280px)', () => {
      const longChords: ChordSegment[] = [
        { id: '1', start: 0.0, end: 1.5, chord: 'C#maj7/G#' },
        { id: '2', start: 1.5, end: 3.0, chord: 'Abm7/Eb' },
        { id: '3', start: 3.0, end: 4.5, chord: 'F#7sus4' },
        { id: '4', start: 4.5, end: 6.0, chord: 'Bdim' },
      ];

      for (const bp of BREAKPOINTS) {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <div style={{ width: bp.width, overflow: 'hidden' }}>
            <ChordBar
              chords={longChords}
              currentTime={1.0}
              semitones={2}
              onEditChord={vi.fn()}
              onSeek={vi.fn()}
            />
          </div>
        );

        assertZeroHorizontalOverflow(container, bp.width);
      }
    });

    it('3.4: ChordBar in edit mode at 320px has zero horizontal overflow', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <ChordBar
            chords={sampleChords}
            currentTime={1.0}
            semitones={0}
            onEditChord={vi.fn()}
            onSeek={vi.fn()}
          />
        </div>
      );

      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      assertZeroHorizontalOverflow(container, 320);
    });

    it('3.5: LyricDisplay with embedded ChordBar at 320px has zero horizontal overflow', () => {
      setTestViewport(320, 568);
      const lines: LyricLine[] = [
        {
          id: 1,
          text: 'Testing responsive layout with chords',
          start_time: 1.0,
          end_time: 5.0,
          words: [
            { word: 'Testing', start_time: 1.0, end_time: 2.0 },
            { word: 'chords', start_time: 2.0, end_time: 4.0 },
          ],
        },
      ];

      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <LyricDisplay
            lines={lines}
            currentTime={1.5}
            chords={sampleChords}
            showChords={true}
            semitones={0}
            onSeek={vi.fn()}
          />
        </div>
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('3.6: AudioControls with chord-bar-toggle at 320px has zero horizontal overflow and >=44px button', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div style={{ width: 320, overflow: 'hidden' }}>
          <AudioControls
            projectId="p1"
            currentTime={1.0}
            duration={100}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
            onMixChange={vi.fn()}
            initialSemitones={0}
            showChordBar={true}
            onToggleChordBar={vi.fn()}
          />
        </div>
      );

      const chordToggleBtn = screen.getByTestId('chord-bar-toggle');
      expect(chordToggleBtn).toBeInTheDocument();
      expect(chordToggleBtn.className).toContain('min-h-[44px]');
      expect(chordToggleBtn.className).toContain('min-w-[44px]');

      assertZeroHorizontalOverflow(container, 320);
    });
  });
});
