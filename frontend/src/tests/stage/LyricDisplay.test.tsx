import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../../components/LyricDisplay';
import { getStageLook } from '../../theme/stageLooks';
import { useInterpolatedTime } from '../../hooks/useInterpolatedTime';
import { LyricLine, SingerRole } from '../../types';
import { renderHook } from '@testing-library/react';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

// KTV draws the words as the lyrics write them and keeps each line in a row of its own
const KTV = getStageLook('ktv');

/** The element that carries a row's colour. */
const ink = (row: HTMLElement) => row.querySelector('.ks-words') as HTMLElement;

/** The words of the line being sung as the stage draws them (each word is drawn twice: once
 * to sing, once sung). */
const drawn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('.ks-word > span:first-child'), (word) => word.textContent).join(
    ''
  );

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
    // The seconds left until the vocals, with the first line waiting under the reading place
    expect(screen.getByTestId('stage-break-marker')).toHaveTextContent('4');
    expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Jump playback to line at 4.00 seconds' })
    ).toHaveTextContent('Hello world');
  });

  it('renders active line words and next upcoming line', () => {
    render(<LyricDisplay lines={mockLines} currentTime={4.5} />);
    const active = screen.getByTestId('active-lyrics-line');
    expect(
      within(active).getByRole('button', { name: 'Jump playback to word Hello at 4.00 seconds' })
    ).toBeInTheDocument();
    expect(
      within(active).getByRole('button', { name: 'Jump playback to word world at 5.00 seconds' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Jump playback to line at 8.00 seconds' })
    ).toHaveTextContent('Next line begins');
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
    // The line starts 4 s into the song, a gap long enough to count in; KTV counts with dots,
    // one going out each second
    const { rerender } = render(
      <LyricDisplay lines={mockLines} currentTime={1.5} selectedTheme={KTV} />
    );
    expect(screen.getAllByTestId('stage-countin')).toHaveLength(3);
    rerender(<LyricDisplay lines={mockLines} currentTime={2.5} selectedTheme={KTV} />);
    expect(screen.getAllByTestId('stage-countin')).toHaveLength(2);
    rerender(<LyricDisplay lines={mockLines} currentTime={4.0} selectedTheme={KTV} />);
    expect(screen.queryByTestId('stage-countin')).not.toBeInTheDocument();
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

  it('fills Singer 1 with themeSungColor and names each part where the singer changes', () => {
    // 5.5 s: the first line is in its last moments on stage and the second is already showing
    render(
      <LyricDisplay
        lines={duetLines}
        currentTime={5.5}
        themeSungColor="#fbbf24"
        selectedTheme={KTV}
      />
    );

    expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '0');
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#fbbf24' });

    const names = screen.getAllByTestId('stage-part-name');
    expect(names.map((name) => name.textContent)).toEqual(['Singer 1', 'Singer 2']);
    expect(names.map((name) => name.getAttribute('data-line'))).toEqual(['0', '1']);
    expect(ink(names[0])).toHaveStyle({ color: '#fbbf24' });
    expect(ink(names[1])).toHaveStyle({ color: KTV.palette.singer2 });
  });

  it("renders Singer 2 in the look's Singer 2 colour under the part's name", () => {
    render(<LyricDisplay lines={duetLines} currentTime={7.0} selectedTheme={KTV} />);

    expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '1');
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: KTV.palette.singer2 });
    expect(screen.getByTestId('stage-part-name')).toHaveTextContent('Singer 2');
  });

  it("renders Both in the look's colour for both singers under the part's name", () => {
    render(<LyricDisplay lines={duetLines} currentTime={11.0} selectedTheme={KTV} />);

    expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '2');
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: KTV.palette.both });
    const name = screen.getByTestId('stage-part-name');
    expect(name).toHaveTextContent('Both');
    expect(ink(name)).toHaveStyle({ color: KTV.palette.both });
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
      {
        id: 12,
        text: 'Unset closing line',
        start_time: 9.0,
        end_time: 12.0,
        words: [{ word: 'Unset', start_time: 9.0, end_time: 12.0 }],
      },
    ];

    // 4.5 s: the "partner" line is still on stage and the "unison" line is showing
    const { rerender } = render(
      <LyricDisplay lines={aliasedLines} currentTime={4.5} selectedTheme={KTV} />
    );
    expect(screen.getAllByTestId('stage-part-name').map((name) => name.textContent)).toEqual([
      'Singer 2',
      'Both',
    ]);
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: KTV.palette.singer2 });
    expect(screen.getByTestId('word-sung-1-0')).toHaveStyle({ color: KTV.palette.both });

    rerender(<LyricDisplay lines={aliasedLines} currentTime={10.0} selectedTheme={KTV} />);
    expect(screen.getByTestId('stage-part-name')).toHaveTextContent('Singer 1');
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: KTV.palette.sung });
  });

  it('provides upcoming singer anticipatory cue before the first line during intro', () => {
    render(<LyricDisplay lines={duetLines} currentTime={0.2} selectedTheme={KTV} />);
    // The first line is on stage before it is sung, under the name of the part that sings it
    expect(drawn(screen.getByTestId('active-lyrics-line'))).toBe('Lead singer opens the song');
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ width: '0.00%' });
    const name = screen.getByTestId('stage-part-name');
    expect(name).toHaveTextContent('Singer 1');
    expect(name).toHaveAttribute('data-line', '0');
  });

  it('shows no part name when a song only has one singer', () => {
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

    const { rerender } = render(
      <LyricDisplay lines={singleSingerLines} currentTime={0.2} selectedTheme={KTV} />
    );
    expect(drawn(screen.getByTestId('active-lyrics-line'))).toBe('Solo opening line');
    expect(screen.queryByTestId('stage-part-name')).not.toBeInTheDocument();

    // 5.5 s: both lines are on stage, and neither is named
    rerender(<LyricDisplay lines={singleSingerLines} currentTime={5.5} selectedTheme={KTV} />);
    expect(drawn(screen.getByTestId('active-lyrics-line'))).toBe('Solo opening line');
    // A line is drawn from its timed words
    expect(drawn(screen.getByTestId('stage-line'))).toBe('Solo second line');
    expect(screen.queryByTestId('stage-part-name')).not.toBeInTheDocument();
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

  it('counts the seconds left during an intro gap >= 4.0s', () => {
    // An intro of 6 s or more belongs to the title card, so this song starts at 5.5 s
    const introLines = [{ ...gapLines[0], start_time: 5.5 }, gapLines[1]];
    const { rerender } = render(<LyricDisplay lines={introLines} currentTime={2.0} />);
    expect(screen.getByTestId('stage-break-marker')).toHaveTextContent(/^4$/);
    expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();

    rerender(<LyricDisplay lines={introLines} currentTime={0.2} />);
    expect(screen.getByTestId('stage-break-marker')).toHaveTextContent(/^6$/);
  });

  it('shows the 3-2-1 count-in during the final 3 seconds of the gap', () => {
    const { rerender } = render(<LyricDisplay lines={gapLines} currentTime={2.9} />);
    expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();

    for (const [time, numeral] of [
      [3.0, '3'],
      [4.5, '2'],
      [5.5, '1'],
    ] as const) {
      rerender(<LyricDisplay lines={gapLines} currentTime={time} />);
      expect(screen.getByTestId('stage-count-in')).toHaveTextContent(numeral);
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
    }
  });

  it('automatically hides countdown indicator immediately when singing begins', () => {
    const { rerender } = render(<LyricDisplay lines={gapLines} currentTime={5.9} />);
    expect(screen.getByTestId('stage-count-in')).toBeInTheDocument();

    rerender(<LyricDisplay lines={gapLines} currentTime={6.0} />);
    expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
  });

  it('detects inter-line gap >= 4.0s and matches upcoming singer color (Singer 2)', () => {
    const { rerender } = render(
      <LyricDisplay lines={gapLines} currentTime={14.0} singer2SungColor="#ec4899" />
    );
    // The break counts the seconds to the vocals at 18 s, then the count-in takes the colour
    // of the part about to sing
    expect(screen.getByTestId('stage-break-marker')).toHaveTextContent(/^4$/);

    rerender(<LyricDisplay lines={gapLines} currentTime={16.0} singer2SungColor="#ec4899" />);
    const countIn = screen.getByTestId('stage-count-in');
    expect(countIn).toHaveTextContent('2');
    expect(ink(countIn)).toHaveStyle({ color: '#ec4899' });
  });

  it('does not render a break marker or count-in for short breaks < 4.0s', () => {
    const shortBreakLines: LyricLine[] = [
      { id: 1, text: 'Line 1', start_time: 1.0, end_time: 4.0, words: [] },
      { id: 2, text: 'Line 2', start_time: 6.5, end_time: 9.0, words: [] }, // 2.5s gap
    ];
    for (const time of [4.5, 5.0, 6.0]) {
      const { unmount } = render(<LyricDisplay lines={shortBreakLines} currentTime={time} />);
      expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
      unmount();
    }
  });
});
