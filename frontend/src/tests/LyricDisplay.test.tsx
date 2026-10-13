import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../components/LyricDisplay';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { LyricLine } from '../types';
import { renderHook } from '@testing-library/react';

describe('LyricDisplay (Feature 43: Fluid Word Sweep Interpolation)', () => {
  const mockLines: LyricLine[] = [
    {
      id: 1,
      text: 'Hello world',
      start_time: 4.0,
      end_time: 6.0,
      words: [
        { word: 'Hello', start_time: 4.0, end_time: 5.0 },
        { word: 'world', start_time: 5.0, end_time: 6.0 },
      ],
    },
    {
      id: 2,
      text: 'Next line begins',
      start_time: 8.0,
      end_time: 11.0,
      words: [
        { word: 'Next', start_time: 8.0, end_time: 9.0 },
        { word: 'line', start_time: 9.0, end_time: 10.0 },
        { word: 'begins', start_time: 10.0, end_time: 11.0 },
      ],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders instrumental intro before first lyric line', () => {
    render(<LyricDisplay lines={mockLines} currentTime={0.0} />);
    expect(screen.getByText('♪ Instrumental Intro ♪')).toBeInTheDocument();
  });

  it('renders active line words and next upcoming line', () => {
    render(<LyricDisplay lines={mockLines} currentTime={4.5} />);
    expect(screen.getAllByText('Hello').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('world').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Next line begins')).toBeInTheDocument();
  });

  it('triggers onSeek when clicking on a word', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<LyricDisplay lines={mockLines} currentTime={4.5} onSeek={onSeek} />);

    const wordBtn = screen.getByRole('button', { name: /jump playback to word Hello/i });
    await user.click(wordBtn);
    expect(onSeek).toHaveBeenCalledWith(4.0);
  });

  it('displays countdown dots when within 3 seconds of active line', () => {
    render(<LyricDisplay lines={mockLines} currentTime={2.5} />);
    const countdown = screen.getByTestId('countdown-cue');
    expect(countdown).toBeInTheDocument();
    expect(countdown).toHaveAttribute('aria-label', expect.stringContaining('Starting in'));
  });

  it('renders blurred album art background when albumArtUrl is provided', () => {
    render(
      <LyricDisplay lines={mockLines} currentTime={4.5} albumArtUrl="https://example.com/art.jpg" />
    );
    const albumArt = screen.getByTestId('stage-album-art');
    expect(albumArt).toBeInTheDocument();
    expect(albumArt.style.backgroundImage).toContain('https://example.com/art.jpg');
  });

  it('does not leak requestAnimationFrame when paused or unmounted', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount, rerender } = render(
      <LyricDisplay lines={mockLines} currentTime={4.0} isPlaying={true} />
    );
    // Pausing cancels active rAF loop
    rerender(<LyricDisplay lines={mockLines} currentTime={4.0} isPlaying={false} />);
    expect(cancelSpy).toHaveBeenCalled();

    // Unmounting during active playback also cancels rAF loop
    rerender(<LyricDisplay lines={mockLines} currentTime={4.0} isPlaying={true} />);
    cancelSpy.mockClear();
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('sub-frame interpolates time smoothly during active playback', () => {
    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 123;
    });

    render(<LyricDisplay lines={mockLines} currentTime={4.2} isPlaying={true} />);

    expect(window.requestAnimationFrame).toHaveBeenCalled();
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 100);
    act(() => {
      if (rafCallback) rafCallback(performance.now());
    });
    perfSpy.mockRestore();
  });

  describe('useInterpolatedTime hook unit tests', () => {
    it('returns exact currentTime when isPlaying is false', () => {
      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 15.5, isPlaying: false })
      );
      expect(result.current).toBe(15.5);
    });

    it('immediately updates when external currentTime prop changes', () => {
      const { result, rerender } = renderHook(
        ({ time }) => useInterpolatedTime({ currentTime: time, isPlaying: false }),
        { initialProps: { time: 5.0 } }
      );
      expect(result.current).toBe(5.0);

      rerender({ time: 10.0 });
      expect(result.current).toBe(10.0);
    });
  });
});
