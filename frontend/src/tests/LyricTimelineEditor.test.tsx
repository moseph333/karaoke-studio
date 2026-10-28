import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  within,
  fireEvent,
  act,
  waitFor,
  renderHook,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor, recalculateWordTimings } from '../components/LyricTimelineEditor';
import { DuetAssignmentModal } from '../components/timeline/DuetAssignmentModal';
import { useLyricEditorState } from '../hooks/useLyricEditorState';
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

  // --- Feature 44: Timeline Precision Nudging & Invariants Test Suite ---

  it('fine-nudges a line earlier and later by 0.05s', async () => {
    const user = userEvent.setup();
    const onSaveLines = vi.fn();
    render(<LyricTimelineEditor {...defaultProps} onSaveLines={onSaveLines} />);

    // Fine nudge earlier by 0.05s
    const fineEarlierBtn = screen.getByRole('button', { name: /nudge line 1 0.05s earlier/i });
    await user.click(fineEarlierBtn);

    expect(screen.getByText(/4.95s - 7.95s/i)).toBeInTheDocument();
    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();

    // Fine nudge later by 0.05s -> restores clean state
    const fineLaterBtn = screen.getByRole('button', { name: /nudge line 1 0.05s later/i });
    await user.click(fineLaterBtn);

    expect(screen.getByText(/5.0s - 8.0s/i)).toBeInTheDocument();
    expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
  });

  it('clamps line start at 0s and does not allow negative timestamps', async () => {
    const user = userEvent.setup();
    const lineNearZero: LyricLine[] = [
      {
        id: 99,
        text: 'Start of track',
        start_time: 0.02,
        end_time: 1.5,
        words: [{ word: 'Start', start_time: 0.02, end_time: 1.0 }],
      },
    ];
    render(<LyricTimelineEditor {...defaultProps} lines={lineNearZero} />);

    const coarseEarlierBtn = screen.getByRole('button', { name: /nudge line 99 0.2s earlier/i });
    await user.click(coarseEarlierBtn);

    // Line start clamped at 0.0s, not negative
    expect(screen.getByText(/0.0s -/i)).toBeInTheDocument();
  });

  it('precision nudges individual word boundaries with +/-0.05s buttons', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    // Expand line 1
    const expandBtn = screen.getByRole('button', { name: /expand word timings for line 1/i });
    await user.click(expandBtn);

    // Nudge word 'Is' start_time earlier by 0.05s
    const nudgeWordStartEarlier = screen.getByRole('button', {
      name: /nudge start of word Is 0.05s earlier/i,
    });
    await user.click(nudgeWordStartEarlier);

    expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(4.95);
  });

  it('enforces monotonic sequencing so word start_time cannot exceed word end_time', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    const expandBtn = screen.getByRole('button', { name: /expand word timings for line 1/i });
    await user.click(expandBtn);

    // 'Is' word has start 5.0, end 5.5. Nudge start later 15 times (+0.75s)
    const nudgeWordStartLater = screen.getByRole('button', {
      name: /nudge start of word Is 0.05s later/i,
    });
    for (let i = 0; i < 15; i++) {
      await user.click(nudgeWordStartLater);
    }

    const inputs = screen.getAllByRole('spinbutton');
    // Start must not exceed end_time (5.5)
    expect(parseFloat(inputs[0].getAttribute('value') || '0')).toBeLessThanOrEqual(5.5);
  });

  it('shifts entire word timing earlier and later with duration preserved', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    // Expand line 1
    const expandBtn = screen.getByRole('button', { name: /expand word timings for line 1/i });
    await user.click(expandBtn);

    // Word 'Is' has initial start: 5.0, end: 5.5 (duration 0.5s)
    const shiftEarlierBtn = screen.getByRole('button', { name: /nudge word Is 0.05s earlier/i });
    await user.click(shiftEarlierBtn);

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(4.95);
    expect(inputs[1]).toHaveValue(5.45);
  });

  // --- Feature 45: Discard Modal Focus Trapping ---

  it('traps focus in discard confirmation modal and dismisses on Escape', async () => {
    const user = userEvent.setup();
    render(<LyricTimelineEditor {...defaultProps} />);

    // Make dirty to reveal Discard Changes button
    const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
    await user.click(nudgeBtn);

    const discardTriggerBtn = screen.getByRole('button', { name: /discard changes/i });
    await user.click(discardTriggerBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const keepEditingBtn = screen.getByRole('button', { name: /keep editing/i });
    const confirmDiscardBtn = within(dialog).getByRole('button', { name: /discard changes/i });

    // Focus starts inside dialog
    expect(keepEditingBtn).toHaveFocus();

    // Tab to next button
    await user.tab();
    expect(confirmDiscardBtn).toHaveFocus();

    // Tab wraps back to first button
    await user.tab();
    expect(keepEditingBtn).toHaveFocus();

    // Press Escape dismisses modal and returns focus to trigger button
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(discardTriggerBtn).toHaveFocus();
  });

  // --- Feature 46: Word-by-Word Timeline Auto-Scroll & Manual Scroll Yielding ---

  describe('Feature 46: Word-by-Word Timeline Auto-Scroll & Manual Scroll Handling', () => {
    const multiScreenLines: LyricLine[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      text: `Line ${i + 1} with lyrics that extend down the transcript`,
      start_time: i * 5,
      end_time: i * 5 + 4,
      words: [
        { word: `WordA_${i + 1}`, start_time: i * 5, end_time: i * 5 + 1 },
        { word: `WordB_${i + 1}`, start_time: i * 5 + 1, end_time: i * 5 + 2 },
        { word: `WordC_${i + 1}`, start_time: i * 5 + 2, end_time: i * 5 + 3 },
        { word: `WordD_${i + 1}`, start_time: i * 5 + 3, end_time: i * 5 + 4 },
      ],
    }));

    const timelineProps = {
      lines: multiScreenLines,
      currentTime: 0.0,
      duration: 120.0,
      isPlaying: true,
      onSeek: vi.fn(),
      onSaveLines: vi.fn(),
    };

    it('highlights active word chips as currentTime advances through words in a line', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={0.5} />);

      // At 0.5s: Line 1, Word 1 ('WordA_1') is active
      const activeWord1 = screen.getByTestId('active-timeline-word');
      expect(activeWord1).toHaveTextContent('WordA_1');
      expect(activeWord1).toHaveAttribute('data-active-word', 'true');

      // Advance to 1.5s: Line 1, Word 2 ('WordB_1') becomes active
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={1.5} />);
      const activeWord2 = screen.getByTestId('active-timeline-word');
      expect(activeWord2).toHaveTextContent('WordB_1');
      expect(activeWord2).toHaveAttribute('data-active-word', 'true');
    });

    it('objectively increases container scrollTop as active word advances beyond initial visible area', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={0.5} />);

      const container = screen.getByTestId('timeline-scroll-container');
      const initialScroll = container.scrollTop;

      // Advance playback to line 7 (currentTime = 31.0s)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

      // Container scrollTop must increase to keep line 7 / word visible
      expect(container.scrollTop).toBeGreaterThan(initialScroll);

      const midScroll = container.scrollTop;

      // Advance playback further to line 11 (currentTime = 51.0s)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={51.0} />);

      // Container scrollTop increases further downward
      expect(container.scrollTop).toBeGreaterThan(midScroll);
    });

    it('keeps active highlighted word bounding box within the container viewport', () => {
      // Mock container and element bounding boxes to simulate real browser layout
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={21.5} />);

      const container = screen.getByTestId('timeline-scroll-container');
      // Verify scrollTop is updated
      expect(container.scrollTop).toBeGreaterThan(0);

      // Active word is currently line 5 Word B
      const activeWord = screen.getByTestId('active-timeline-word');
      expect(activeWord).toHaveTextContent('WordB_5');
      expect(activeWord).toBeInTheDocument();

      // Advancing to line 8 (currentTime = 36.5s)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={36.5} />);
      const newActiveWord = screen.getByTestId('active-timeline-word');
      expect(newActiveWord).toHaveTextContent('WordB_8');
    });

    it('yields auto-scrolling during manual user scroll events and prevents snap-back', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

      const container = screen.getByTestId('timeline-scroll-container');
      const preManualScroll = container.scrollTop;
      expect(preManualScroll).toBeGreaterThan(0);

      // User manually scrolls the timeline back towards the top
      act(() => {
        container.scrollTop = 20;
        fireEvent.scroll(container);
      });

      // Pause indicator should appear informing user that auto-scroll yielded
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Word advances while manual scroll pause is active
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={32.0} />);

      // Container MUST NOT snap back immediately during active manual scrolling
      expect(container.scrollTop).toBe(20);
    });

    it('resumes auto-scrolling cleanly after manual scroll idle timeout expires', () => {
      vi.useFakeTimers();
      try {
        const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

        const container = screen.getByTestId('timeline-scroll-container');
        expect(container.scrollTop).toBeGreaterThan(0);

        // User scrolls manually
        act(() => {
          container.scrollTop = 15;
          fireEvent.scroll(container);
        });

        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // Advance timers by idle timeout duration (2500ms)
        act(() => {
          vi.advanceTimersByTime(2600);
        });

        // Pause badge disappears
        expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

        // On next word advance, auto-scroll resumes and restores active position
        rerender(<LyricTimelineEditor {...timelineProps} currentTime={36.0} />);
        expect(container.scrollTop).toBeGreaterThan(15);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resumes auto-scrolling immediately when clicking resume button or seeking', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      const { rerender } = render(
        <LyricTimelineEditor {...timelineProps} currentTime={31.0} onSeek={onSeek} />
      );

      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls manually
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });

      const resumeBtn = screen.getByRole('button', { name: /Auto-scroll paused/i });
      expect(resumeBtn).toBeInTheDocument();

      // Clicking resume button clears pause and triggers auto-scroll to active word
      await user.click(resumeBtn);
      expect(screen.queryByRole('button', { name: /Auto-scroll paused/i })).not.toBeInTheDocument();
      expect(container.scrollTop).toBeGreaterThan(0);

      // Test seek resumption: manual scroll again
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Seeking (e.g. by time jump > 1.5s) immediately resets pause
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={45.0} onSeek={onSeek} />);
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
      expect(container.scrollTop).toBeGreaterThan(0);
    });

    it('allows seeking playback directly by clicking any word chip in the timeline', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(<LyricTimelineEditor {...timelineProps} onSeek={onSeek} />);

      const wordBtn = screen.getByRole('button', {
        name: /Jump to word WordC_1 in timeline/i,
      });
      await user.click(wordBtn);

      expect(onSeek).toHaveBeenCalledWith(2);
    });

    it('isolates timeline scrolling so window.scrollTo is never called', () => {
      const windowScrollToSpy = vi.spyOn(window, 'scrollTo');
      render(<LyricTimelineEditor {...timelineProps} currentTime={35.0} />);

      expect(windowScrollToSpy).not.toHaveBeenCalled();
    });

    it('does not pause auto-scroll during intermediate programmatic smooth scroll frames', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={0.5} />);
      const container = screen.getByTestId('timeline-scroll-container');
      (container as unknown as { __simulatingSmoothScroll?: boolean }).__simulatingSmoothScroll =
        true;
      container.scrollTo = vi.fn();

      // Advance playback to line 7 to initiate smooth scroll from 0 towards ~276
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

      // Simulate intermediate animation frame arriving at scrollTop = 80 (between 0 and 276)
      act(() => {
        container.scrollTop = 80;
        fireEvent.scroll(container);
      });

      // Intermediate frame within trajectory must NOT be flagged as manual scroll
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('does not pause when a smooth scroll emits a final frame after nearly reaching its target', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={0.5} />);
      const container = screen.getByTestId('timeline-scroll-container');
      (container as unknown as { __simulatingSmoothScroll?: boolean }).__simulatingSmoothScroll =
        true;
      const scrollTo = vi.fn();
      container.scrollTo = scrollTo;

      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const lastCall = scrollTo.mock.calls[scrollTo.mock.calls.length - 1];
      const target = (lastCall?.[0] as ScrollToOptions).top as number;
      expect(target).toBeGreaterThan(2);

      // Browsers can report a frame 1px short (which ends the auto-scroll) and then the target
      act(() => {
        container.scrollTop = target - 1;
        fireEvent.scroll(container);
      });
      act(() => {
        container.scrollTop = target;
        fireEvent.scroll(container);
      });

      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('resumes auto-scrolling immediately when user manually scrolls back to the active position', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls away to top
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // User manually scrolls back towards the active position (~276)
      act(() => {
        container.scrollTop = 270;
        fireEvent.scroll(container);
      });

      // Auto-scroll immediately unpauses without waiting for the 2.5s idle timeout
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('resumes auto-scrolling immediately on backward seek', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls away manually
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Backward seek: jump from 31.0s to 30.2s (delta < -0.1s)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={30.2} />);

      // Backward seek immediately resumes auto-scroll
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('resumes auto-scrolling immediately when user scrolls back to the advanced active position', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={30.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls manually away to top
      act(() => {
        container.scrollTop = 500;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Playback advances naturally within line (delta = 0.5s, below seek threshold) while user was paused
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={30.5} />);
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Scrolling to old position (Line 1, scrollTop = 0) does NOT resume because active position is at Line 7
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // User scrolls to the live active position (~270, near target 276)
      act(() => {
        container.scrollTop = 270;
        fireEvent.scroll(container);
      });

      // Auto-scroll resumes immediately for the live active position
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('yields auto-scrolling on keyboard scroll navigation and touch move events, but leaves space for play/pause', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // Space key must NOT trigger user scroll interaction (reserved for global play/pause)
      fireEvent.keyDown(container, { key: ' ' });
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

      // Test keyboard navigation (ArrowDown)
      fireEvent.keyDown(container, { key: 'ArrowDown' });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Resume
      fireEvent.click(screen.getByRole('button', { name: /Auto-scroll paused/i }));
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

      // Test touch move gesture
      fireEvent.touchMove(container);
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();
    });

    it('clears pending timeout when clicking resume button so no delayed snap occurs', () => {
      vi.useFakeTimers();
      try {
        render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
        const container = screen.getByTestId('timeline-scroll-container');

        // User scrolls manually
        act(() => {
          container.scrollTop = 0;
          fireEvent.scroll(container);
        });
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // 500ms in, user clicks resume button
        act(() => {
          vi.advanceTimersByTime(500);
        });
        const resumeBtn = screen.getByRole('button', { name: /Auto-scroll paused/i });
        fireEvent.click(resumeBtn);
        expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

        // User scrolls manually again 200ms later
        act(() => {
          container.scrollTop = 10;
          fireEvent.scroll(container);
        });
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // Advance by remaining time of the FIRST timer (2000ms from the original 2500ms)
        act(() => {
          vi.advanceTimersByTime(1800);
        });

        // The stale first timer must NOT have cleared the active user scroll state!
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not pause auto-scroll when clicking fine or coarse line nudge buttons during active playback', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const fineNudgeBtn = screen.getByRole('button', { name: /nudge line 7 0.05s earlier/i });

      // Click the nudge button (fires pointerdown followed by click)
      fireEvent.pointerDown(fineNudgeBtn);
      fireEvent.click(fineNudgeBtn);

      // Clicking an editor action button must NOT be classified as a manual scroll interaction
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('does not pause auto-scroll when using arrow keys inside timing input fields', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

      // Expand line 7 word timings
      const expandBtn = screen.getByRole('button', { name: /expand word timings for line 7/i });
      fireEvent.click(expandBtn);

      // Locate a word timing input inside the expanded grid
      const timingInput = screen.getByLabelText(/start time for word worda_7/i);
      expect(timingInput).toBeInTheDocument();

      // Press ArrowUp inside the number input to increment value
      fireEvent.keyDown(timingInput, { key: 'ArrowUp' });
      fireEvent.keyDown(timingInput, { key: 'ArrowDown' });
      fireEvent.keyDown(timingInput, { key: 'Home' });

      // Typing/navigating inside an input must NOT pause timeline auto-scrolling
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('resumes auto-scrolling immediately when playback restarts at 0.0s', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls manually
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Audio restarts at beginning (currentTime resets to 0.0)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={0.0} />);

      // Restart immediately clears manual scroll pause
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('avoids redundant scrollTo calls when active word advances along the same line/row with identical target', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={30.0} />);
      const container = screen.getByTestId('timeline-scroll-container');
      (container as unknown as { __simulatingSmoothScroll?: boolean }).__simulatingSmoothScroll =
        true;
      const scrollToSpy = vi.fn();
      container.scrollTo = scrollToSpy;

      // First word of Line 7 activates (currentTime = 30.5s -> line 7 word 1)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={30.5} />);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);

      // Second word of Line 7 activates (currentTime = 31.5s -> line 7 word 2)
      // Because it shares the same line/target, in-flight smooth scroll must NOT restart
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.5} />);
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });

    it('pauses auto-scroll immediately when user clicks container native scrollbar', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      // Mock bounding client rect: left = 0, width = 400, clientWidth = 385 (15px scrollbar on right)
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 380,
        width: 400,
        height: 380,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      Object.defineProperty(container, 'clientWidth', { value: 385, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 380, configurable: true });

      // Click on the scrollbar track at clientX = 390 (>= left + clientWidth = 385)
      fireEvent.pointerDown(container, { clientX: 390, clientY: 100 });

      // Native scrollbar interaction must immediately trigger auto-scroll yielding
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();
    });

    it('clamps targetScrollTop to preserve top breathing room when active element is tall', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 380,
        width: 400,
        height: 380,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      Object.defineProperty(container, 'clientHeight', { value: 380, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });

      const activeWord = screen.getByTestId('active-timeline-word');
      // Mock active word as a tall multi-line block (e.g. 500px tall, positioned at top = 300 when scrollTop = 0)
      vi.spyOn(activeWord, 'getBoundingClientRect').mockImplementation(() => ({
        left: 10,
        top: 300 - container.scrollTop,
        right: 390,
        bottom: 800 - container.scrollTop,
        width: 380,
        height: 500,
        x: 10,
        y: 300 - container.scrollTop,
        toJSON: () => ({}),
      }));

      // Target top must clamp so element top has at least 16px of clearance (targetTop <= relativeElementTop - 16)
      // relativeElementTop = 300 - 0 + 0 = 300; maxTargetTop = 300 - 16 = 284
      // Centering formula without clamp would be 300 - (380*0.38) + 250 = 405.6 -> top would be -105.6px (clipped!)
      // With our clamp, targetTop <= 284, so element top is >= 16px and never clipped.

      // First manually scroll away to 0 (pausing auto-scroll)
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // Returning to the clamped target position (284) unpauses cleanly
      act(() => {
        container.scrollTop = 284;
        fireEvent.scroll(container);
      });
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('pauses auto-scroll when user manually scrolls by small increments (< 40px) from active position without false-resuming', () => {
      render(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);
      const container = screen.getByTestId('timeline-scroll-container');
      // Active target for line 7 is ~276. container is at 276.
      expect(container.scrollTop).toBeGreaterThan(0);
      const activePos = container.scrollTop;

      // User scrolls by 15px (e.g. one mouse wheel tick to activePos + 15)
      act(() => {
        fireEvent.wheel(container);
        container.scrollTop = activePos + 15;
        fireEvent.scroll(container);
      });

      // Auto-scroll MUST pause and not immediately snap back or clear pause!
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();
    });

    it('resumes auto-scrolling when seeking forward by small steps (< 1.5s) while paused', () => {
      const { rerender } = render(
        <LyricTimelineEditor {...timelineProps} currentTime={31.0} isPlaying={false} />
      );
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls manually away
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // User seeks forward by 0.5s while paused (from 31.0 to 31.5)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.5} isPlaying={false} />);

      // A seek while paused must immediately resume auto-scroll
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('resets scroll container to top (scrollTop = 0) on restart at 0.0s during instrumental intro', () => {
      // Track with an intro starting at 5.0s
      const introLines: LyricLine[] = [
        {
          id: 1,
          text: 'First line after intro',
          start_time: 5.0,
          end_time: 8.0,
          words: [{ word: 'First', start_time: 5.0, end_time: 6.0 }],
        },
      ];
      const { rerender } = render(
        <LyricTimelineEditor
          lines={introLines}
          currentTime={6.0}
          duration={60}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );
      const container = screen.getByTestId('timeline-scroll-container');
      // Set scroll to some position > 0 (e.g. simulated scrolled down)
      container.scrollTop = 200;

      // Restart at 0.0s during intro
      rerender(
        <LyricTimelineEditor
          lines={introLines}
          currentTime={0.0}
          duration={60}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      // Container should scroll back to top (0) to show intro / top of timeline
      expect(container.scrollTop).toBe(0);
    });

    it('does not pause auto-scroll when in-flight smooth scroll redirects or reverses with momentum', () => {
      const { rerender } = render(<LyricTimelineEditor {...timelineProps} currentTime={0.5} />);
      const container = screen.getByTestId('timeline-scroll-container');
      (container as unknown as { __simulatingSmoothScroll?: boolean }).__simulatingSmoothScroll =
        true;
      container.scrollTo = vi.fn();

      // Start scrolling forward to Line 7 (~276)
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={31.0} />);

      // Scroll reaches 150 moving forward
      act(() => {
        container.scrollTop = 150;
        fireEvent.scroll(container);
      });
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

      // Now seek/jump backward to Line 2 (~0) while in transit
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={1.0} />);

      // Forward inertia carries next frame slightly past 150 (e.g. 156) before reversing
      act(() => {
        container.scrollTop = 156;
        fireEvent.scroll(container);
      });

      // Momentum during redirection must NOT be flagged as manual scroll
      expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    });

    it('does not falsely resume auto-scroll during active manual scrolling when playback advances at 2.0x speed', () => {
      const { rerender } = render(
        <LyricTimelineEditor {...timelineProps} currentTime={10.0} isPlaying={true} />
      );
      const container = screen.getByTestId('timeline-scroll-container');

      // User scrolls manually away to top and keeps scrolling
      act(() => {
        fireEvent.wheel(container);
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

      // At 2.0x speed, a frame/interval of ~800ms advances currentTime by 1.6s (10.0s -> 11.6s)
      // while user is actively scrolling
      act(() => {
        fireEvent.wheel(container);
      });
      rerender(<LyricTimelineEditor {...timelineProps} currentTime={11.6} isPlaying={true} />);

      // Playback progression at 2.0x must NOT cancel the user's manual scroll pause!
      expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();
    });
  });

  describe('Milestone 3: Lyric Editing, Dirty State & Persistence Suite', () => {
    const baseLines: LyricLine[] = [
      {
        id: 1,
        text: 'Original first line',
        start_time: 2.0,
        end_time: 5.0,
        words: recalculateWordTimings('Original first line', 2.0, 5.0),
      },
      {
        id: 2,
        text: 'Original second line',
        start_time: 6.0,
        end_time: 9.0,
        words: recalculateWordTimings('Original second line', 6.0, 9.0),
      },
    ];

    const defaultProps = {
      lines: baseLines,
      currentTime: 0.0,
      duration: 60.0,
      onSeek: vi.fn(),
      onSaveLines: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('shows dirty indicator badge and save button upon inline text edit', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      render(<LyricTimelineEditor {...defaultProps} onDirtyChange={onDirtyChange} />);

      // Initially clean
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();

      // Trigger inline edit on line 1
      const editBtn = screen.getByRole('button', { name: /edit text for line 1/i });
      await user.click(editBtn);

      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Modified first line{Enter}');

      // Dirty state reflected
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it('clears dirty indicator when edited text is manually restored to original', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Edit line text
      const editBtn = screen.getByRole('button', { name: /edit text for line 1/i });
      await user.click(editBtn);

      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Temporary text{Enter}');
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

      // Revert back to original string
      await user.click(screen.getByRole('button', { name: /edit text for line 1/i }));
      const input2 = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input2);
      await user.type(input2, 'Original first line{Enter}');

      // Deep equality restores clean state
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();
    });

    it('triggers dirty state upon inserting a new line', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      const insertBtn = screen.getByRole('button', { name: /insert line below line 1/i });
      await user.click(insertBtn);

      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      // Committing the inserted line ensures all lines are in display mode
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(3);
    });

    it('triggers dirty state upon deleting an existing line', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      const deleteBtn = screen.getByRole('button', { name: /delete line 2/i });
      await user.click(deleteBtn);

      const confirmBtn = screen.getByRole('button', { name: 'Delete Line' });
      await user.click(confirmBtn);

      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(1);
    });

    it('successful save persists lines, resets dirty state, and shows toast', async () => {
      const user = userEvent.setup();
      const onSaveLines = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));
      render(<LyricTimelineEditor {...defaultProps} onSaveLines={onSaveLines} />);

      // Make dirty
      const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
      await user.click(nudgeBtn);

      const saveBtn = screen.getByTestId('save-lyrics-btn');
      await user.click(saveBtn);

      // In-flight state: spinner active, button disabled
      expect(saveBtn).toBeDisabled();
      expect(screen.getByText(/Saving.../i)).toBeInTheDocument();

      // Await async save completion
      await waitFor(() => {
        expect(onSaveLines).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
        expect(screen.queryByTestId('save-lyrics-btn')).not.toBeInTheDocument();
      });
    });

    it('failed save retains dirty state and shows error toast', async () => {
      const user = userEvent.setup();
      const failingSave = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
      render(<LyricTimelineEditor {...defaultProps} onSaveLines={failingSave} />);

      const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s earlier/i });
      await user.click(nudgeBtn);

      const saveBtn = screen.getByTestId('save-lyrics-btn');
      await user.click(saveBtn);

      await waitFor(() => {
        expect(failingSave).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('save-lyrics-btn')).toBeInTheDocument();
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      });
    });

    it('cancelling discard modal leaves edited text and lines intact', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Modify line text
      const editBtn = screen.getByRole('button', { name: /edit text for line 1/i });
      await user.click(editBtn);
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Unsaved line draft{Enter}');

      // Open discard modal
      const discardBtn = screen.getByTestId('discard-changes-btn');
      await user.click(discardBtn);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Click Keep Editing
      const keepEditingBtn = screen.getByRole('button', { name: /keep editing/i });
      await user.click(keepEditingBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getAllByText(/Unsaved line draft/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('confirming discard modal reverts all edited lines and timings to baseline', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      // Modify line text
      const editBtn = screen.getByRole('button', { name: /edit text for line 1/i });
      await user.click(editBtn);
      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Draft to discard{Enter}');

      // Insert a line
      const insertBtn = screen.getByRole('button', { name: /insert line below line 1/i });
      await user.click(insertBtn);

      expect(screen.getAllByTestId(/^timeline-line-/)).toHaveLength(3);

      // Open discard modal
      await user.click(screen.getByTestId('discard-changes-btn'));
      const dialog = screen.getByRole('dialog');

      // Confirm discard
      const confirmBtn = within(dialog).getByRole('button', { name: /discard changes/i });
      await user.click(confirmBtn);

      // State reverted
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(2);
      expect(screen.getAllByText('Original first line').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Draft to discard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('cancelling delete line modal leaves line intact', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      const deleteBtn = screen.getByRole('button', { name: /delete line 1/i });
      await user.click(deleteBtn);

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelBtn);

      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(2);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('escapes inline text editing without triggering dirty state', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      const editBtn = screen.getByRole('button', { name: /edit text for line 1/i });
      await user.click(editBtn);

      const input = screen.getByRole('textbox', { name: /edit text for line 1/i });
      await user.clear(input);
      await user.type(input, 'Cancelled draft');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getAllByText('Original first line').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('allows inserting a line at the end via global Add Lyric Line button', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} />);

      const addBtn = screen.getByTestId('add-line-btn');
      await user.click(addBtn);

      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(3);
    });

    it('renders empty state when all lines are deleted and allows adding first line', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...defaultProps} lines={[]} />);

      expect(screen.getByText(/No lyric lines yet/i)).toBeInTheDocument();
      const addFirstBtn = screen.getByRole('button', { name: /\+ Add First Lyric Line/i });
      expect(addFirstBtn).toBeInTheDocument();

      await user.click(addFirstBtn);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(screen.getAllByRole('button', { name: /select line:/i })).toHaveLength(1);
    });
  });
});

describe('Duet / Multi-Singer Part Assignment (Requirement R2)', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Lead verse begins here',
      start_time: 1.0,
      end_time: 4.0,
      words: [
        { word: 'Lead', start_time: 1.0, end_time: 1.8 },
        { word: 'verse', start_time: 1.8, end_time: 2.6 },
        { word: 'begins', start_time: 2.6, end_time: 3.2 },
        { word: 'here', start_time: 3.2, end_time: 4.0 },
      ],
      singer: 'singer1',
    },
    {
      id: 2,
      text: 'Partner responds to call',
      start_time: 7.0, // 3.0s gap from line 1 (> 2.5s)
      end_time: 10.0,
      words: [
        { word: 'Partner', start_time: 7.0, end_time: 7.8 },
        { word: 'responds', start_time: 7.8, end_time: 8.5 },
        { word: 'to', start_time: 8.5, end_time: 9.0 },
        { word: 'call', start_time: 9.0, end_time: 10.0 },
      ],
      singer: 'singer2',
    },
    {
      id: 3,
      text: 'Both singing together now',
      start_time: 10.5, // 0.5s gap from line 2 (< 2.5s)
      end_time: 14.0,
      words: [
        { word: 'Both', start_time: 10.5, end_time: 11.2 },
        { word: 'singing', start_time: 11.2, end_time: 12.0 },
        { word: 'together', start_time: 12.0, end_time: 13.0 },
        { word: 'now', start_time: 13.0, end_time: 14.0 },
      ],
      singer: 'both',
    },
    {
      id: 4,
      text: 'Fourth line continuation',
      start_time: 17.0, // 3.0s gap from line 3 (> 2.5s)
      end_time: 20.0,
      words: [
        { word: 'Fourth', start_time: 17.0, end_time: 17.8 },
        { word: 'line', start_time: 17.8, end_time: 18.5 },
        { word: 'continuation', start_time: 18.5, end_time: 20.0 },
      ],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. DuetAssignmentModal Component Tests
  // =========================================================================
  describe('DuetAssignmentModal Component', () => {
    it('renders modal dialog with tabs when isOpen is true', () => {
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={vi.fn()}
          lines={sampleLines}
          onApply={vi.fn()}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Duet & Multi-Singer Assignment')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Alternating/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Range/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Auto-Suggest/i })).toBeInTheDocument();
      expect(screen.getByTestId('duet-preview-summary')).toBeInTheDocument();
    });

    it('does not render modal when isOpen is false', () => {
      render(
        <DuetAssignmentModal
          isOpen={false}
          onClose={vi.fn()}
          lines={sampleLines}
          onApply={vi.fn()}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('submits alternating pattern (1x1 and 2x2) and calls onApply', () => {
      const handleApply = vi.fn();
      const handleClose = vi.fn();
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={handleClose}
          lines={sampleLines}
          onApply={handleApply}
        />
      );

      // Select 2-by-2 pattern
      fireEvent.click(screen.getByText(/2-by-2/i));
      // Select start with Singer 2
      fireEvent.click(screen.getByText(/Start with Singer 2/i));

      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      expect(handleApply).toHaveBeenCalledWith({
        mode: 'alternating',
        pattern: '2x2',
        startSinger: 'singer2',
      });
      expect(handleClose).toHaveBeenCalled();
    });

    it('submits range assignment for all lines or custom line range', () => {
      const handleApply = vi.fn();
      const handleClose = vi.fn();
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={handleClose}
          lines={sampleLines}
          onApply={handleApply}
        />
      );

      // Switch to Range tab
      fireEvent.click(screen.getByRole('tab', { name: /Range/i }));

      // Select Custom Range
      fireEvent.click(screen.getByText(/Custom Range/i));
      const startInput = screen.getByLabelText(/From Line #/i);
      const endInput = screen.getByLabelText(/To Line #/i);
      fireEvent.change(startInput, { target: { value: '2' } });
      fireEvent.change(endInput, { target: { value: '3' } });

      // Select Both role
      fireEvent.click(screen.getByRole('button', { name: /👥 Both/i }));

      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      expect(handleApply).toHaveBeenCalledWith({
        mode: 'range',
        startLineIndex: 1, // 0-indexed
        endLineIndex: 2, // 0-indexed
        singer: 'both',
      });
      expect(handleClose).toHaveBeenCalled();
    });

    it('submits auto-suggest duet split with pause threshold', () => {
      const handleApply = vi.fn();
      const handleClose = vi.fn();
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={handleClose}
          lines={sampleLines}
          onApply={handleApply}
        />
      );

      // Switch to Auto-Suggest tab
      fireEvent.click(screen.getByRole('tab', { name: /Auto-Suggest/i }));

      // Adjust threshold slider
      const slider = screen.getByLabelText(/Inter-Line Pause Threshold/i);
      fireEvent.change(slider, { target: { value: '3.0' } });

      // Select Singer 2 Starts
      fireEvent.click(screen.getByText(/Singer 2 Starts/i));

      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      expect(handleApply).toHaveBeenCalledWith({
        mode: 'auto',
        pauseThreshold: 3.0,
        startSinger: 'singer2',
      });
      expect(handleClose).toHaveBeenCalled();
    });

    it('computes and updates live preview distribution summary across modes', () => {
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={vi.fn()}
          lines={sampleLines}
          onApply={vi.fn()}
        />
      );

      const summary = screen.getByTestId('duet-preview-summary');
      expect(summary).toBeInTheDocument();
      // Initially alternating 1x1: 4 lines -> 2 S1 (50%), 2 S2 (50%)
      expect(within(summary).getByText(/Singer 1/i)).toBeInTheDocument();
      expect(within(summary).getByText(/Singer 2/i)).toBeInTheDocument();
    });

    it('closes modal on cancel button and escape key press', async () => {
      const handleClose = vi.fn();
      render(
        <DuetAssignmentModal
          isOpen={true}
          onClose={handleClose}
          lines={sampleLines}
          onApply={vi.fn()}
        />
      );

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).toHaveBeenCalledTimes(1);

      // Click Cancel
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(handleClose).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // 2. TimelineLineCard Singer Pill & Cycle Tests
  // =========================================================================
  describe('TimelineLineCard Singer Pill & Cycle Controls', () => {
    it('renders singer cycle pill button for each line with accessible ARIA label and min 44px target', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const pill1 = screen.getByTestId('toggle-singer-1');
      expect(pill1).toBeInTheDocument();
      expect(pill1).toHaveTextContent('S1');
      expect(pill1).toHaveAttribute('data-singer', 'singer1');
      // The part icon is decorative; the label carries the role
      expect(pill1.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(pill1).toHaveAttribute('aria-label', expect.stringContaining('Singer 1'));

      const pill2 = screen.getByTestId('toggle-singer-2');
      expect(pill2).toBeInTheDocument();
      expect(pill2).toHaveTextContent('S2');
      expect(pill2).toHaveAttribute('aria-label', expect.stringContaining('Singer 2'));

      const pill3 = screen.getByTestId('toggle-singer-3');
      expect(pill3).toBeInTheDocument();
      expect(pill3).toHaveTextContent('Both');
      expect(pill3).toHaveAttribute('aria-label', expect.stringContaining('Both'));
    });

    it('cycles singer role S1 -> S2 -> Both -> S1 when clicked', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const pill1 = screen.getByTestId('toggle-singer-1');
      expect(pill1).toHaveTextContent('S1');

      // Click 1: S1 -> S2
      fireEvent.click(pill1);
      expect(pill1).toHaveTextContent('S2');

      // Click 2: S2 -> Both
      fireEvent.click(pill1);
      expect(pill1).toHaveTextContent('Both');

      // Click 3: Both -> S1
      fireEvent.click(pill1);
      expect(pill1).toHaveTextContent('S1');
    });

    it('isolates click event from line selection and audio seek', () => {
      const handleSeek = vi.fn();
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={handleSeek}
          onSaveLines={vi.fn()}
        />
      );

      const pill1 = screen.getByTestId('toggle-singer-1');
      fireEvent.click(pill1);

      // onSeek should not be called when clicking the singer pill
      expect(handleSeek).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. LyricTimelineEditor Duet Integration & Undo/Redo Tests
  // =========================================================================
  describe('LyricTimelineEditor Duet Integration & History', () => {
    it('renders Duet Parts button in the power tools toolbar', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const duetBtn = screen.getByTestId('duet-assign-btn');
      expect(duetBtn).toBeInTheDocument();
      expect(duetBtn).not.toBeDisabled();
    });

    it('opens DuetAssignmentModal when clicking Duet Parts button', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('duet-assign-btn'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Duet & Multi-Singer Assignment')).toBeInTheDocument();
    });

    it('reverts singer cycle via Undo (Ctrl+Z) and restores on Redo (Ctrl+Y)', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const pill1 = screen.getByTestId('toggle-singer-1');
      expect(pill1).toHaveTextContent('S1');

      // Cycle S1 -> S2
      fireEvent.click(pill1);
      expect(pill1).toHaveTextContent('S2');
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

      // Undo -> restores S1
      fireEvent.click(screen.getByTestId('undo-lyrics-btn'));
      expect(pill1).toHaveTextContent('S1');

      // Redo -> restores S2
      fireEvent.click(screen.getByTestId('redo-lyrics-btn'));
      expect(pill1).toHaveTextContent('S2');
    });

    it('reverts bulk duet assignment in a single Undo step', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={0.0}
          duration={60.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      // Open Duet Modal
      fireEvent.click(screen.getByTestId('duet-assign-btn'));

      // Apply alternating 1x1
      fireEvent.click(screen.getByTestId('apply-duet-btn'));

      // Check lines are now S1, S2, S1, S2
      expect(screen.getByTestId('toggle-singer-1')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-2')).toHaveTextContent('S2');
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('S1');
      expect(screen.getByTestId('toggle-singer-4')).toHaveTextContent('S2');

      // Single Undo reverts line 3 back to original 'both' and line 4 to undefined/S1
      fireEvent.click(screen.getByTestId('undo-lyrics-btn'));
      expect(screen.getByTestId('toggle-singer-3')).toHaveTextContent('Both');
    });
  });

  // =========================================================================
  // 4. useLyricEditorState Hook Direct Tests
  // =========================================================================
  describe('useLyricEditorState Singer Role State Management', () => {
    it('cycles singer role across singer1, singer2, both', () => {
      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: sampleLines,
          currentTime: 0.0,
          duration: 60.0,
          onSaveLines: vi.fn(),
        })
      );

      expect(result.current.editableLines[0].singer).toBe('singer1');

      act(() => {
        result.current.handleCycleLineSinger(1);
      });
      expect(result.current.editableLines[0].singer).toBe('singer2');

      act(() => {
        result.current.handleCycleLineSinger(1);
      });
      expect(result.current.editableLines[0].singer).toBe('both');

      act(() => {
        result.current.handleCycleLineSinger(1);
      });
      expect(result.current.editableLines[0].singer).toBe('singer1');
    });

    it('sets line singer directly via handleSetLineSinger', () => {
      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: sampleLines,
          currentTime: 0.0,
          duration: 60.0,
          onSaveLines: vi.fn(),
        })
      );

      act(() => {
        result.current.handleSetLineSinger(1, 'both');
      });
      expect(result.current.editableLines[0].singer).toBe('both');
    });

    it('performs bulk assignment in range, alternating, and auto modes', () => {
      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: sampleLines,
          currentTime: 0.0,
          duration: 60.0,
          onSaveLines: vi.fn(),
        })
      );

      // Alternating 2x2
      act(() => {
        result.current.handleBulkAssignSinger({
          mode: 'alternating',
          pattern: '2x2',
          startSinger: 'singer1',
        });
      });
      expect(result.current.editableLines[0].singer).toBe('singer1');
      expect(result.current.editableLines[1].singer).toBe('singer1');
      expect(result.current.editableLines[2].singer).toBe('singer2');
      expect(result.current.editableLines[3].singer).toBe('singer2');

      // Auto-suggest with 2.5s threshold:
      // Line 1: start_time=1, end_time=4
      // Line 2: start_time=7 (gap = 3.0s >= 2.5s -> switches to S2)
      // Line 3: start_time=10.5 (gap = 0.5s < 2.5s -> remains S2)
      // Line 4: start_time=17 (gap = 3.0s >= 2.5s -> switches to S1)
      act(() => {
        result.current.handleBulkAssignSinger({
          mode: 'auto',
          pauseThreshold: 2.5,
          startSinger: 'singer1',
        });
      });
      expect(result.current.editableLines[0].singer).toBe('singer1');
      expect(result.current.editableLines[1].singer).toBe('singer2');
      expect(result.current.editableLines[2].singer).toBe('singer2');
      expect(result.current.editableLines[3].singer).toBe('singer1');
    });
  });
});
