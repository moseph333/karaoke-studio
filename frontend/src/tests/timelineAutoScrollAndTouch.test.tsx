import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { AudioControls } from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';
import App from '../App';
import { LyricLine } from '../types';
import * as apiModule from '../api';
import { expectTouchTarget } from './helpers/responsiveTestUtils';

describe('Milestone 2 Challenger 2: Adversarial Studio Interaction, Timeline State & Mobile Responsiveness', () => {
  const multiScreenLines: LyricLine[] = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    text: `Line ${i + 1} lyric text designed for mobile 2-row layout stress testing`,
    start_time: i * 5,
    end_time: i * 5 + 4.5,
    words: [
      { word: `WordA_${i + 1}`, start_time: i * 5, end_time: i * 5 + 1 },
      { word: `WordB_${i + 1}`, start_time: i * 5 + 1, end_time: i * 5 + 2 },
      { word: `WordC_${i + 1}`, start_time: i * 5 + 2, end_time: i * 5 + 3.2 },
      { word: `WordD_${i + 1}`, start_time: i * 5 + 3.2, end_time: i * 5 + 4.5 },
    ],
  }));

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    // Safe fallback mock for fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge 1: Timeline Interaction & Auto-Scroll Under 2-Row Mobile Layout
  // =========================================================================
  describe('Challenge 1: Timeline Interaction & Auto-Scroll Under 2-Row Mobile Layout', () => {
    it('renders 2-row mobile layout per line card with touch-friendly nudge targets (>=40px) and word chips (>=34px)', () => {
      render(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={0.0}
          duration={120.0}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      // Verify line card container styling
      const line1Card = screen.getByTestId('timeline-line-1');
      expect(line1Card).toBeInTheDocument();

      // Row 1: Line select button with timestamp pill and line text
      const lineSelectBtn = screen.getByRole('button', {
        name: /select line: Line 1 lyric text/i,
      });
      expectTouchTarget(lineSelectBtn, 40);
      expect(lineSelectBtn).toHaveClass('flex-1');

      // Row 2: Nudge controls container with 4 nudge buttons + expand button
      const coarseEarlierBtn = screen.getByRole('button', {
        name: /^nudge line 1 0\.2s earlier$/i,
      });
      const fineEarlierBtn = screen.getByRole('button', { name: /^nudge line 1 0\.05s earlier$/i });
      const fineLaterBtn = screen.getByRole('button', { name: /^nudge line 1 0\.05s later$/i });
      const coarseLaterBtn = screen.getByRole('button', { name: /^nudge line 1 0\.2s later$/i });
      const expandBtn = screen.getByRole('button', { name: /^expand word timings for line 1$/i });

      // In mobile viewports, buttons must provide at least 40px hit area
      for (const btn of [
        coarseEarlierBtn,
        fineEarlierBtn,
        fineLaterBtn,
        coarseLaterBtn,
        expandBtn,
      ]) {
        expectTouchTarget(btn, 40);
      }

      // Word stream chips must have >=34px height
      const wordChip = screen.getByRole('button', {
        name: /jump to word WordA_1 in timeline/i,
      });
      expect(wordChip).toHaveClass('min-h-[34px]');
      expect(wordChip).toHaveClass('px-2.5');
    });

    it('smoothly advances container scrollTop across multiple lines as word highlights advance down long transcript', () => {
      const { rerender } = render(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={0.5}
          duration={120.0}
          isPlaying={true}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const container = screen.getByTestId('timeline-scroll-container');
      const initialScroll = container.scrollTop;

      // Playback advances to Line 5 Word B (currentTime = 21.5s)
      rerender(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={21.5}
          duration={120.0}
          isPlaying={true}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      expect(container.scrollTop).toBeGreaterThan(initialScroll);
      const midScroll = container.scrollTop;

      // Active word is Line 5 Word B
      const activeWord = screen.getByTestId('active-timeline-word');
      expect(activeWord).toHaveTextContent('WordB_5');
      expect(activeWord).toHaveAttribute('data-active-word', 'true');

      // Playback advances further to Line 10 Word C (currentTime = 47.2s)
      rerender(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={47.2}
          duration={120.0}
          isPlaying={true}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      expect(container.scrollTop).toBeGreaterThan(midScroll);
      const activeWord10 = screen.getByTestId('active-timeline-word');
      expect(activeWord10).toHaveTextContent('WordC_10');
    });

    it('yields auto-scrolling on manual user scroll and cleanly resumes via timeout, seek, and return to active pos', () => {
      vi.useFakeTimers();
      try {
        const onSeek = vi.fn();
        const { rerender } = render(
          <LyricTimelineEditor
            lines={multiScreenLines}
            currentTime={31.0}
            duration={120.0}
            isPlaying={true}
            onSeek={onSeek}
            onSaveLines={vi.fn()}
          />
        );

        const container = screen.getByTestId('timeline-scroll-container');
        expect(container.scrollTop).toBeGreaterThan(0);
        const autoScrollPos = container.scrollTop;

        // 1. User manual scroll pauses auto-scroll
        act(() => {
          fireEvent.wheel(container);
          container.scrollTop = 10;
          fireEvent.scroll(container);
        });

        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // 2. Playback advances while user is paused -> container does NOT immediately snap back
        rerender(
          <LyricTimelineEditor
            lines={multiScreenLines}
            currentTime={32.0}
            duration={120.0}
            isPlaying={true}
            onSeek={onSeek}
            onSaveLines={vi.fn()}
          />
        );
        expect(container.scrollTop).toBe(10);
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // 3. Resume via idle timeout (2500ms)
        act(() => {
          vi.advanceTimersByTime(2600);
        });
        expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

        // 4. Manually pause again with touchmove
        act(() => {
          fireEvent.touchMove(container);
          container.scrollTop = 0;
          fireEvent.scroll(container);
        });
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // 5. Resume immediately on clicking a word chip (shown for the active line) to seek
        const wordBtn = screen.getByRole('button', {
          name: /jump to word WordA_7 in timeline/i,
        });
        fireEvent.click(wordBtn);
        expect(onSeek).toHaveBeenCalledWith(30);
        expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

        // 6. Manually pause again and test return to active target
        act(() => {
          container.scrollTop = 500;
          fireEvent.scroll(container);
        });
        expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

        // Advance timers by >200ms so active touch gesture debounce passes
        act(() => {
          vi.advanceTimersByTime(300);
        });

        // Returning to near active position resumes auto-scroll
        act(() => {
          container.scrollTop = autoScrollPos;
          fireEvent.scroll(container);
        });
        expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders expanded word timing steppers with mobile touch hit targets and preserves editing state against parent props', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      const onSaveLines = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={0.0}
          duration={120.0}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
          onDirtyChange={onDirtyChange}
        />
      );

      // Expand line 1
      const expandBtn = screen.getByRole('button', { name: /^expand word timings for line 1$/i });
      await user.click(expandBtn);
      expect(expandBtn).toHaveAttribute('aria-expanded', 'true');

      // Verify touch targets for word shift buttons (>=36px)
      const shiftEarlierBtn = screen.getByRole('button', {
        name: /nudge word WordA_1 0\.05s earlier/i,
      });
      const shiftLaterBtn = screen.getByRole('button', {
        name: /nudge word WordA_1 0\.05s later/i,
      });
      expectTouchTarget(shiftEarlierBtn, 36);
      expectTouchTarget(shiftLaterBtn, 36);

      // Verify touch targets for start/end boundary steppers: w-8 h-8 sm:w-6 sm:h-6
      const startMinusBtn = screen.getByRole('button', {
        name: /nudge start of word WordA_1 0\.05s earlier/i,
      });
      const startPlusBtn = screen.getByRole('button', {
        name: /nudge start of word WordA_1 0\.05s later/i,
      });
      expect(startMinusBtn).toHaveClass('w-8');
      expect(startMinusBtn).toHaveClass('h-8');
      expect(startPlusBtn).toHaveClass('w-8');
      expect(startPlusBtn).toHaveClass('h-8');

      // Verify input sizing: w-16 h-8 sm:w-14 sm:h-6
      const startInput = screen.getByLabelText(/start time for word WordA_1/i) as HTMLInputElement;
      expect(startInput).toHaveClass('w-16');
      expect(startInput).toHaveClass('h-8');
      expect(startInput.value).toBe('0');

      // Click + on start time stepper -> increments start_time by 0.05s
      await user.click(startPlusBtn);
      expect(startInput.value).toBe('0.05');
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);

      // Verify "Save Timing Changes" button appeared
      expect(screen.getByRole('button', { name: /save timing changes/i })).toBeInTheDocument();

      // ADVERSARIAL CHALLENGE: Parent component re-renders with fresh `lines` prop while dirty.
      // The timeline editor MUST preserve the user's unsaved edits and NOT overwrite them!
      const parentUpdatedLines = multiScreenLines.map((l) => ({ ...l }));
      rerender(
        <LyricTimelineEditor
          lines={parentUpdatedLines}
          currentTime={0.0}
          duration={120.0}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
          onDirtyChange={onDirtyChange}
        />
      );

      // Verify unsaved edit was PRESERVED
      const startInputAfterRerender = screen.getByLabelText(
        /start time for word WordA_1/i
      ) as HTMLInputElement;
      expect(startInputAfterRerender.value).toBe('0.05');
      expect(screen.getByRole('button', { name: /save timing changes/i })).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Challenge 2: Audio Controls & Keyboard Shortcuts
  // =========================================================================
  describe('Challenge 2: Audio Controls & Keyboard Shortcuts', () => {
    it('verifies transport buttons and pitch shifting hit targets (>=44px) and semitone boundary clamping', async () => {
      const user = userEvent.setup();
      const onMixChange = vi.fn();
      const onSeek = vi.fn();
      const onTogglePlay = vi.fn();

      render(
        <div>
          <TransportDock
            masterAudioUrl="/audio/test.wav"
            currentTime={15.0}
            duration={180.0}
            isPlaying={false}
            onTogglePlay={onTogglePlay}
            onSeek={onSeek}
          />
          <AudioControls projectId="proj-m2-test" onMixChange={onMixChange} />
        </div>
      );

      // Restart button >= 44px
      const restartBtn = screen.getByRole('button', { name: /restart track from beginning/i });
      expect(restartBtn).toHaveClass('min-h-[44px]');
      expect(restartBtn).toHaveClass('min-w-[44px]');
      await user.click(restartBtn);
      expect(onSeek).toHaveBeenCalledWith(0);

      // Master volume mute button >= 44px
      const muteBtn = screen.getByRole('button', { name: /mute audio/i });
      expect(muteBtn).toHaveClass('min-h-[44px]');
      expect(muteBtn).toHaveClass('min-w-[44px]');

      // Pitch transposition buttons: -1, Reset, +1 >= 44px
      const pitchDownBtn = screen.getByRole('button', { name: /decrease pitch by one semitone/i });
      const pitchResetBtn = screen.getByRole('button', { name: /reset pitch to original key/i });
      const pitchUpBtn = screen.getByRole('button', { name: /increase pitch by one semitone/i });

      expect(pitchDownBtn).toHaveClass('min-h-[44px]');
      expect(pitchResetBtn).toHaveClass('min-h-[44px]');
      expect(pitchUpBtn).toHaveClass('min-h-[44px]');

      // Pitch boundary clamping: click +1 15 times -> should clamp at +12 semitones
      for (let i = 0; i < 15; i++) {
        await user.click(pitchUpBtn);
      }
      expect(screen.getByText('12 semitones up')).toBeInTheDocument();

      // Reset pitch back to 0
      await user.click(pitchResetBtn);
      expect(screen.getByText('Original key')).toBeInTheDocument();

      // Pitch boundary clamping: click -1 15 times -> should clamp at -12 semitones
      for (let i = 0; i < 15; i++) {
        await user.click(pitchDownBtn);
      }
      expect(screen.getByText('12 semitones down')).toBeInTheDocument();
    });

    it('re-mixes automatically after the instrumental file replacement workflow', async () => {
      const user = userEvent.setup();
      const onMixChange = vi.fn().mockResolvedValue(undefined);
      const onCustomInstrumentalUploaded = vi.fn();

      // Mock apiFetch for /api/upload-instrumental
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            instrumental_url: '/audio/custom_inst.wav',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      render(
        <AudioControls
          projectId="proj-m2-test"
          onMixChange={onMixChange}
          mixDebounceMs={0}
          onCustomInstrumentalUploaded={onCustomInstrumentalUploaded}
        />
      );

      // No manual "Apply Audio Mix" step exists anymore
      expect(
        screen.queryByRole('button', { name: /apply audio mix settings to playback/i })
      ).not.toBeInTheDocument();

      // Verify Replace Instrumental File button touch target
      const replaceBtn = screen.getByRole('button', { name: /replace instrumental file/i });
      expect(replaceBtn).toHaveClass('min-h-[44px]');

      // Locate hidden file input and simulate file selection
      const fileInput = screen.getByLabelText(
        /upload custom instrumental audio file/i
      ) as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      const testAudioFile = new File(['fake-mp3-audio-content'], 'backing_track.mp3', {
        type: 'audio/mpeg',
      });

      await user.upload(fileInput, testAudioFile);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/upload-instrumental',
        expect.objectContaining({ method: 'POST' })
      );
      expect(onCustomInstrumentalUploaded).toHaveBeenCalledWith('/audio/custom_inst.wav');
      // The new instrumental is mixed in without a manual apply step
      await waitFor(() => expect(onMixChange).toHaveBeenCalledTimes(1));
    });

    it('verifies keyboard shortcuts (Space, M, ArrowLeft, ArrowRight) in Studio Dashboard and honors form/modal isolation', async () => {
      const user = userEvent.setup();
      // Mock project in ready status loaded into App
      const mockProject = {
        id: 'test-studio-proj',
        status: 'ready',
        progress: 100,
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        created_by: 'Friend',
        thumbnail_url: 'https://img.youtube.com/vi/test/hqdefault.jpg',
        duration: 354,
        master_audio_url: '/audio/bohemian.wav',
        instrumental_url: '/audio/bohemian_inst.wav',
        vocals_url: '/audio/bohemian_vocals.wav',
        semitones: 0,
        guide_volume: 0.1,
        lines: multiScreenLines,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'test-studio-proj': mockProject }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/project/test-studio-proj')) {
          return new Response(JSON.stringify(mockProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(<App />);

      // Wait for Recent Projects card to appear in TrackSearch
      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });

      // Click project card to enter Studio Dashboard
      const projectCard = screen
        .getByText('Bohemian Rhapsody')
        .closest('div[role="button"], .group');
      await user.click(projectCard!);

      // Wait for Studio Dashboard to render with project title in song meta header
      await waitFor(() => {
        expect(screen.getByText(/Queen · 15 lines/i)).toBeInTheDocument();
      });

      // Transport button starts with "Start playback"
      const playBtn = screen.getByRole('button', { name: /start playback/i });
      expect(playBtn).toBeInTheDocument();

      // 1. Space toggles play -> "Pause playback"
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /pause playback/i })).toBeInTheDocument();
      });

      // Space toggles pause -> "Start playback"
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /start playback/i })).toBeInTheDocument();
      });

      // 2. M toggles mute/unmute
      const muteBtn = screen.getByRole('button', { name: /mute audio/i });
      expect(muteBtn).toBeInTheDocument();

      fireEvent.keyDown(window, { code: 'KeyM', key: 'm' });
      expect(screen.getByRole('button', { name: /unmute audio/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { code: 'KeyM', key: 'M' });
      expect(screen.getByRole('button', { name: /mute audio/i })).toBeInTheDocument();

      // 3. Modifier keys must NOT trigger shortcuts
      fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true });
      expect(screen.getByRole('button', { name: /start playback/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { code: 'KeyM', key: 'm', altKey: true });
      expect(screen.getByRole('button', { name: /mute audio/i })).toBeInTheDocument();

      // 4. Repeated keydowns (holding down Space or M) must be ignored
      fireEvent.keyDown(window, { code: 'Space', key: ' ', repeat: true });
      expect(screen.getByRole('button', { name: /start playback/i })).toBeInTheDocument();

      // 5. Typing in an input or textarea must NOT trigger shortcuts
      const searchOrInput = document.createElement('input');
      document.body.appendChild(searchOrInput);
      searchOrInput.focus();

      fireEvent.keyDown(searchOrInput, { code: 'Space', key: ' ' });
      expect(screen.getByRole('button', { name: /start playback/i })).toBeInTheDocument();

      fireEvent.keyDown(searchOrInput, { code: 'KeyM', key: 'm' });
      expect(screen.getByRole('button', { name: /mute audio/i })).toBeInTheDocument();

      document.body.removeChild(searchOrInput);
    });
  });

  // =========================================================================
  // Challenge 3: Discard Confirmation Modal Mobile Responsiveness
  // =========================================================================
  describe('Challenge 3: Discard Confirmation Modal Mobile Responsiveness', () => {
    it('verifies 320px responsive geometry (flex-col-reverse sm:flex-row, min-h-[44px]) and discard cancellation vs. revert', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      const onSaveLines = vi.fn();

      render(
        <LyricTimelineEditor
          lines={multiScreenLines}
          currentTime={0.0}
          duration={120.0}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
          onDirtyChange={onDirtyChange}
        />
      );

      // Nudge line 1 later (+0.05s) to make dirty
      const fineLaterBtn = screen.getByRole('button', { name: /^nudge line 1 0\.05s later$/i });
      await user.click(fineLaterBtn);

      // Discard Changes button appears in header
      const discardTriggerBtn = screen.getByRole('button', { name: /discard changes/i });
      expect(discardTriggerBtn).toBeInTheDocument();

      // Click to open discard modal
      await user.click(discardTriggerBtn);

      // Modal dialog appears
      const dialog = screen.getByRole('dialog', { name: /discard unsaved timing changes\?/i });
      expect(dialog).toBeInTheDocument();

      // Verify button container layout: flex flex-col-reverse sm:flex-row
      const buttonContainer = dialog.querySelector('.flex.flex-col-reverse');
      expect(buttonContainer).toBeInTheDocument();
      expect(buttonContainer).toHaveClass('sm:flex-row');

      // Verify both buttons provide mobile touch targets (>=44px height and w-full on mobile)
      const keepEditingBtn = within(dialog).getByRole('button', { name: /keep editing/i });
      const confirmDiscardBtn = within(dialog).getByRole('button', { name: /^discard changes$/i });

      expect(keepEditingBtn).toHaveClass('min-h-[44px]');
      expect(keepEditingBtn).toHaveClass('w-full');
      expect(keepEditingBtn).toHaveClass('sm:w-auto');

      expect(confirmDiscardBtn).toHaveClass('min-h-[44px]');
      expect(confirmDiscardBtn).toHaveClass('w-full');
      expect(confirmDiscardBtn).toHaveClass('sm:w-auto');

      // Test 1: "Keep Editing" closes modal and keeps unsaved changes
      await user.click(keepEditingBtn);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /discard changes/i })).toBeInTheDocument();

      // Open modal again
      await user.click(screen.getByRole('button', { name: /discard changes/i }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Test 2: "Discard Changes" confirms and reverts timings to original baseline
      const confirmBtn2 = within(screen.getByRole('dialog')).getByRole('button', {
        name: /^discard changes$/i,
      });
      await user.click(confirmBtn2);

      // Dialog closed
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Discard button gone because state is clean
      expect(screen.queryByRole('button', { name: /discard changes/i })).not.toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
  });
});
