import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MASTER_VOLUME_STORAGE_KEY, MASTER_MUTED_STORAGE_KEY } from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { LyricDisplay } from '../components/LyricDisplay';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { LyricLine } from '../types';

describe('M5 Challenger 2 Adversarial Suite: Features 42, 43, & 44', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // =========================================================================
  // Feature 42: Master Volume & Mute Controls (TransportDock)
  // =========================================================================
  describe('Feature 42: Master Volume & Mute Controls Adversarial Challenges', () => {
    const baseAudioProps = {
      masterAudioUrl: '/media/adv-audio.wav',
      currentTime: 12.0,
      duration: 180.0,
      isPlaying: false,
      onTogglePlay: vi.fn(),
      onSeek: vi.fn(),
    };

    it('clamps volume slider to [0.0, 1.0] when out-of-bounds or invalid values are injected', () => {
      const onVolumeChange = vi.fn();
      render(<TransportDock {...baseAudioProps} onVolumeChange={onVolumeChange} />);

      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // Negative value -> clamped to 0.0
      fireEvent.change(slider, { target: { value: '-0.75' } });
      expect(slider.value).toBe('0');
      expect(audioEl.volume).toBe(0);
      expect(screen.getByText('Muted')).toBeInTheDocument();
      expect(onVolumeChange).toHaveBeenLastCalledWith(0);

      // Value greater than 1.0 -> clamped to 1.0
      fireEvent.change(slider, { target: { value: '2.5' } });
      expect(slider.value).toBe('1');
      expect(audioEl.volume).toBe(1);
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
      expect(onVolumeChange).toHaveBeenLastCalledWith(1);
    });

    it('falls back safely to default 1.0 or clamps when initialVolume is NaN or out-of-bounds', () => {
      const { unmount } = render(<TransportDock {...baseAudioProps} initialVolume={NaN} />);
      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      expect(slider.value).toBe('1');
      unmount();

      render(<TransportDock {...baseAudioProps} initialVolume={-5} />);
      const sliderClampedLow = screen.getByRole('slider', {
        name: /master volume/i,
      }) as HTMLInputElement;
      expect(sliderClampedLow.value).toBe('0');
    });

    it('correctly handles volume boundary extremes (exact 0.0, 0.5, 1.0) and percentage display', () => {
      render(<TransportDock {...baseAudioProps} initialVolume={0.0} />);

      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // Exact 0.0: Muted badge and 0 volume
      expect(slider.value).toBe('0');
      expect(audioEl.volume).toBe(0);
      expect(screen.getByText('Muted')).toBeInTheDocument();

      // Exact 0.5: 50%
      fireEvent.change(slider, { target: { value: '0.5' } });
      expect(slider.value).toBe('0.5');
      expect(audioEl.volume).toBe(0.5);
      expect(screen.getAllByText('50%').length).toBeGreaterThanOrEqual(1);

      // Fractional round check: 0.334 -> 33%
      fireEvent.change(slider, { target: { value: '0.334' } });
      expect(screen.getByText('33%')).toBeInTheDocument();

      // Exact 1.0: 100%
      fireEvent.change(slider, { target: { value: '1.0' } });
      expect(slider.value).toBe('1');
      expect(audioEl.volume).toBe(1);
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
    });

    it('smart unmute: unmuting from volume 0 restores default 1.0; unmuting from non-zero restores exact previous level', async () => {
      const user = userEvent.setup();
      const onVolumeChange = vi.fn();
      const onMuteChange = vi.fn();

      // Case A: Initial volume is non-zero (0.42). Mute -> Unmute restores 0.42.
      const { unmount } = render(
        <TransportDock
          {...baseAudioProps}
          initialVolume={0.42}
          onVolumeChange={onVolumeChange}
          onMuteChange={onMuteChange}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      const muteBtn = screen.getByRole('button', { name: /mute audio/i });

      await user.click(muteBtn);
      expect(audioEl.muted).toBe(true);
      expect(screen.getByText('Muted')).toBeInTheDocument();
      expect(onMuteChange).toHaveBeenCalledWith(true);

      const unmuteBtn = screen.getByRole('button', { name: /unmute audio/i });
      await user.click(unmuteBtn);
      expect(audioEl.muted).toBe(false);
      expect(audioEl.volume).toBe(0.42);
      expect(screen.getByText('42%')).toBeInTheDocument();
      expect(onVolumeChange).toHaveBeenCalledWith(0.42);
      expect(onMuteChange).toHaveBeenCalledWith(false);

      unmount();
      vi.clearAllMocks();

      // Case B: Initial volume is 0.0. Unmuting from 0 must restore sensible fallback 1.0.
      render(
        <TransportDock
          {...baseAudioProps}
          initialVolume={0.0}
          onVolumeChange={onVolumeChange}
          onMuteChange={onMuteChange}
        />
      );

      const audioElZero = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(screen.getByText('Muted')).toBeInTheDocument();

      const unmuteFromZeroBtn = screen.getByRole('button', { name: /unmute audio/i });
      await user.click(unmuteFromZeroBtn);

      expect(audioElZero.muted).toBe(false);
      expect(audioElZero.volume).toBe(1.0);
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
      expect(onVolumeChange).toHaveBeenCalledWith(1.0);
      expect(onMuteChange).toHaveBeenCalledWith(false);
    });

    it('preserves last non-zero volume when volume slider is dragged to 0 then unmuted', async () => {
      const user = userEvent.setup();
      const onVolumeChange = vi.fn();
      render(
        <TransportDock {...baseAudioProps} initialVolume={0.65} onVolumeChange={onVolumeChange} />
      );

      const slider = screen.getByRole('slider', { name: /master volume/i });
      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // Drag slider down to 0
      fireEvent.change(slider, { target: { value: '0' } });
      expect(screen.getByText('Muted')).toBeInTheDocument();
      expect(audioEl.volume).toBe(0);

      // Clicking unmute button should restore 0.65 (not 0 or 1.0)
      const unmuteBtn = screen.getByRole('button', { name: /unmute audio/i });
      await user.click(unmuteBtn);

      expect(audioEl.volume).toBe(0.65);
      expect(screen.getByText('65%')).toBeInTheDocument();
      expect(onVolumeChange).toHaveBeenCalledWith(0.65);
    });

    it('auto-unmutes when adjusting volume slider up while muted, but stays muted if dragged to 0', () => {
      const onMuteChange = vi.fn();
      render(
        <TransportDock
          {...baseAudioProps}
          initialVolume={0.5}
          initialMuted={true}
          onMuteChange={onMuteChange}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      const slider = screen.getByRole('slider', { name: /master volume/i });
      expect(audioEl.muted).toBe(true);

      // Dragging slider to 0 while muted should NOT unmute
      fireEvent.change(slider, { target: { value: '0' } });
      expect(audioEl.muted).toBe(true);
      expect(onMuteChange).not.toHaveBeenCalledWith(false);

      // Dragging slider up to 0.75 MUST auto-unmute
      fireEvent.change(slider, { target: { value: '0.75' } });
      expect(audioEl.muted).toBe(false);
      expect(audioEl.volume).toBe(0.75);
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(onMuteChange).toHaveBeenCalledWith(false);
    });

    it('synchronizes bidirectional state when external audioRef is provided', () => {
      const externalAudioRef = { current: document.createElement('audio') };
      render(<TransportDock {...baseAudioProps} audioRef={externalAudioRef} initialVolume={0.3} />);

      // External ref volume should have been set to 0.3
      expect(externalAudioRef.current.volume).toBe(0.3);
      expect(externalAudioRef.current.muted).toBe(false);

      const slider = screen.getByRole('slider', { name: /master volume/i });
      fireEvent.change(slider, { target: { value: '0.8' } });

      expect(externalAudioRef.current.volume).toBe(0.8);
    });

    it('falls back safely to default 1.0 and unmuted when localStorage contains corrupted data', () => {
      // Test corrupted volume entries
      const corruptedVolumes = ['NaN', '-0.5', '1.5', 'garbage_string', 'undefined', '{}'];

      corruptedVolumes.forEach((badVal) => {
        localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, badVal);
        const { unmount } = render(<TransportDock {...baseAudioProps} />);
        const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
        expect(slider.value).toBe('1');
        expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
        unmount();
      });

      // Test corrupted muted entries (anything not exactly 'true' is treated as false)
      localStorage.setItem(MASTER_MUTED_STORAGE_KEY, 'yes');
      const { unmount: unmountMuted } = render(<TransportDock {...baseAudioProps} />);
      expect(screen.getByRole('button', { name: /mute audio/i })).toBeInTheDocument();
      unmountMuted();
    });

    it('handles localStorage SecurityError/QuotaExceededError exceptions gracefully without throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Storage access denied', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      // Component should render without throwing
      expect(() => {
        render(<TransportDock {...baseAudioProps} />);
      }).not.toThrow();

      const slider = screen.getByRole('slider', { name: /master volume/i });
      // Slider interaction should not crash despite storage write exception
      expect(() => {
        fireEvent.change(slider, { target: { value: '0.5' } });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Feature 43: Fluid Word Sweep Interpolation (useInterpolatedTime.ts & LyricDisplay.tsx)
  // =========================================================================
  describe('Feature 43: Fluid Word Sweep Interpolation Adversarial Challenges', () => {
    const sampleLines: LyricLine[] = [
      {
        id: 10,
        text: 'Sing with passion',
        start_time: 2.0,
        end_time: 5.0,
        words: [
          { word: 'Sing', start_time: 2.0, end_time: 3.0 },
          { word: 'with', start_time: 3.0, end_time: 3.5 },
          { word: 'passion', start_time: 3.5, end_time: 5.0 },
        ],
      },
      {
        id: 20,
        text: 'Feel the rhythm',
        start_time: 7.0,
        end_time: 10.0,
        words: [
          { word: 'Feel', start_time: 7.0, end_time: 8.0 },
          { word: 'the', start_time: 8.0, end_time: 8.5 },
          { word: 'rhythm', start_time: 8.5, end_time: 10.0 },
        ],
      },
    ];

    it('accurately calculates clipPath and width progression across sub-frame time intervals', () => {
      // At t = 2.0 (start of 'Sing' [2.0 - 3.0]): progress = 0%
      const { rerender } = render(<LyricDisplay lines={sampleLines} currentTime={2.0} />);
      const singWord = screen.getByTestId('word-sung-0');
      expect(parseFloat(singWord.style.width)).toBe(0);
      expect(singWord.style.clipPath).toBe('inset(0 100.00% 0 0)');

      // At t = 2.5 (50% through 'Sing'): progress = 50%
      rerender(<LyricDisplay lines={sampleLines} currentTime={2.5} />);
      expect(parseFloat(singWord.style.width)).toBe(50);
      expect(singWord.style.clipPath).toBe('inset(0 50.00% 0 0)');

      // At t = 3.0 ('Sing' complete, start of 'with'): 'Sing' is 100%
      rerender(<LyricDisplay lines={sampleLines} currentTime={3.0} />);
      expect(parseFloat(singWord.style.width)).toBe(100);
      expect(singWord.style.clipPath).toBe('inset(0 0.00% 0 0)');

      // At t = 3.25 (50% through 'with' [3.0 - 3.5]): 'with' is 50%
      const withWord = screen.getByTestId('word-sung-1');
      rerender(<LyricDisplay lines={sampleLines} currentTime={3.25} />);
      expect(parseFloat(withWord.style.width)).toBe(50);
      expect(withWord.style.clipPath).toBe('inset(0 50.00% 0 0)');
    });

    it('zero-drift guarantee: re-anchors immediately when currentTime prop updates (seeking, loop, discrete updates)', () => {
      let nowVal = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => nowVal);

      let rafCallback: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb;
        return 999;
      });

      const { result, rerender } = renderHook(
        ({ time, playing }) => useInterpolatedTime({ currentTime: time, isPlaying: playing }),
        { initialProps: { time: 10.0, playing: true } }
      );

      expect(result.current).toBe(10.0);

      // Advance clock by 100ms
      nowVal += 100;
      act(() => {
        if (rafCallback) rafCallback(nowVal);
      });
      expect(result.current).toBeCloseTo(10.1, 2);

      // Discrete seek backward (e.g. loop or seek to 2.0s)
      rerender({ time: 2.0, playing: true });
      expect(result.current).toBe(2.0);

      // Seek forward to 50.0s
      rerender({ time: 50.0, playing: true });
      expect(result.current).toBe(50.0);
    });

    it('scales extrapolation proportional to playbackRate (0.5x, 1.5x, 2.0x)', () => {
      let nowVal = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => nowVal);

      let rafCallback: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb;
        return 888;
      });

      // 2.0x playback rate: 100ms elapsed should advance time by 200ms
      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 5.0, isPlaying: true, playbackRate: 2.0 })
      );

      nowVal += 100;
      act(() => {
        if (rafCallback) rafCallback(nowVal);
      });

      expect(result.current).toBeCloseTo(5.2, 2);
    });

    it('clamps maximum extrapolation delta to 350ms during audio stall or network freeze', () => {
      let nowVal = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => nowVal);

      let rafCallback: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallback = cb;
        return 777;
      });

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 5.0, isPlaying: true, playbackRate: 1.0 })
      );

      // Simulate a 2.5 second audio playback stall/lag
      nowVal += 2500;
      act(() => {
        if (rafCallback) rafCallback(nowVal);
      });

      // Delta should be clamped to at most 0.35s (5.35s total), preventing runaway desync
      expect(result.current).toBeCloseTo(5.35, 2);
    });

    it('cancels rAF loop and stops CPU consumption when paused or unmounted', () => {
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
      const { rerender, unmount } = renderHook(
        ({ playing }) => useInterpolatedTime({ currentTime: 1.0, isPlaying: playing }),
        { initialProps: { playing: true } }
      );

      // Pausing playback cancels rAF
      rerender({ playing: false });
      expect(cancelSpy).toHaveBeenCalled();

      // Resuming and then unmounting also cancels rAF
      cancelSpy.mockClear();
      rerender({ playing: true });
      unmount();
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('robustly handles edge cases: song end, zero duration words, and empty lyric lines', () => {
      // Edge Case A: Word with start_time === end_time (duration 0)
      const zeroDurationLine: LyricLine[] = [
        {
          id: 1,
          text: 'Glitch word',
          start_time: 1.0,
          end_time: 2.0,
          words: [{ word: 'Glitch', start_time: 1.5, end_time: 1.5 }],
        },
      ];

      const { unmount: unmountA } = render(
        <LyricDisplay lines={zeroDurationLine} currentTime={1.5} />
      );

      const glitchWord = screen.getByTestId('word-sung-0');
      // When dur <= 0, word progress returns 100% cleanly without NaN or division by zero
      expect(parseFloat(glitchWord.style.width)).toBe(100);
      expect(glitchWord.style.clipPath).toBe('inset(0 0.00% 0 0)');
      unmountA();

      // Edge Case B: Empty lyric lines array
      const { unmount: unmountB } = render(<LyricDisplay lines={[]} currentTime={5.0} />);
      expect(screen.getByText('♪ Instrumental Break ♪')).toBeInTheDocument();
      unmountB();

      // Edge Case C: On last lyric line, nextLine is null and displays '-- End of song --'
      render(<LyricDisplay lines={sampleLines} currentTime={8.0} />);
      expect(screen.getByText('-- End of song --')).toBeInTheDocument();
    });

    it('renders 3-2-1 countdown cue cues accurately within 3.0 seconds before line start', () => {
      // Line starts at 2.0s; at t = 0.5s, countdown should indicate 2 seconds remaining
      render(<LyricDisplay lines={sampleLines} currentTime={0.5} />);
      const cue = screen.getByTestId('countdown-cue');
      expect(cue).toBeInTheDocument();
      expect(cue).toHaveAttribute('aria-label', 'Starting in 2 seconds');
    });
  });

  // =========================================================================
  // Feature 44: Timeline Precision Nudging & Invariants (LyricTimelineEditor.tsx)
  // =========================================================================
  describe('Feature 44: Timeline Precision Nudging Adversarial Challenges', () => {
    const precisionLines: LyricLine[] = [
      {
        id: 101,
        text: 'We will rock you',
        start_time: 4.0,
        end_time: 7.0,
        words: [
          { word: 'We', start_time: 4.0, end_time: 4.6 },
          { word: 'will', start_time: 4.6, end_time: 5.2 },
          { word: 'rock', start_time: 5.2, end_time: 6.0 },
          { word: 'you', start_time: 6.0, end_time: 7.0 },
        ],
      },
      {
        id: 102,
        text: 'Singing rock you',
        start_time: 8.0,
        end_time: 11.0,
        words: [
          { word: 'Singing', start_time: 8.0, end_time: 9.0 },
          { word: 'rock', start_time: 9.0, end_time: 10.0 },
          { word: 'you', start_time: 10.0, end_time: 11.0 },
        ],
      },
    ];

    const editorBaseProps = {
      lines: precisionLines,
      currentTime: 0.0,
      duration: 120.0,
      onSeek: vi.fn(),
      onSaveLines: vi.fn(),
    };

    it('executes coarse (+/-0.2s) and fine (+/-0.05s) line-level nudging with floating-point precision', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...editorBaseProps} />);

      // Line 101 starts at 4.0s - 7.0s
      expect(screen.getByText(/4.0s - 7.0s/i)).toBeInTheDocument();

      // Coarse earlier: -0.2s -> 3.8s - 6.8s
      const coarseEarlierBtn = screen.getByRole('button', {
        name: /nudge line 101 0.2s earlier/i,
      });
      await user.click(coarseEarlierBtn);
      expect(screen.getByText(/3.8s - 6.8s/i)).toBeInTheDocument();

      // Fine later: +0.05s -> 3.85s - 6.85s
      const fineLaterBtn = screen.getByRole('button', {
        name: /nudge line 101 0.05s later/i,
      });
      await user.click(fineLaterBtn);
      expect(screen.getByText(/3.85s - 6.85s/i)).toBeInTheDocument();

      // Fine earlier: -0.05s -> 3.8s - 6.8s
      const fineEarlierBtn = screen.getByRole('button', {
        name: /nudge line 101 0.05s earlier/i,
      });
      await user.click(fineEarlierBtn);
      expect(screen.getByText(/3.8s - 6.8s/i)).toBeInTheDocument();

      // Coarse later: +0.2s -> 4.0s - 7.0s (restoring baseline, clears dirty state)
      const coarseLaterBtn = screen.getByRole('button', {
        name: /nudge line 101 0.2s later/i,
      });
      await user.click(coarseLaterBtn);
      expect(screen.getByText(/4.0s - 7.0s/i)).toBeInTheDocument();
      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
    });

    it('enforces non-negative bounds (t >= 0) when nudging lines close to 0.0s', async () => {
      const user = userEvent.setup();
      const nearZeroLine: LyricLine[] = [
        {
          id: 501,
          text: 'Intro chant',
          start_time: 0.1,
          end_time: 1.5,
          words: [{ word: 'Intro', start_time: 0.1, end_time: 1.0 }],
        },
      ];
      render(<LyricTimelineEditor {...editorBaseProps} lines={nearZeroLine} />);

      // Nudge coarse earlier (-0.2s) when start is 0.1s
      const coarseEarlierBtn = screen.getByRole('button', {
        name: /nudge line 501 0.2s earlier/i,
      });
      await user.click(coarseEarlierBtn);

      // Start must clamp strictly at 0.0s and never become negative (-0.1s)
      expect(screen.getByText(/0.0s -/i)).toBeInTheDocument();
    });

    it('precision nudges individual word boundaries with steppers and updates line bounds dynamically', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...editorBaseProps} />);

      // Expand line 101
      const expandBtn = screen.getByRole('button', {
        name: /expand word timings for line 101/i,
      });
      await user.click(expandBtn);

      // Word 'We' start is 4.0, end is 4.6. Nudge start +0.05s -> 4.05
      const nudgeStartLater = screen.getByRole('button', {
        name: /nudge start of word We 0.05s later/i,
      });
      await user.click(nudgeStartLater);

      const inputs = screen.getAllByRole('spinbutton');
      expect(inputs[0]).toHaveValue(4.05);

      // Line start dynamically adapts to min word start: 4.05s
      expect(screen.getByText(/4.05s - 7.0s/i)).toBeInTheDocument();

      // Word 'you' (last word) end is 7.0. Nudge end +0.05s -> 7.05
      const nudgeEndLater = screen.getByRole('button', {
        name: /nudge end of word you 0.05s later/i,
      });
      await user.click(nudgeEndLater);

      // Line end dynamically adapts to max word end: 7.05s
      expect(screen.getByText(/4.05s - 7.05s/i)).toBeInTheDocument();
    });

    it('strictly enforces sequence monotonicity: word start cannot exceed word end or adjacent word boundaries', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...editorBaseProps} />);

      const expandBtn = screen.getByRole('button', {
        name: /expand word timings for line 101/i,
      });
      await user.click(expandBtn);

      // In line 101: 'We' [4.0, 4.6], 'will' [4.6, 5.2]
      // Try to nudge 'will' start earlier than 'We' start (4.0) repeatedly
      const nudgeWillStartEarlier = screen.getByRole('button', {
        name: /nudge start of word will 0.05s earlier/i,
      });

      // Click 20 times (-1.0s)
      for (let i = 0; i < 20; i++) {
        await user.click(nudgeWillStartEarlier);
      }

      // 'will' start cannot drop below previous word start ('We' at 4.0)
      const inputs = screen.getAllByRole('spinbutton');
      // inputs: [We.start, We.end, will.start, will.end, ...]
      const willStartVal = parseFloat(inputs[2].getAttribute('value') || '0');
      expect(willStartVal).toBeGreaterThanOrEqual(4.0);

      // Try to nudge 'will' start past 'will' end (5.2) repeatedly
      const nudgeWillStartLater = screen.getByRole('button', {
        name: /nudge start of word will 0.05s later/i,
      });

      for (let i = 0; i < 30; i++) {
        await user.click(nudgeWillStartLater);
      }

      const updatedWillStartVal = parseFloat(inputs[2].getAttribute('value') || '0');
      expect(updatedWillStartVal).toBeLessThanOrEqual(5.2);
    });

    it('shifts entire word timing maintaining exact word duration', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...editorBaseProps} />);

      const expandBtn = screen.getByRole('button', {
        name: /expand word timings for line 101/i,
      });
      await user.click(expandBtn);

      // Word 'rock' has start: 5.2, end: 6.0 (duration: 0.8s)
      const shiftRockLaterBtn = screen.getByRole('button', {
        name: /nudge word rock 0.05s later/i,
      });
      await user.click(shiftRockLaterBtn);

      const inputs = screen.getAllByRole('spinbutton');
      // 'rock' is index 2 (inputs[4] is rock.start, inputs[5] is rock.end)
      expect(inputs[4]).toHaveValue(5.25);
      expect(inputs[5]).toHaveValue(6.05);

      // Duration remains exactly 0.8s (6.05 - 5.25 = 0.8)
      const rockDur = parseFloat(
        (
          parseFloat(inputs[5].getAttribute('value') || '0') -
          parseFloat(inputs[4].getAttribute('value') || '0')
        ).toFixed(3)
      );
      expect(rockDur).toBe(0.8);
    });

    it('dirty tracking: toggles hasUnsavedChanges on nudge and resets when reverted or discarded', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      render(<LyricTimelineEditor {...editorBaseProps} onDirtyChange={onDirtyChange} />);

      // Initially clean
      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();

      // Nudge line earlier -> becomes dirty
      const fineEarlierBtn = screen.getByRole('button', {
        name: /nudge line 101 0.05s earlier/i,
      });
      await user.click(fineEarlierBtn);

      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenCalledWith(true);

      // Discard changes via confirmation modal
      const discardBtn = screen.getByRole('button', { name: /discard changes/i });
      await user.click(discardBtn);

      const modal = screen.getByRole('dialog');
      const confirmDiscardBtn = within(modal).getByRole('button', { name: /discard changes/i });
      await user.click(confirmDiscardBtn);

      // Resets to initial lines and clean state
      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
      expect(screen.getByText(/4.0s - 7.0s/i)).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
  });
});
