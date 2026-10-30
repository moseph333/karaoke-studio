/**
 * Milestone 2 Challenger 2: Adversarial Stress Testing Suite
 *
 * Covers:
 * 1. Frontend state & undo/redo stress (rapid cycling, multi-line interleaving, Ctrl+Z/Ctrl+Y,
 *    bulk assignment modes: alternating 1x1, 2x2, range, auto-suggest pause threshold, redo branch invalidation).
 * 2. Dirty state tracking and project persistence serialization.
 * 3. Architectural budget enforcement (LyricTimelineEditor.tsx <= 450 lines).
 * 4. Responsive geometry & touch target stress (>= 44px on required buttons, 0 horizontal overflow at 320px in Timeline and Stage Mode).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { LyricDisplay } from '../components/LyricDisplay';
import { LyricLine } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './helpers/responsiveTestUtils';

describe('Milestone 2 Challenger 2: Duet State, Undo/Redo & Responsive Stress', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Is this the real life',
      start_time: 1.0,
      end_time: 4.0,
      singer: 'singer1',
      words: [
        { word: 'Is', start_time: 1.0, end_time: 1.5 },
        { word: 'this', start_time: 1.5, end_time: 2.0 },
        { word: 'the', start_time: 2.0, end_time: 2.5 },
        { word: 'real', start_time: 2.5, end_time: 3.2 },
        { word: 'life', start_time: 3.2, end_time: 4.0 },
      ],
    },
    {
      id: 2,
      text: 'Is this just fantasy',
      start_time: 4.2,
      end_time: 7.0,
      singer: 'singer1',
      words: [
        { word: 'Is', start_time: 4.2, end_time: 4.8 },
        { word: 'this', start_time: 4.8, end_time: 5.3 },
        { word: 'just', start_time: 5.3, end_time: 6.0 },
        { word: 'fantasy', start_time: 6.0, end_time: 7.0 },
      ],
    },
    {
      id: 3,
      text: 'Caught in a landslide',
      start_time: 7.2,
      end_time: 10.0,
      singer: 'singer1',
      words: [
        { word: 'Caught', start_time: 7.2, end_time: 8.0 },
        { word: 'in', start_time: 8.0, end_time: 8.4 },
        { word: 'a', start_time: 8.4, end_time: 8.9 },
        { word: 'landslide', start_time: 8.9, end_time: 10.0 },
      ],
    },
    {
      id: 4,
      text: 'No escape from reality',
      start_time: 13.5, // 3.5s gap (> 2.5s auto-suggest threshold)
      end_time: 17.0,
      singer: 'singer1',
      words: [
        { word: 'No', start_time: 13.5, end_time: 14.2 },
        { word: 'escape', start_time: 14.2, end_time: 15.3 },
        { word: 'from', start_time: 15.3, end_time: 15.8 },
        { word: 'reality', start_time: 15.8, end_time: 17.0 },
      ],
    },
    {
      id: 5,
      text: 'Open your eyes (overlapping backing vocal)',
      start_time: 16.8, // -0.2s overlap with line 4 (< -0.1s overlap)
      end_time: 20.0,
      singer: 'singer1',
      words: [
        { word: 'Open', start_time: 16.8, end_time: 17.5 },
        { word: 'your', start_time: 17.5, end_time: 18.2 },
        { word: 'eyes', start_time: 18.2, end_time: 20.0 },
      ],
    },
    {
      id: 6,
      text: 'Look up to the skies and see',
      start_time: 23.5, // 3.5s gap (> 2.5s)
      end_time: 27.0,
      singer: 'singer1',
      words: [
        { word: 'Look', start_time: 23.5, end_time: 24.2 },
        { word: 'up', start_time: 24.2, end_time: 25.0 },
        { word: 'to', start_time: 25.0, end_time: 25.5 },
        { word: 'the', start_time: 25.5, end_time: 26.0 },
        { word: 'skies', start_time: 26.0, end_time: 26.5 },
        { word: 'and', start_time: 26.5, end_time: 26.8 },
        { word: 'see', start_time: 26.8, end_time: 27.0 },
      ],
    },
  ];

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Section 1: Architectural Budget Enforcement
  // =========================================================================
  describe('Architectural Budget Enforcement', () => {
    it('verifies LyricTimelineEditor.tsx strictly complies with <= 450 lines budget', () => {
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

      expect(lineCount).toBeLessThanOrEqual(450);
    });
  });

  // =========================================================================
  // Section 2: Frontend State & Rapid Undo/Redo Stress
  // =========================================================================
  describe('Frontend State & Rapid Undo/Redo Stress', () => {
    it('survives rapid cycling of singer roles across lines with full Undo/Redo fidelity', async () => {
      const onSaveLines = vi.fn().mockResolvedValue(undefined);
      const onDirtyChange = vi.fn();

      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
          onDirtyChange={onDirtyChange}
        />
      );

      const toggleBtn1 = screen.getByTestId('toggle-singer-1');
      const toggleBtn2 = screen.getByTestId('toggle-singer-2');
      const undoBtn = screen.getByTestId('undo-lyrics-btn');
      const redoBtn = screen.getByTestId('redo-lyrics-btn');

      // Initial state: Singer 1
      expect(toggleBtn1).toHaveTextContent('S1');
      expect(toggleBtn2).toHaveTextContent('S1');
      expect(undoBtn).toBeDisabled();
      expect(redoBtn).toBeDisabled();

      // Rapidly cycle line 1: S1 -> S2 -> Both -> S1 -> S2 (4 clicks)
      fireEvent.click(toggleBtn1); // -> S2
      expect(toggleBtn1).toHaveTextContent('S2');
      expect(undoBtn).not.toBeDisabled();

      fireEvent.click(toggleBtn1); // -> Both
      expect(toggleBtn1).toHaveTextContent('Both');

      fireEvent.click(toggleBtn1); // -> S1
      expect(toggleBtn1).toHaveTextContent('S1');

      fireEvent.click(toggleBtn1); // -> S2
      expect(toggleBtn1).toHaveTextContent('S2');

      // Interleave line 2 cycle: S1 -> S2 (1 click)
      fireEvent.click(toggleBtn2); // -> S2
      expect(toggleBtn2).toHaveTextContent('S2');

      // Now verify Undo (Ctrl+Z) step-by-step
      // Step 1 undo: reverts line 2 back to S1
      fireEvent.click(undoBtn);
      expect(toggleBtn2).toHaveTextContent('S1');
      expect(toggleBtn1).toHaveTextContent('S2');
      expect(redoBtn).not.toBeDisabled();

      // Step 2 undo: reverts line 1 back to S1
      fireEvent.click(undoBtn);
      expect(toggleBtn1).toHaveTextContent('S1');

      // Step 3 undo: reverts line 1 back to Both
      fireEvent.click(undoBtn);
      expect(toggleBtn1).toHaveTextContent('Both');

      // Step 4 undo: reverts line 1 back to S2
      fireEvent.click(undoBtn);
      expect(toggleBtn1).toHaveTextContent('S2');

      // Step 5 undo: reverts line 1 back to initial S1
      fireEvent.click(undoBtn);
      expect(toggleBtn1).toHaveTextContent('S1');
      expect(toggleBtn2).toHaveTextContent('S1');
      expect(undoBtn).toBeDisabled();

      // Now Redo (Ctrl+Y) step-by-step
      // Step 1 redo: line 1 -> S2
      fireEvent.click(redoBtn);
      expect(toggleBtn1).toHaveTextContent('S2');

      // Step 2 redo: line 1 -> Both
      fireEvent.click(redoBtn);
      expect(toggleBtn1).toHaveTextContent('Both');

      // Step 3 redo: line 1 -> S1
      fireEvent.click(redoBtn);
      expect(toggleBtn1).toHaveTextContent('S1');

      // Step 4 redo: line 1 -> S2
      fireEvent.click(redoBtn);
      expect(toggleBtn1).toHaveTextContent('S2');

      // Step 5 redo: line 2 -> S2
      fireEvent.click(redoBtn);
      expect(toggleBtn2).toHaveTextContent('S2');
      expect(redoBtn).toBeDisabled();

      // Redo branch invalidation: undo 1 step, then cycle line 3 -> redo stack is cleared
      fireEvent.click(undoBtn); // line 2 reverts to S1
      expect(toggleBtn2).toHaveTextContent('S1');
      expect(redoBtn).not.toBeDisabled();

      const toggleBtn3 = screen.getByTestId('toggle-singer-3');
      fireEvent.click(toggleBtn3); // line 3 -> S2
      expect(toggleBtn3).toHaveTextContent('S2');

      // Redo should now be disabled because a new branch was started
      expect(redoBtn).toBeDisabled();
    });

    it('supports keyboard shortcuts Ctrl+Z and Ctrl+Y for singer undo/redo', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const toggleBtn = screen.getByTestId('toggle-singer-1');
      expect(toggleBtn).toHaveTextContent('S1');

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveTextContent('S2');

      // Trigger Ctrl+Z
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      expect(toggleBtn).toHaveTextContent('S1');

      // Trigger Ctrl+Y
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
      expect(toggleBtn).toHaveTextContent('S2');
    });
  });

  // =========================================================================
  // Section 3: Bulk Assignment Modes Stress (Alternating 1x1, 2x2, Range, Auto-Suggest)
  // =========================================================================
  describe('Bulk Assignment Modes Stress', () => {
    it('applies alternating 1x1 pattern correctly and undoes in a single step', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      // Open Duet Modal
      fireEvent.click(screen.getByTestId('duet-assign-btn'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Default is alternating 1x1 starting with singer1
      // Apply
      fireEvent.click(screen.getByTestId('apply-duet-btn'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Verify alternating roles on all 6 lines: S1, S2, S1, S2, S1, S2
      expect(screen.getByTestId('toggle-singer-1')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-2')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-4')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-5')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-6')).toHaveTextContent('S2');

      // Single Undo reverts all 6 lines back to S1
      fireEvent.click(screen.getByTestId('undo-lyrics-btn'));
      for (let i = 1; i <= 6; i++) {
        expect(screen.getByTestId(`toggle-singer-${i}`)).toHaveTextContent('S1');
      }
    });

    it('applies alternating 2x2 pattern correctly', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('duet-assign-btn'));
      // Select 2-by-2 pattern
      fireEvent.click(screen.getByText(/2-by-2/i));
      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      // 2x2: S1, S1, S2, S2, S1, S1
      expect(screen.getByTestId('toggle-singer-1')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-2')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-4')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-5')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-6')).toHaveTextContent('S1');
    });

    it('applies range assignment to a sub-range with custom target role', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('duet-assign-btn'));
      // Switch to Range Tab
      fireEvent.click(screen.getByRole('tab', { name: /Range/i }));

      // Select Custom Range
      fireEvent.click(screen.getByText(/Custom Range/i));

      // Set lines 2 to 4
      const startInput = screen.getByLabelText(/From Line #/i);
      const endInput = screen.getByLabelText(/To Line #/i);
      fireEvent.change(startInput, { target: { value: '2' } });
      fireEvent.change(endInput, { target: { value: '4' } });

      // Choose Both / Duet
      fireEvent.click(screen.getByRole('button', { name: /^Both$/ }));

      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      // Line 1 should remain S1
      expect(screen.getByTestId('toggle-singer-1')).toHaveTextContent('S1');
      // Lines 2, 3, 4 should be Both
      expect(screen.getByTestId('toggle-singer-2')).toHaveTextContent('Both');
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('Both');
      expect(screen.getByTestId('toggle-singer-4')).toHaveTextContent('Both');
      // Lines 5, 6 should remain S1
      expect(screen.getByTestId('toggle-singer-5')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-6')).toHaveTextContent('S1');
    });

    it('applies auto-suggest mode with pause threshold and overlapping detection', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('duet-assign-btn'));
      // Switch to Auto Tab
      fireEvent.click(screen.getByRole('tab', { name: /Auto-Suggest/i }));

      // Line timing review:
      // Line 1: 1.0 - 4.0 (S1)
      // Line 2: 4.2 - 7.0 (gap 0.2s < 2.5s -> S1)
      // Line 3: 7.2 - 10.0 (gap 0.2s < 2.5s -> S1)
      // Line 4: 13.5 - 17.0 (gap 3.5s >= 2.5s -> switches to S2)
      // Line 5: 16.8 - 20.0 (gap -0.2s < -0.1s -> overlap detected -> Both)
      // Line 6: 23.5 - 27.0 (gap 3.5s >= 2.5s after line 5 -> switches to S1)

      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      expect(screen.getByTestId('toggle-singer-1')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-2')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-4')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-5')).toHaveTextContent('Both');
      expect(screen.getByTestId('toggle-singer-6')).toHaveTextContent('S1');
    });
  });

  // =========================================================================
  // Section 4: Dirty State Tracking & Project Persistence Serialization
  // =========================================================================
  describe('Dirty State Tracking & Project Persistence Serialization', () => {
    it('accurately triggers onDirtyChange, toggles dirty indicator, and resets after undo or save', async () => {
      const onDirtyChange = vi.fn();
      const onSaveLines = vi.fn().mockResolvedValue(undefined);

      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
          onDirtyChange={onDirtyChange}
        />
      );

      // Initially pristine
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('discard-changes-btn')).not.toBeInTheDocument();

      // Cycle singer on line 1
      fireEvent.click(screen.getByTestId('toggle-singer-1'));

      // Dirty state is now active
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      expect(screen.getByTestId('discard-changes-btn')).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);

      // Undo back to pristine
      fireEvent.click(screen.getByTestId('undo-lyrics-btn'));
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);

      // Redo back to dirty
      fireEvent.click(screen.getByTestId('redo-lyrics-btn'));
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);

      // Save changes
      fireEvent.click(screen.getByTestId('save-lyrics-btn'));
      await waitFor(() => {
        expect(onSaveLines).toHaveBeenCalledTimes(1);
      });

      // Verify payload passed to onSaveLines includes singer fields
      const savedPayload: LyricLine[] = onSaveLines.mock.calls[0][0];
      expect(savedPayload[0].singer).toBe('singer2');
      expect(savedPayload[1].singer).toBe('singer1');

      // Dirty indicator should now disappear
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('preserves singer field fidelity across JSON serialization round-trip', () => {
      const originalLines: LyricLine[] = [
        { id: 1, text: 'Line 1', start_time: 1.0, end_time: 2.0, singer: 'singer1', words: [] },
        { id: 2, text: 'Line 2', start_time: 2.5, end_time: 3.5, singer: 'singer2', words: [] },
        { id: 3, text: 'Line 3', start_time: 4.0, end_time: 5.0, singer: 'both', words: [] },
      ];

      const serialized = JSON.stringify({ lines: originalLines });
      const parsed = JSON.parse(serialized);

      expect(parsed.lines).toHaveLength(3);
      expect(parsed.lines[0].singer).toBe('singer1');
      expect(parsed.lines[1].singer).toBe('singer2');
      expect(parsed.lines[2].singer).toBe('both');
    });
  });

  // =========================================================================
  // Section 5: Responsive Geometry & Touch Target Stress
  // =========================================================================
  describe('Responsive Geometry & Touch Target Stress', () => {
    it('verifies 0 horizontal overflow at 320px viewport width in Timeline Mode', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('verifies 0 horizontal overflow at 320px viewport width in Stage Mode', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          isPlaying={true}
          onSeek={vi.fn()}
          onTogglePlay={vi.fn()}
        />
      );

      // Enter TV Stage Mode
      const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(toggleBtn);

      // Verify floating controls are mounted
      expect(screen.getByTestId('stage-floating-controls')).toBeInTheDocument();

      assertZeroHorizontalOverflow(container, 320);
    });

    it('verifies touch target >= 44px on toggle-singer-${id}', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const toggleBtn = screen.getByTestId('toggle-singer-1');
      expect(toggleBtn.className).toContain('min-h-[44px]');
      expect(toggleBtn.className).toContain('min-w-[44px]');
    });

    it('verifies touch target >= 44px on stage-fullscreen-toggle', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          isPlaying={false}
          onSeek={vi.fn()}
        />
      );

      const btn = screen.getByTestId('stage-fullscreen-toggle');
      expect(btn.className).toContain('min-h-[44px]');
      expect(btn.className).toContain('min-w-[44px]');
    });

    it('verifies touch target >= 44px on stage-play-pause-btn and the exit-fullscreen toggle in Stage Mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          isPlaying={false}
          onSeek={vi.fn()}
          onTogglePlay={vi.fn()}
        />
      );

      // Enter fullscreen
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const playPauseBtn = screen.getByTestId('stage-play-pause-btn');
      expect(playPauseBtn.className).toContain('min-h-[44px]');
      expect(playPauseBtn.className).toContain('min-w-[44px]');

      // The toolbar fullscreen toggle doubles as the exit control while fullscreen
      const exitBtn = screen.getByTestId('stage-fullscreen-toggle');
      expect(exitBtn).toHaveAccessibleName(/exit fullscreen stage/i);
      expect(exitBtn.className).toContain('min-h-[44px]');
      expect(exitBtn.className).toContain('min-w-[44px]');
    });

    it('verifies touch target >= 44px on duet-assign-btn', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={30.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const duetBtn = screen.getByTestId('duet-assign-btn');

      // Check whether duet-assign-btn satisfies >= 44px minimum touch target
      // Expected minimum height class of >= 44px: min-h-[44px], min-h-[48px], h-11, h-12, or p-3
      const has44pxMinHeight =
        duetBtn.className.includes('min-h-[44px]') ||
        duetBtn.className.includes('min-h-[48px]') ||
        duetBtn.className.includes('h-11') ||
        duetBtn.className.includes('h-12');

      expect(
        has44pxMinHeight,
        `duet-assign-btn failed >=44px touch target requirement! Current classes: "${duetBtn.className}"`
      ).toBe(true);
    });
  });
});
