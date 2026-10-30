import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { recalculateWordTimings } from '../../utils/lyrics';
import { LyricLine } from '../../types';

describe('Milestone 3 Challenger 2: Adversarial LyricTimelineEditor & Line Structure Stress Harness', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'First line of the song',
      start_time: 2.0,
      end_time: 5.0,
      words: recalculateWordTimings('First line of the song', 2.0, 5.0),
    },
    {
      id: 2,
      text: 'Second line of the song',
      start_time: 7.0,
      end_time: 10.0,
      words: recalculateWordTimings('Second line of the song', 7.0, 10.0),
    },
    {
      id: 3,
      text: 'Third line of the song',
      start_time: 12.0,
      end_time: 15.0,
      words: recalculateWordTimings('Third line of the song', 12.0, 15.0),
    },
  ];

  const defaultProps = {
    lines: sampleLines,
    currentTime: 0.0,
    duration: 60.0,
    onSeek: vi.fn(),
    onSaveLines: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // 1. Line Insertion: Top, Middle, Bottom, Overlap, Tight Gaps, Sequentials
  // =========================================================================
  describe('Focus Area 1: Line Insertion Boundary Conditions & Timing Invariants', () => {
    it('adversarially inserts above first line when first line starts at 0.0s', async () => {
      const user = userEvent.setup();
      const linesStartingAtZero: LyricLine[] = [
        {
          id: 1,
          text: 'Starts immediately at zero',
          start_time: 0.0,
          end_time: 3.0,
          words: recalculateWordTimings('Starts immediately at zero', 0.0, 3.0),
        },
      ];

      render(<LyricTimelineEditor {...defaultProps} lines={linesStartingAtZero} />);

      const insertAboveBtn = screen.getByTestId('insert-line-above-1');
      await user.click(insertAboveBtn);

      // Verify line is inserted at top
      const lineCards = screen.getAllByTestId(/^timeline-line-/);
      expect(lineCards).toHaveLength(2);

      // Newly inserted line is line 1 and starts in inline edit mode
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      expect(input).toHaveValue('New lyric line');

      // Commit edit
      await user.keyboard('{Enter}');

      // Verify IDs are monotonically reindexed: 1, 2
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();

      // Original line is now line 2
      const line2 = screen.getByTestId('timeline-line-2');
      expect(within(line2).getByText('Starts immediately at zero')).toBeInTheDocument();

      // Inserted line has non-negative, valid start and end times
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('0.0s - 0.5s')).toBeInTheDocument();
    });

    it('inserts above first line with moderate margin (0.6s < start_time < 3.5s)', async () => {
      const user = userEvent.setup();
      const linesWithModerateGap: LyricLine[] = [
        {
          id: 1,
          text: 'Starts at 2.0s',
          start_time: 2.0,
          end_time: 5.0,
          words: recalculateWordTimings('Starts at 2.0s', 2.0, 5.0),
        },
      ];

      render(<LyricTimelineEditor {...defaultProps} lines={linesWithModerateGap} />);

      await user.click(screen.getByTestId('insert-line-above-1'));
      await user.keyboard('{Enter}');

      // Margin is between 0.0s and 2.0 - 0.1 = 1.9s
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('0.0s - 1.9s')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();
    });

    it('inserts above first line with large intro margin (start_time >= 3.5s)', async () => {
      const user = userEvent.setup();
      const linesWithIntro: LyricLine[] = [
        {
          id: 1,
          text: 'After long intro',
          start_time: 10.0,
          end_time: 14.0,
          words: recalculateWordTimings('After long intro', 10.0, 14.0),
        },
      ];

      render(<LyricTimelineEditor {...defaultProps} lines={linesWithIntro} />);

      await user.click(screen.getByTestId('insert-line-above-1'));
      await user.keyboard('{Enter}');

      // Window is [10.0 - 3.2 = 6.8s, 10.0 - 0.2 = 9.8s]
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('6.8s - 9.8s')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();
    });

    it('inserts in a comfortable gap between lines (gap >= 0.6s)', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Line 1 ends at 5.0s, Line 2 starts at 7.0s (gap is 2.0s >= 0.6s)
      await user.click(screen.getByTestId('insert-line-below-1'));
      await user.keyboard('{Enter}');

      const lineCards = screen.getAllByTestId(/^timeline-line-/);
      expect(lineCards).toHaveLength(4);

      // Inserted line is line 2: start_time = 5.1s, end_time = 6.9s
      const line2 = screen.getByTestId('timeline-line-2');
      expect(within(line2).getByText('5.1s - 6.9s')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-3')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-4')).toBeInTheDocument();
    });

    it('inserts when lines touch or overlap without crashing or invalid timestamps', async () => {
      const user = userEvent.setup();
      const overlappingLines: LyricLine[] = [
        {
          id: 1,
          text: 'First overlapping line',
          start_time: 2.0,
          end_time: 5.5,
          words: recalculateWordTimings('First overlapping line', 2.0, 5.5),
        },
        {
          id: 2,
          text: 'Second overlapping line',
          start_time: 5.0, // overlaps by 0.5s with line 1!
          end_time: 8.0,
          words: recalculateWordTimings('Second overlapping line', 5.0, 8.0),
        },
      ];

      render(<LyricTimelineEditor {...defaultProps} lines={overlappingLines} />);

      await user.click(screen.getByTestId('insert-line-below-1'));
      await user.keyboard('{Enter}');

      const lineCards = screen.getAllByTestId(/^timeline-line-/);
      expect(lineCards).toHaveLength(3);

      // Tight fallback inserts at [prev.end = 5.5, prev.end + 2.0 = 7.5]
      const line2 = screen.getByTestId('timeline-line-2');
      expect(within(line2).getByText('5.5s - 7.5s')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();
    });

    it('inserts at end and respects song duration boundary clamping', async () => {
      const user = userEvent.setup();
      const tightLines: LyricLine[] = [
        {
          id: 1,
          text: 'Tight end line',
          start_time: 6.0,
          end_time: 9.0,
          words: recalculateWordTimings('Tight end line', 6.0, 9.0),
        },
      ];

      render(<LyricTimelineEditor {...defaultProps} lines={tightLines} duration={11.0} />);

      // Insert line below line 1: start = 9.0 + 0.5 = 9.5s. duration = 11.0s.
      // Normal end would be 9.5 + 3.0 = 12.5s, but clamped to duration 11.0s!
      await user.click(screen.getByTestId('insert-line-below-1'));
      await user.keyboard('{Enter}');

      const line2 = screen.getByTestId('timeline-line-2');
      expect(within(line2).getByText('9.5s - 11.0s')).toBeInTheDocument();
    });

    it('handles multiple sequential line insertions at top, middle, and bottom without ID drift', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // 1. Insert at top twice
      await user.click(screen.getByTestId('insert-line-above-1'));
      await user.keyboard('{Enter}');
      await user.click(screen.getByTestId('insert-line-above-1'));
      await user.keyboard('{Enter}');

      // 2. Insert at end twice
      await user.click(screen.getByTestId('add-line-btn'));
      await user.keyboard('{Enter}');
      await user.click(screen.getByTestId('add-line-btn'));
      await user.keyboard('{Enter}');

      // Total lines should be 3 original + 2 top + 2 end = 7 lines
      const lineCards = screen.getAllByTestId(/^timeline-line-/);
      expect(lineCards).toHaveLength(7);

      for (let i = 1; i <= 7; i++) {
        expect(screen.getByTestId(`timeline-line-${i}`)).toBeInTheDocument();
      }
    });
  });

  // =========================================================================
  // 2. Line Deletion: Middle, First, Last, Deletion to 0 & Empty State
  // =========================================================================
  describe('Focus Area 2: Line Deletion & Empty State Lifecycle', () => {
    it('deletes intermediate line and shifts remaining lines monotonically', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Delete line 2
      await user.click(screen.getByTestId('delete-line-2'));

      // Confirm modal appears with line details
      const modal = screen.getByRole('dialog', { name: /delete lyric line/i });
      expect(modal).toBeInTheDocument();
      expect(within(modal).getByText(/Second line of the song/i)).toBeInTheDocument();

      // Confirm deletion
      const confirmBtn = within(modal).getByRole('button', { name: 'Delete Line' });
      await user.click(confirmBtn);

      // Modal unmounts
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // 2 lines remain, re-indexed to 1 and 2
      const lineCards = screen.getAllByTestId(/^timeline-line-/);
      expect(lineCards).toHaveLength(2);
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();

      // Line 2 now contains what was originally line 3
      const line2 = screen.getByTestId('timeline-line-2');
      expect(within(line2).getByText('Third line of the song')).toBeInTheDocument();
    });

    it('cancels line deletion and preserves line untouched', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('delete-line-1'));
      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();

      // Click Cancel
      await user.click(within(modal).getByRole('button', { name: 'Cancel' }));

      // Modal unmounts, all 3 lines intact
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(3);
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('sequentially deletes all lines to 0 and renders accessible empty state', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Delete line 1
      await user.click(screen.getByTestId('delete-line-1'));
      await user.click(screen.getByRole('button', { name: 'Delete Line' }));

      // Delete line 1 (was line 2)
      await user.click(screen.getByTestId('delete-line-1'));
      await user.click(screen.getByRole('button', { name: 'Delete Line' }));

      // Delete line 1 (was line 3)
      await user.click(screen.getByTestId('delete-line-1'));
      await user.click(screen.getByRole('button', { name: 'Delete Line' }));

      // All lines deleted: empty state is shown
      expect(screen.queryAllByTestId(/^timeline-line-/)).toHaveLength(0);
      expect(screen.getByText('No lyric lines yet.')).toBeInTheDocument();

      const addFirstBtn = screen.getByRole('button', { name: /\+ Add First Lyric Line/i });
      expect(addFirstBtn).toBeInTheDocument();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

      // Click Add First Lyric Line
      await user.click(addFirstBtn);

      // Line 1 is created in edit mode
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      expect(input).toHaveValue('New lyric line');

      // Commit edit
      await user.keyboard('{Enter}');
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('New lyric line')).toBeInTheDocument();
      expect(screen.queryByText('No lyric lines yet.')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. Monotonic ID Re-indexing Stress Invariants
  // =========================================================================
  describe('Focus Area 3: Monotonic ID Re-indexing Invariant Suite', () => {
    it('guarantees strictly monotonic sequential IDs 1..N across interleaved operations', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Operation 1: Insert above line 1
      await user.click(screen.getByTestId('insert-line-above-1'));
      await user.keyboard('{Enter}');

      // Operation 2: Insert below line 3
      await user.click(screen.getByTestId('insert-line-below-3'));
      await user.keyboard('{Enter}');

      // Operation 3: Delete line 2
      await user.click(screen.getByTestId('delete-line-2'));
      await user.click(screen.getByRole('button', { name: 'Delete Line' }));

      // Operation 4: Insert at end
      await user.click(screen.getByTestId('add-line-btn'));
      await user.keyboard('{Enter}');

      // Operation 5: Delete line 1
      await user.click(screen.getByTestId('delete-line-1'));
      await user.click(screen.getByRole('button', { name: 'Delete Line' }));

      // Verify current line IDs are strictly [1, 2, 3, 4]
      const lines = screen.getAllByTestId(/^timeline-line-/);
      expect(lines).toHaveLength(4);

      lines.forEach((lineEl, idx) => {
        const expectedId = idx + 1;
        expect(lineEl.getAttribute('data-testid')).toBe(`timeline-line-${expectedId}`);
      });
    });
  });

  // =========================================================================
  // 4. Dirty State Toggling, Restoration, Modal Discard, and Prop Race
  // =========================================================================
  describe('Focus Area 4: Dirty State Transitions & Discard Confirmation Harness', () => {
    it('toggles dirty indicator on inline text edit and restores clean state on reverting to original', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      render(<LyricTimelineEditor {...defaultProps} onDirtyChange={onDirtyChange} />);

      // Clean
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();

      // Edit line 1
      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Adversarial draft text{Enter}');

      // Dirty
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenCalledWith(true);

      // Revert text to original 'First line of the song'
      await user.click(screen.getByTestId('edit-line-text-1'));
      const input2 = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input2);
      await user.type(input2, 'First line of the song{Enter}');

      // Clean again!
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('prompts discard confirmation modal and preserves state on Keep Editing', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('insert-line-below-1'));
      await user.keyboard('{Enter}');

      // Open discard modal
      await user.click(screen.getByTestId('discard-changes-btn'));
      const modal = screen.getByRole('dialog', { name: /discard unsaved timing changes/i });
      expect(modal).toBeInTheDocument();

      // Click Keep Editing
      await user.click(within(modal).getByRole('button', { name: /keep editing/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // State remains dirty and edited line remains
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(4);
    });

    it('reverts all lines and timing modifications on confirming Discard Changes', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Make multiple edits
      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'To be discarded{Enter}');

      await user.click(screen.getByTestId('insert-line-below-2'));
      await user.keyboard('{Enter}');

      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(4);

      // Discard
      await user.click(screen.getByTestId('discard-changes-btn'));
      const modal = screen.getByRole('dialog', { name: /discard unsaved timing changes/i });
      await user.click(within(modal).getByRole('button', { name: 'Discard Changes' }));

      // Baseline restored
      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(3);
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('First line of the song')).toBeInTheDocument();
      expect(screen.queryByText('To be discarded')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('does not clobber user dirty edits when parent component passes updated lines prop', () => {
      const { rerender } = render(<LyricTimelineEditor {...defaultProps} />);

      // Make dirty by inserting line
      fireEvent.click(screen.getByTestId('insert-line-above-1'));

      // New lines passed from parent (e.g. background polling refresh)
      const externalUpdatedLines: LyricLine[] = [
        {
          id: 1,
          text: 'External poller update',
          start_time: 1.0,
          end_time: 4.0,
          words: recalculateWordTimings('External poller update', 1.0, 4.0),
        },
      ];

      rerender(<LyricTimelineEditor {...defaultProps} lines={externalUpdatedLines} />);

      // Should NOT overwrite dirty state: still has 4 lines
      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(4);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('syncs to external lines prop when clean', () => {
      const { rerender } = render(<LyricTimelineEditor {...defaultProps} />);

      const externalUpdatedLines: LyricLine[] = [
        {
          id: 1,
          text: 'External clean update',
          start_time: 1.0,
          end_time: 4.0,
          words: recalculateWordTimings('External clean update', 1.0, 4.0),
        },
      ];

      rerender(<LyricTimelineEditor {...defaultProps} lines={externalUpdatedLines} />);

      // Successfully synced
      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(1);
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('External clean update')).toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 5. Keyboard Accessibility, Inline Edit Inputs, Blur vs Cancel, Unicode
  // =========================================================================
  describe('Focus Area 5: Keyboard Accessibility & Inline Text Input Mechanics', () => {
    it('commits inline text edit on Enter key and cancels on Escape key', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Double-click to start edit
      const lineBtn = screen.getByRole('button', { name: /select line: First line of the song/i });
      fireEvent.doubleClick(lineBtn);

      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      expect(input).toBeInTheDocument();

      // Type and cancel via Escape
      await user.clear(input);
      await user.type(input, 'Uncommitted draft');
      fireEvent.keyDown(input, { key: 'Escape' });

      // Unmounts input without changing text or marking dirty
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('First line of the song')).toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();

      // Now click edit button and commit via Enter
      await user.click(screen.getByTestId('edit-line-text-1'));
      const input2 = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input2);
      await user.type(input2, 'Committed with enter key{Enter}');

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(within(line1).getByText('Committed with enter key')).toBeInTheDocument();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('commits inline text edit on blur', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Blurred text commit');

      // Blur input
      fireEvent.blur(input);

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('Blurred text commit')).toBeInTheDocument();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('prevents blur-commit collision when clicking cancel button on mousedown', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Discard via cancel button');

      // Cancel button has onMouseDown preventDefault to prevent blur event firing first
      const cancelBtn = screen.getByTestId('cancel-edit-1');
      fireEvent.mouseDown(cancelBtn);
      fireEvent.click(cancelBtn);

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('First line of the song')).toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('gracefully handles empty or whitespace-only text commit without corrupting line', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, '     {Enter}');

      // Retains existing valid text and does not mark dirty
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('First line of the song')).toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('correctly tokenizes and recalculates word timings for CJK characters and symbols', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      await user.click(screen.getByTestId('edit-line-text-1'));
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'こんにちは世界 123 !{Enter}');

      // Line text updated in line 1 card
      const line1 = screen.getByTestId('timeline-line-1');
      expect(within(line1).getByText('こんにちは世界 123 !')).toBeInTheDocument();

      // Selecting the line shows its word stream with individual syllable tokens
      await user.click(within(line1).getByRole('button', { name: /select line: こんにちは世界/i }));
      expect(screen.getByRole('button', { name: /Jump to word こ/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word ん/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word に/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word ち/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word は/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word 世/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word 界/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Jump to word 123/i })).toBeInTheDocument();
    });
  });
});
