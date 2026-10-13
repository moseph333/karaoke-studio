import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { LyricLine } from '../types';

describe('LyricTimelineEditor', () => {
  const mockLines: LyricLine[] = [
    {
      id: 1,
      text: 'Is this the real life',
      start_time: 5.0,
      end_time: 8.0,
      words: [
        { word: 'Is', start_time: 5.0, end_time: 5.5 },
        { word: 'this', start_time: 5.5, end_time: 6.0 },
        { word: 'the', start_time: 6.0, end_time: 6.5 },
        { word: 'real', start_time: 6.5, end_time: 7.2 },
        { word: 'life', start_time: 7.2, end_time: 8.0 },
      ],
    },
    {
      id: 2,
      text: 'Is this just fantasy',
      start_time: 10.0,
      end_time: 13.0,
      words: [
        { word: 'Is', start_time: 10.0, end_time: 10.5 },
        { word: 'this', start_time: 10.5, end_time: 11.0 },
        { word: 'just', start_time: 11.0, end_time: 11.8 },
        { word: 'fantasy', start_time: 11.8, end_time: 13.0 },
      ],
    },
  ];

  const defaultProps = {
    lines: mockLines,
    currentTime: 0.0,
    duration: 60.0,
    onSeek: vi.fn(),
    onSaveLines: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders instrumental intro cue when current time is before first line', () => {
    render(<LyricTimelineEditor {...defaultProps} currentTime={0.0} />);

    expect(screen.getByText('♪ Instrumental Intro ♪')).toBeInTheDocument();
  });

  it('renders words of current active line on the stage preview', () => {
    render(<LyricTimelineEditor {...defaultProps} currentTime={6.0} />);

    expect(screen.getAllByText('Is this the real life').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Is this just fantasy').length).toBeGreaterThanOrEqual(1);
  });

  it('seeks audio when clicking a line in the timeline editor', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<LyricTimelineEditor {...defaultProps} onSeek={onSeek} />);

    const lineBtn = screen.getByRole('button', { name: /select line: Is this the real life/i });
    await user.click(lineBtn);

    expect(onSeek).toHaveBeenCalledWith(5.0);
  });

  it('nudges a line and shows Save Timing Changes button', async () => {
    const user = userEvent.setup();
    const onSaveLines = vi.fn().mockResolvedValue(undefined);
    render(<LyricTimelineEditor {...defaultProps} onSaveLines={onSaveLines} />);

    expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();

    const nudgeEarlierBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeEarlierBtn);

    const saveBtn = screen.getByText(/Save Timing Changes/i);
    expect(saveBtn).toBeInTheDocument();

    await user.click(saveBtn);
    expect(onSaveLines).toHaveBeenCalledTimes(1);
    const savedLines = onSaveLines.mock.calls[0][0];
    expect(savedLines[0].start_time).toBe(4.8);
  });

  // --- Feature 39: Unsaved Edits Guard, beforeunload, and Discard Tests ---

  it('detects dirty state when timings change and shows Discard Changes button', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<LyricTimelineEditor {...defaultProps} onDirtyChange={onDirtyChange} />);

    expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();

    const nudgeLaterBtn = screen.getByRole('button', { name: /nudge line 1 0.2s later/i });
    await user.click(nudgeLaterBtn);

    expect(screen.getByText(/Discard Changes/i)).toBeInTheDocument();
    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('tracks dirty state and manages beforeunload listener', async () => {
    const user = userEvent.setup();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    render(<LyricTimelineEditor {...defaultProps} />);

    // Initially clean
    expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();

    // Nudge line earlier -> dirty
    const nudgeEarlierBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeEarlierBtn);

    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
    expect(screen.getByText(/Discard Changes/i)).toBeInTheDocument();
    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    // Simulate dispatching beforeunload event
    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    // Nudge line later -> back to original (deep equality check)
    const nudgeLaterBtn = screen.getByRole('button', { name: /nudge line 1 0.2s later/i });
    await user.click(nudgeLaterBtn);

    expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('prompts confirmation when discarding changes and cancels discard if user chooses Keep Editing', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s later/i });
    await user.click(nudgeBtn);

    const discardBtn = screen.getByRole('button', { name: /discard changes/i });
    await user.click(discardBtn);

    // Confirmation dialog is displayed
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Discard Unsaved Timing Changes\?/i)).toBeInTheDocument();

    const keepEditingBtn = screen.getByRole('button', { name: /keep editing/i });
    await user.click(keepEditingBtn);

    // Dialog closes and dirty changes remain
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
  });

  it('reverts all line timings back to baseline when confirming Discard Changes', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeBtn);

    // Line 1 start is now 4.8s
    expect(screen.getByText(/4.8s - 7.8s/i)).toBeInTheDocument();

    const discardBtn = screen.getByRole('button', { name: /discard changes/i });
    await user.click(discardBtn);

    const dialog = screen.getByRole('dialog');
    const confirmDiscardBtn = within(dialog).getByRole('button', { name: /discard changes/i });
    await user.click(confirmDiscardBtn);

    // Reverted back to initial 5.0s and dirty buttons disappear
    expect(screen.getByText(/5.0s - 8.0s/i)).toBeInTheDocument();
    expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
  });

  it('retains dirty state if onSaveLines rejects', async () => {
    const user = userEvent.setup();
    const failingSave = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<LyricTimelineEditor {...defaultProps} onSaveLines={failingSave} />);

    const nudgeEarlierBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeEarlierBtn);

    const saveBtn = screen.getByText(/Save Timing Changes/i);
    await user.click(saveBtn);

    expect(failingSave).toHaveBeenCalledTimes(1);
    // Even after failed save, Save Timing Changes button remains present
    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
  });

  it('does not overwrite dirty edits when background polling updates prop lines', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LyricTimelineEditor {...defaultProps} />);

    const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeBtn);
    expect(screen.getByText(/4.8s - 7.8s/i)).toBeInTheDocument();

    // Parent re-renders with fresh prop lines
    rerender(<LyricTimelineEditor {...defaultProps} lines={[...mockLines]} />);

    // Edits are preserved, not clobbered
    expect(screen.getByText(/4.8s - 7.8s/i)).toBeInTheDocument();
    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
  });
});
