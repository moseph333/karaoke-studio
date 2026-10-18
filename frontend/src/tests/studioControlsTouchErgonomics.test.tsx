import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { AudioControls } from '../components/AudioControls';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import { LyricDisplay } from '../components/LyricDisplay';
import { LyricLine, ProjectState } from '../types';

describe('Milestone 2 Empirical Challenger Suite (Studio Dashboard & Mobile Touch Controls)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Is this the real life? Is this just fantasy?',
      start_time: 1.0,
      end_time: 5.5,
      words: [
        { word: 'Is', start_time: 1.0, end_time: 1.4 },
        { word: 'this', start_time: 1.4, end_time: 1.8 },
        { word: 'the', start_time: 1.8, end_time: 2.1 },
        { word: 'real', start_time: 2.1, end_time: 2.8 },
        { word: 'life?', start_time: 2.8, end_time: 3.5 },
        { word: 'Is', start_time: 3.6, end_time: 3.9 },
        { word: 'this', start_time: 3.9, end_time: 4.2 },
        { word: 'just', start_time: 4.2, end_time: 4.6 },
        { word: 'fantasy?', start_time: 4.6, end_time: 5.5 },
      ],
    },
    {
      id: 2,
      text: 'Caught in a landslide, no escape from reality',
      start_time: 6.0,
      end_time: 11.2,
      words: [
        { word: 'Caught', start_time: 6.0, end_time: 6.8 },
        { word: 'in', start_time: 6.8, end_time: 7.2 },
        { word: 'a', start_time: 7.2, end_time: 7.5 },
        { word: 'landslide,', start_time: 7.5, end_time: 8.5 },
        { word: 'no', start_time: 8.8, end_time: 9.3 },
        { word: 'escape', start_time: 9.3, end_time: 10.1 },
        { word: 'from', start_time: 10.1, end_time: 10.4 },
        { word: 'reality', start_time: 10.4, end_time: 11.2 },
      ],
    },
  ];

  describe('Focus Area 1: Mobile Line Item Layout at 320px in LyricTimelineEditor', () => {
    it('renders 2-row layout on mobile viewports with full text visibility without collapsing', () => {
      const onSeek = vi.fn();
      const onSaveLines = vi.fn();

      render(
        <div style={{ width: '320px', maxWidth: '320px' }}>
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={2.0}
            duration={120}
            onSeek={onSeek}
            onSaveLines={onSaveLines}
          />
        </div>
      );

      // Line item card
      const lineCard = screen.getByTestId('timeline-line-1');
      expect(lineCard).toBeInTheDocument();

      // Check the 2-row flex structure
      const rowContainer = lineCard.firstElementChild;
      expect(rowContainer).toHaveClass('flex', 'flex-col', 'sm:flex-row');

      // Row 1: Line select button contains timestamp pill and text
      const lineSelectBtn = screen.getByRole('button', {
        name: /select line: is this the real life\?/i,
      });
      expect(lineSelectBtn).toHaveClass('min-h-[40px]', 'w-full', 'sm:flex-1');

      // The line text span must have truncate, min-w-0, and flex-1
      const textSpan = within(lineSelectBtn).getByText(
        'Is this the real life? Is this just fantasy?'
      );
      expect(textSpan).toHaveClass('truncate', 'min-w-0', 'flex-1');

      // Row 2: Nudge & Expand Controls container
      const nudgeToolbar = lineCard.querySelector('.flex.items-center.justify-between');
      expect(nudgeToolbar).toBeInTheDocument();
      expect(nudgeToolbar).toHaveClass('border-t', 'sm:border-t-0', 'mt-2', 'sm:mt-0');
    });

    it('provides >=40px hit targets for all 4 line nudge buttons and accordion chevron', () => {
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const coarseEarlier = screen.getByRole('button', { name: /nudge line 1 0\.2s earlier/i });
      const fineEarlier = screen.getByRole('button', { name: /nudge line 1 0\.05s earlier/i });
      const fineLater = screen.getByRole('button', { name: /nudge line 1 0\.05s later/i });
      const coarseLater = screen.getByRole('button', { name: /nudge line 1 0\.2s later/i });
      const chevron = screen.getByRole('button', { name: /expand word timings for line 1/i });

      // All line timing toolbar controls must have min-h-[40px] and px-3 on mobile
      [coarseEarlier, fineEarlier, fineLater, coarseLater, chevron].forEach((btn) => {
        expect(btn).toHaveClass('min-h-[40px]');
        expect(btn).toHaveClass('px-3');
      });
    });

    it('expands word details with touch-friendly step buttons and whole-word shifts', async () => {
      const user = userEvent.setup();
      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      const chevron = screen.getByRole('button', { name: /expand word timings for line 1/i });
      await user.click(chevron);

      // Whole-word shift pills must have min-h-[36px] and min-w-[36px]
      const wordShiftEarlier = screen.getAllByRole('button', {
        name: /nudge word Is 0\.05s earlier/i,
      })[0];
      const wordShiftLater = screen.getAllByRole('button', {
        name: /nudge word Is 0\.05s later/i,
      })[0];
      expect(wordShiftEarlier).toHaveClass('min-h-[36px]', 'min-w-[36px]');
      expect(wordShiftLater).toHaveClass('min-h-[36px]', 'min-w-[36px]');

      // Boundary stepper +/- buttons must have w-8 h-8 on mobile
      const stepStartEarlier = screen.getAllByRole('button', {
        name: /nudge start of word Is 0\.05s earlier/i,
      })[0];
      const stepStartLater = screen.getAllByRole('button', {
        name: /nudge start of word Is 0\.05s later/i,
      })[0];
      expect(stepStartEarlier).toHaveClass('w-8', 'h-8');
      expect(stepStartLater).toHaveClass('w-8', 'h-8');

      // Number input must have w-16 h-8 on mobile
      const timeInput = screen.getAllByLabelText(/start time for word Is/i)[0];
      expect(timeInput).toHaveClass('w-16', 'h-8');
    });

    it('wraps word chips cleanly without horizontal blowout on mobile', () => {
      render(
        <div style={{ width: '320px' }}>
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={2.0}
            duration={120}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        </div>
      );

      const wordsContainer = screen.getByTestId('timeline-words-line-1');
      expect(wordsContainer).toHaveClass('flex', 'flex-wrap', 'gap-1.5');

      // Word chips have min-h-[34px] touch area
      const chips = within(wordsContainer).getAllByRole('button');
      expect(chips.length).toBe(9);
      chips.forEach((chip) => {
        expect(chip).toHaveClass('min-h-[34px]');
      });
    });
  });

  describe('Focus Area 2: Rapid Clicks on Nudge Buttons & Timestamp Monotonicity', () => {
    it('preserves non-negative bounds and monotonicity when rapidly nudging line earlier to 0.0s', async () => {
      const user = userEvent.setup();
      const onSaveLines = vi.fn();

      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
        />
      );

      const coarseEarlier = screen.getByRole('button', { name: /nudge line 1 0\.2s earlier/i });

      // Line 1 starts at 1.0s. Clicking -0.2s 15 times would mathematically reach -2.0s without clamping!
      for (let i = 0; i < 15; i++) {
        await user.click(coarseEarlier);
      }

      // Save to inspect the exported lines
      const saveBtn = screen.getByRole('button', { name: /save timing changes/i });
      await user.click(saveBtn);

      expect(onSaveLines).toHaveBeenCalledTimes(1);
      const savedLines: LyricLine[] = onSaveLines.mock.calls[0][0];
      const line1 = savedLines.find((l) => l.id === 1)!;

      // Start time must clamp at 0.0s, end time must remain >= start time
      expect(line1.start_time).toBe(0.0);
      expect(line1.end_time).toBeGreaterThanOrEqual(line1.start_time);

      // All words must have start_time >= 0, w.start_time <= w.end_time, and monotonic sequence
      for (let i = 0; i < line1.words.length; i++) {
        const w = line1.words[i];
        expect(w.start_time).toBeGreaterThanOrEqual(0);
        expect(w.end_time).toBeGreaterThanOrEqual(w.start_time);
        if (i > 0) {
          expect(w.start_time).toBeGreaterThanOrEqual(line1.words[i - 1].start_time);
        }
      }
    });

    it('preserves monotonicity and duration stability under alternating rapid fine nudges', async () => {
      const user = userEvent.setup();
      const onSaveLines = vi.fn();

      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
        />
      );

      const fineEarlier = screen.getByRole('button', { name: /nudge line 1 0\.05s earlier/i });
      const fineLater = screen.getByRole('button', { name: /nudge line 1 0\.05s later/i });

      // Alternate 20 clicks each
      for (let i = 0; i < 20; i++) {
        await user.click(fineEarlier);
        await user.click(fineLater);
      }

      // Initial start was 1.0s, end was 5.5s. Due to floating precision sanitization, must be exact 1.0 and 5.5
      const lineSelectBtn = screen.getByRole('button', {
        name: /select line: is this the real life\?/i,
      });
      expect(lineSelectBtn).toHaveTextContent('1.0s - 5.5s');

      // Now click 20 times forward (+0.2s each)
      const coarseLater = screen.getByRole('button', { name: /nudge line 1 0\.2s later/i });
      for (let i = 0; i < 20; i++) {
        await user.click(coarseLater);
      }

      // Start time should be 1.0 + 4.0 = 5.0s, end time 5.5 + 4.0 = 9.5s
      expect(lineSelectBtn).toHaveTextContent('5.0s - 9.5s');

      const saveBtn = screen.getByRole('button', { name: /save timing changes/i });
      await user.click(saveBtn);
      const savedLines: LyricLine[] = onSaveLines.mock.calls[0][0];
      const line1 = savedLines.find((l) => l.id === 1)!;

      expect(line1.start_time).toBe(5.0);
      expect(line1.end_time).toBe(9.5);
      line1.words.forEach((w) => {
        expect(w.start_time).toBeLessThanOrEqual(w.end_time);
      });
    }, 15000);

    it('enforces monotonic word boundary clamping when repeatedly clicking step-later beyond word end', async () => {
      const user = userEvent.setup();
      const onSaveLines = vi.fn();

      render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={onSaveLines}
        />
      );

      // Expand line 1
      await user.click(screen.getByRole('button', { name: /expand word timings for line 1/i }));

      // Word 0 ('Is') has start 1.0, end 1.4. Next word ('this') has start 1.4.
      // Click nudge start of word 'Is' later (+0.05s) 20 times.
      const stepStartLater = screen.getAllByRole('button', {
        name: /nudge start of word Is 0\.05s later/i,
      })[0];
      for (let i = 0; i < 20; i++) {
        await user.click(stepStartLater);
      }

      // Start time of word 'Is' MUST NOT exceed min(end_time, nextWordStart) = 1.4s!
      const timeInput = screen.getAllByLabelText(/start time for word Is/i)[0] as HTMLInputElement;
      expect(parseFloat(timeInput.value)).toBeLessThanOrEqual(1.4);
    });
  });

  describe('Focus Area 3: AudioControls Transport & Touch Targets', () => {
    const audioProps = {
      projectId: 'proj-m2',
      masterAudioUrl: '/media/audio.mp3',
      currentTime: 30,
      duration: 180,
      isPlaying: false,
      onTogglePlay: vi.fn(),
      onSeek: vi.fn(),
      onMixChange: vi.fn(),
    };

    it('ensures transport buttons (restart, play/pause, mute, pitch) satisfy >=44px hit targets', () => {
      render(<AudioControls {...audioProps} />);

      // Play/Pause button
      const playBtn = screen.getByRole('button', { name: /start playback/i });
      expect(playBtn).toHaveClass('w-12', 'h-12'); // 48px x 48px >= 44px

      // Restart button
      const restartBtn = screen.getByRole('button', { name: /restart track from beginning/i });
      expect(restartBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');

      // Mute toggle button
      const muteBtn = screen.getByRole('button', { name: /mute audio/i });
      expect(muteBtn).toHaveClass('min-h-[44px]', 'min-w-[44px]');

      // Pitch shift buttons: -1, Reset, +1
      const pitchDown = screen.getByRole('button', { name: /decrease pitch by one semitone/i });
      const pitchReset = screen.getByRole('button', { name: /reset pitch to original key/i });
      const pitchUp = screen.getByRole('button', { name: /increase pitch by one semitone/i });

      expect(pitchDown).toHaveClass('min-h-[44px]');
      expect(pitchReset).toHaveClass('min-h-[44px]');
      expect(pitchUp).toHaveClass('min-h-[44px]');
    });

    it('configures timeline scrubber with touch-none to prevent vertical scrolling capture', () => {
      render(<AudioControls {...audioProps} />);

      const scrubber = screen.getByRole('slider', { name: /audio timeline position/i });
      expect(scrubber).toBeInTheDocument();
      expect(scrubber).toHaveClass('touch-none');
      expect(scrubber).toHaveClass('py-2');
    });

    it('wraps bottom action controls cleanly on mobile viewports with min-h-[44px] full-width buttons', () => {
      render(
        <div style={{ width: '320px' }}>
          <AudioControls {...audioProps} />
        </div>
      );

      const applyMixBtn = screen.getByRole('button', { name: /apply audio mix settings/i });
      const replaceInstBtn = screen.getByRole('button', { name: /replace instrumental file/i });

      expect(applyMixBtn).toHaveClass('min-h-[44px]', 'w-full', 'sm:w-auto');
      expect(replaceInstBtn).toHaveClass('min-h-[44px]', 'w-full', 'sm:w-auto');

      // Containers must stack vertically on mobile
      const leftCol = applyMixBtn.closest('div');
      expect(leftCol).toHaveClass('flex', 'flex-col', 'sm:flex-row', 'w-full', 'sm:w-auto');
    });
  });

  describe('Focus Area 4: Dynamic Lyric Preview (16:9 vs 9:16 Shorts)', () => {
    it('switches LyricDisplay aspect ratio between aspect-video and aspect-[9/16] max-w-xs', () => {
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={2.5} aspectRatio="16:9" />
      );

      const stage16_9 = screen.getByTestId('lyric-display-stage');
      expect(stage16_9).toHaveClass('aspect-video', 'w-full');
      expect(stage16_9).not.toHaveClass('aspect-[9/16]');

      // Switch to 9:16
      rerender(<LyricDisplay lines={sampleLines} currentTime={2.5} aspectRatio="9:16" />);
      const stage9_16 = screen.getByTestId('lyric-display-stage');
      expect(stage9_16).toHaveClass('aspect-[9/16]', 'max-w-xs', 'mx-auto');
      expect(stage9_16).not.toHaveClass('aspect-video');
    });

    it('wraps active lyric text without clipping or colliding with the Live Preview badge', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={2.5} aspectRatio="9:16" />);

      // Live Badge is positioned top-2.5 left-2.5
      const liveBadge = screen.getByText(/live visual preview/i).closest('div');
      expect(liveBadge).toHaveClass('absolute', 'top-2.5', 'left-2.5');

      // Active lyrics line has flex-wrap and responsive typography
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveClass('flex', 'flex-wrap', 'justify-center');
      expect(activeLine).toHaveClass('text-xl', 'sm:text-3xl', 'md:text-5xl');

      // The lyrics stage uses flex flex-col justify-end so text stays anchored cleanly at bottom
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveClass('flex', 'flex-col', 'justify-end');
    });

    it('interactively toggles aspect ratio via VisualThemePicker controls', async () => {
      const user = userEvent.setup();
      const onChangeAspectRatio = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={THEMES[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={onChangeAspectRatio}
          onCustomBgUploaded={vi.fn()}
        />
      );

      const shortsBtn = screen.getByRole('button', { name: /9:16 shorts/i });
      const widescreenBtn = screen.getByRole('button', { name: /16:9 widescreen/i });

      // Hit targets >= 40px
      expect(shortsBtn).toHaveClass('min-h-[40px]');
      expect(widescreenBtn).toHaveClass('min-h-[40px]');

      // Click 9:16 Shorts
      await user.click(shortsBtn);
      expect(onChangeAspectRatio).toHaveBeenCalledWith('9:16');

      // Click 16:9 Widescreen
      await user.click(widescreenBtn);
      expect(onChangeAspectRatio).toHaveBeenCalledWith('16:9');
    });
  });

  describe('Focus Area 5: Studio Dashboard Integration in App.tsx', () => {
    const mockReadyProject: ProjectState = {
      id: 'mock-proj-1',
      title: 'Bohemian Rhapsody (Epic 1080p Remaster)',
      artist: 'Queen',
      status: 'ready',
      progress: 100,
      status_detail: 'Completed',
      thumbnail_url: 'https://example.com/bohemian.jpg',
      master_audio_url: '/media/master.mp3',
      instrumental_url: '/media/inst.mp3',
      vocals_url: '/media/vocals.mp3',
      semitones: 0,
      guide_volume: 0.2,
      lines: sampleLines,
    };

    it('forwards aspect ratio selection from VisualThemePicker into LyricDisplay in App studio state', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=mock-proj-1');

      // Mock auth status and projects
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/mock-proj-1')) {
          return new Response(JSON.stringify(mockReadyProject), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      // Render App directly with project in URL
      render(<App />);

      // Studio view should now be loaded with project title
      expect(
        await screen.findByText('Bohemian Rhapsody (Epic 1080p Remaster)')
      ).toBeInTheDocument();

      // Initial aspect ratio is 16:9 widescreen
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveClass('aspect-video');

      // Click 9:16 Shorts button in VisualThemePicker
      const shortsToggle = screen.getByRole('button', { name: /9:16 shorts/i });
      await user.click(shortsToggle);

      // Stage must now switch to 9:16 Shorts
      expect(stage).toHaveClass('aspect-[9/16]', 'max-w-xs');

      // Click back to 16:9 Widescreen
      const widescreenToggle = screen.getByRole('button', { name: /16:9 widescreen/i });
      await user.click(widescreenToggle);
      expect(stage).toHaveClass('aspect-video');
    });

    it('renders responsive song meta header with line-clamping and full-width Render Video button on mobile', async () => {
      window.history.pushState({}, '', '/?project=mock-proj-1');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/mock-proj-1')) {
          return new Response(JSON.stringify(mockReadyProject), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(
        <div style={{ width: '320px' }}>
          <App />
        </div>
      );

      // Render 1080p Video button
      const renderBtn = await screen.findByRole('button', { name: /render 1080p video/i });
      expect(renderBtn).toBeInTheDocument();
      expect(renderBtn).toHaveClass('min-h-[44px]', 'w-full', 'sm:w-auto');

      // Title header
      const titleHeader = screen.getByText('Bohemian Rhapsody (Epic 1080p Remaster)');
      expect(titleHeader).toHaveClass('break-words', 'line-clamp-2', 'sm:line-clamp-none');
    });
  });

  describe('Focus Area 6: Adversarial Stress & Edge Case Harness', () => {
    it('handles 300-character unbroken string in line item at 320px without layout distortion', () => {
      const ultraLongUnbroken = 'A'.repeat(300);
      const testLines: LyricLine[] = [
        {
          id: 99,
          text: ultraLongUnbroken,
          start_time: 1.0,
          end_time: 2.0,
          words: [{ word: ultraLongUnbroken, start_time: 1.0, end_time: 2.0 }],
        },
      ];

      render(
        <div style={{ width: '320px' }}>
          <LyricTimelineEditor
            lines={testLines}
            currentTime={1.5}
            duration={60}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        </div>
      );

      const lineCard = screen.getByTestId('timeline-line-99');
      expect(lineCard).toBeInTheDocument();

      // The button text must have truncate, min-w-0, flex-1
      const textSpan = within(lineCard).getAllByText(ultraLongUnbroken)[0];
      expect(textSpan).toHaveClass('truncate', 'min-w-0', 'flex-1');
    });

    it('enforces strict [-12, +12] pitch bounds when subjected to 25 consecutive shift clicks', async () => {
      const user = userEvent.setup();
      render(
        <AudioControls
          projectId="test-pitch-stress"
          currentTime={0}
          duration={100}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onMixChange={vi.fn()}
        />
      );

      const pitchUp = screen.getByRole('button', { name: /increase pitch by one semitone/i });
      const pitchDown = screen.getByRole('button', { name: /decrease pitch by one semitone/i });

      // Click +1 25 times
      for (let i = 0; i < 25; i++) {
        await user.click(pitchUp);
      }
      expect(screen.getByText('+12 semitones')).toBeInTheDocument();

      // Click -1 35 times -> reaches -12 bound
      for (let i = 0; i < 35; i++) {
        await user.click(pitchDown);
      }
      expect(screen.getByText('-12 semitones')).toBeInTheDocument();

      // Click Reset -> 0 (Original)
      const pitchReset = screen.getByRole('button', { name: /reset pitch to original key/i });
      await user.click(pitchReset);
      expect(screen.getByText('0 (Original)')).toBeInTheDocument();
    });

    it('renders 0-duration line and empty words array without division by zero or NaN', () => {
      const zeroDurationLines: LyricLine[] = [
        {
          id: 1,
          text: 'Zero duration line',
          start_time: 5.0,
          end_time: 5.0,
          words: [],
        },
      ];

      const { container } = render(
        <LyricDisplay lines={zeroDurationLines} currentTime={5.0} aspectRatio="9:16" />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toBeInTheDocument();
      // Should not throw and should render without crashing
      expect(container).toBeInTheDocument();
    });

    it('wraps 50 words in a single line in 9:16 vertical view cleanly without clipping', () => {
      const words50 = Array.from({ length: 50 }, (_, i) => ({
        word: `w${i}`,
        start_time: 1.0 + i * 0.1,
        end_time: 1.1 + i * 0.1,
      }));
      const longLines: LyricLine[] = [
        {
          id: 1,
          text: words50.map((w) => w.word).join(' '),
          start_time: 1.0,
          end_time: 6.0,
          words: words50,
        },
      ];

      render(<LyricDisplay lines={longLines} currentTime={3.0} aspectRatio="9:16" />);

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveClass('flex', 'flex-wrap');
      const wordButtons = within(activeLine).getAllByRole('button');
      expect(wordButtons.length).toBe(50);
    });
  });
});
