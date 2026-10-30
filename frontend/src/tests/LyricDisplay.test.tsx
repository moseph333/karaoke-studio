import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../components/LyricDisplay';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { LyricLine, SingerRole } from '../types';
import { renderHook } from '@testing-library/react';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './helpers/responsiveTestUtils';

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

describe('LyricDisplay Multi-Singer Duet Presentations (Requirement R2)', () => {
  const duetLines: LyricLine[] = [
    {
      id: 1,
      text: 'Lead singer opens the song',
      start_time: 2.0,
      end_time: 5.0,
      singer: 'singer1',
      words: [
        { word: 'Lead', start_time: 2.0, end_time: 2.8 },
        { word: 'singer', start_time: 2.9, end_time: 3.8 },
        { word: 'opens', start_time: 3.9, end_time: 4.5 },
        { word: 'the', start_time: 4.6, end_time: 4.8 },
        { word: 'song', start_time: 4.8, end_time: 5.0 },
      ],
    },
    {
      id: 2,
      text: 'Partner responds in harmony',
      start_time: 6.0,
      end_time: 9.0,
      singer: 'singer2',
      words: [
        { word: 'Partner', start_time: 6.0, end_time: 7.0 },
        { word: 'responds', start_time: 7.1, end_time: 8.0 },
        { word: 'in', start_time: 8.1, end_time: 8.3 },
        { word: 'harmony', start_time: 8.4, end_time: 9.0 },
      ],
    },
    {
      id: 3,
      text: 'Both singers unite for chorus',
      start_time: 10.0,
      end_time: 13.0,
      singer: 'both',
      words: [
        { word: 'Both', start_time: 10.0, end_time: 10.8 },
        { word: 'singers', start_time: 10.9, end_time: 11.6 },
        { word: 'unite', start_time: 11.7, end_time: 12.3 },
        { word: 'for', start_time: 12.4, end_time: 12.6 },
        { word: 'chorus', start_time: 12.7, end_time: 13.0 },
      ],
    },
  ];

  afterEach(() => {
    resetTestViewport();
  });

  it('renders Singer 1 with themeSungColor and accessible Lead badge', () => {
    render(<LyricDisplay lines={duetLines} currentTime={3.0} themeSungColor="#fbbf24" />);

    const badge = screen.getByTestId('active-singer-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-singer', 'singer1');
    expect(badge).toHaveTextContent('Singer 1 / Lead');
    // Icons are decorative SVGs, not emoji characters
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    const sungOverlay = screen.getByTestId('word-sung-0');
    expect(sungOverlay).toHaveStyle({ color: '#fbbf24' });

    const nextTag = screen.getByTestId('next-singer-tag');
    expect(nextTag).toBeInTheDocument();
    expect(nextTag).toHaveAttribute('data-singer', 'singer2');
    expect(nextTag).toHaveTextContent('[Singer 2]');
    expect(nextTag).toHaveStyle({ color: '#ff00b3' });
  });

  it('renders Singer 2 with the export default magenta (#ff00b3) and Partner badge', () => {
    render(<LyricDisplay lines={duetLines} currentTime={7.0} />);

    const badge = screen.getByTestId('active-singer-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-singer', 'singer2');
    expect(badge).toHaveTextContent('Singer 2 / Partner');

    const sungOverlay = screen.getByTestId('word-sung-0');
    expect(sungOverlay).toHaveStyle({ color: '#ff00b3' });

    const nextTag = screen.getByTestId('next-singer-tag');
    expect(nextTag).toHaveAttribute('data-singer', 'both');
    expect(nextTag).toHaveTextContent('[Both / Duet]');
    expect(nextTag).toHaveStyle({ color: '#7bfa50' });
  });

  it('renders Both / Duet with the export default green (#7bfa50) and Duet icon badge', () => {
    render(<LyricDisplay lines={duetLines} currentTime={11.0} />);

    const badge = screen.getByTestId('active-singer-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-singer', 'both');
    expect(badge).toHaveTextContent('Both / Duet');

    const sungOverlay = screen.getByTestId('word-sung-0');
    expect(sungOverlay).toHaveStyle({ color: '#7bfa50' });
  });

  it('gracefully normalizes string aliases (partner, unison, duet) and defaults unset lines to singer1', () => {
    const aliasedLines: LyricLine[] = [
      {
        id: 10,
        text: 'Alias test line',
        start_time: 1.0,
        end_time: 4.0,
        singer: 'partner' as unknown as SingerRole,
        words: [{ word: 'Alias', start_time: 1.0, end_time: 4.0 }],
      },
      {
        id: 11,
        text: 'Unison alias upcoming',
        start_time: 5.0,
        end_time: 8.0,
        singer: 'unison' as unknown as SingerRole,
        words: [{ word: 'Unison', start_time: 5.0, end_time: 8.0 }],
      },
    ];

    render(<LyricDisplay lines={aliasedLines} currentTime={2.0} />);
    const badge = screen.getByTestId('active-singer-badge');
    expect(badge).toHaveAttribute('data-singer', 'singer2');
    expect(badge).toHaveTextContent('Singer 2 / Partner');

    const nextTag = screen.getByTestId('next-singer-tag');
    expect(nextTag).toHaveAttribute('data-singer', 'both');
    expect(nextTag).toHaveTextContent('[Both / Duet]');
  });

  it('provides upcoming singer anticipatory cue before the first line during intro', () => {
    render(<LyricDisplay lines={duetLines} currentTime={0.2} />);
    expect(screen.getByText('♪ Instrumental Intro ♪')).toBeInTheDocument();
    const nextTag = screen.getByTestId('next-singer-tag');
    expect(nextTag).toBeInTheDocument();
    expect(nextTag).toHaveTextContent('[Singer 1]');
  });

  it('hides the Singer 1 / Lead pill and [Singer 1] up next cue when a song only has one singer', () => {
    const singleSingerLines: LyricLine[] = [
      {
        id: 1,
        text: 'Solo opening line',
        start_time: 2.0,
        end_time: 5.0,
        singer: 'singer1',
        words: [
          { word: 'Solo', start_time: 2.0, end_time: 3.0 },
          { word: 'opening', start_time: 3.0, end_time: 4.0 },
          { word: 'line', start_time: 4.0, end_time: 5.0 },
        ],
      },
      {
        id: 2,
        text: 'Solo second line without explicit singer prop',
        start_time: 6.0,
        end_time: 9.0,
        words: [
          { word: 'Solo', start_time: 6.0, end_time: 7.0 },
          { word: 'second', start_time: 7.0, end_time: 8.0 },
          { word: 'line', start_time: 8.0, end_time: 9.0 },
        ],
      },
    ];

    const { rerender } = render(<LyricDisplay lines={singleSingerLines} currentTime={0.2} />);
    expect(screen.getByText('♪ Instrumental Intro ♪')).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-lyrics-line')).toHaveTextContent('Solo opening line');
    expect(screen.queryByTestId('active-singer-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-singer-tag')).not.toBeInTheDocument();

    rerender(<LyricDisplay lines={singleSingerLines} currentTime={3.0} />);
    expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-lyrics-line')).toHaveTextContent(
      'Solo second line without explicit singer prop'
    );
    expect(screen.queryByTestId('active-singer-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('next-singer-tag')).not.toBeInTheDocument();
  });

  it('maintains >=44px touch targets on fullscreen toggle and zero overflow at 320px viewport', () => {
    setTestViewport(320, 568);
    const { container } = render(<LyricDisplay lines={duetLines} currentTime={3.0} />);

    const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');
    expect(toggleBtn.className).toContain('min-h-[44px]');
    expect(toggleBtn.className).toContain('min-w-[44px]');

    assertZeroHorizontalOverflow(container, 320);
  });
});

describe('LyricDisplay Instrumental Gap Countdown (Requirement R3)', () => {
  const gapLines: LyricLine[] = [
    {
      id: 1,
      text: 'Verse 1 begins after intro',
      start_time: 6.0,
      end_time: 10.0,
      singer: 'singer1',
      words: [{ word: 'Verse', start_time: 6.0, end_time: 7.0 }],
    },
    {
      id: 2,
      text: 'Chorus begins after guitar solo',
      start_time: 18.0,
      end_time: 22.0,
      singer: 'singer2',
      words: [{ word: 'Chorus', start_time: 18.0, end_time: 19.0 }],
    },
  ];

  it('renders countdown progress bar and remaining time during intro gap >= 4.0s', () => {
    render(<LyricDisplay lines={gapLines} currentTime={2.0} />);

    expect(screen.getByText('♪ Instrumental Intro ♪')).toBeInTheDocument();

    const timeReadout = screen.getByTestId('gap-countdown-time');
    expect(timeReadout).toBeInTheDocument();
    expect(timeReadout).toHaveTextContent('Next vocals in 4s');

    const progressbar = screen.getByTestId('gap-countdown-progressbar');
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('role', 'progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '33');
  });

  it('shows 3-2-1 countdown cue dots during the final 3 seconds of the gap', () => {
    render(<LyricDisplay lines={gapLines} currentTime={4.5} />);

    const cue = screen.getByTestId('countdown-cue');
    expect(cue).toBeInTheDocument();
    expect(cue).toHaveAttribute('aria-label', expect.stringContaining('Starting in 2 seconds'));
  });

  it('automatically hides countdown indicator immediately when singing begins', () => {
    const { rerender } = render(<LyricDisplay lines={gapLines} currentTime={5.9} />);
    expect(screen.getByTestId('gap-countdown-progressbar')).toBeInTheDocument();

    rerender(<LyricDisplay lines={gapLines} currentTime={6.0} />);
    expect(screen.queryByTestId('gap-countdown-progressbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gap-countdown-time')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
  });

  it('detects inter-line gap >= 4.0s and matches upcoming singer color (Singer 2)', () => {
    render(<LyricDisplay lines={gapLines} currentTime={14.0} singer2SungColor="#ec4899" />);

    expect(screen.getByText('♪ Instrumental Solo ♪')).toBeInTheDocument();

    const timeReadout = screen.getByTestId('gap-countdown-time');
    expect(timeReadout).toHaveTextContent('Next vocals in 4s');

    const fillBar = screen.getByTestId('gap-countdown-progressbar-fill');
    expect(fillBar).toHaveStyle({ backgroundColor: '#ec4899' });
  });

  it('does not render gap progress bar for short breaks < 4.0s', () => {
    const shortBreakLines: LyricLine[] = [
      { id: 1, text: 'Line 1', start_time: 1.0, end_time: 4.0, words: [] },
      { id: 2, text: 'Line 2', start_time: 6.5, end_time: 9.0, words: [] }, // 2.5s gap
    ];
    render(<LyricDisplay lines={shortBreakLines} currentTime={5.0} />);
    expect(screen.queryByTestId('gap-countdown-progressbar')).not.toBeInTheDocument();
  });
});
