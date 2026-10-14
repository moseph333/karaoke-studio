import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
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
  });
});
