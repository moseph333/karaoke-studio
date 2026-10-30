/**
 * Components following the playback clock (no `currentTime` prop), as in the app: the
 * timeline editor re-renders at word boundaries, auto-scroll resumes on the clock's seeks,
 * the transport shows the clock, and the frame loop holds a restored position.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { TransportDock } from '../../components/transport/TransportDock';
import { useInterpolatedTime } from '../../hooks/useInterpolatedTime';
import {
  createPlaybackClock,
  PlaybackClock,
  PlaybackClockContext,
} from '../../hooks/usePlaybackClock';
import { LyricLine } from '../../types';

const renders = vi.hoisted(() => ({ editor: 0, rows: 0 }));

// The toolbar re-renders with the editor; the row counter sits inside the rows' memo
vi.mock('../../components/timeline/TimelineToolbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/timeline/TimelineToolbar')>();
  const Counted: typeof actual.TimelineToolbar = (props) => {
    renders.editor++;
    return <actual.TimelineToolbar {...props} />;
  };
  return { ...actual, TimelineToolbar: Counted };
});
vi.mock('../../components/timeline/TimelineLineCard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../components/timeline/TimelineLineCard')>();
  const Counted = React.memo((props: React.ComponentProps<typeof actual.TimelineLineCard>) => {
    renders.rows++;
    return <actual.TimelineLineCard {...props} />;
  });
  return { ...actual, TimelineLineCard: Counted };
});

// A line every 5 s, four words each
const lines: LyricLine[] = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  text: `Line ${i + 1}`,
  start_time: i * 5,
  end_time: i * 5 + 4.5,
  words: [
    { word: `WordA_${i + 1}`, start_time: i * 5, end_time: i * 5 + 1 },
    { word: `WordB_${i + 1}`, start_time: i * 5 + 1, end_time: i * 5 + 2 },
    { word: `WordC_${i + 1}`, start_time: i * 5 + 2, end_time: i * 5 + 3.2 },
    { word: `WordD_${i + 1}`, start_time: i * 5 + 3.2, end_time: i * 5 + 4.5 },
  ],
}));

const renderEditor = (clock: PlaybackClock, isPlaying = true) => {
  const onSaveLines = vi.fn().mockResolvedValue(undefined);
  const onSeek = vi.fn();
  render(
    <PlaybackClockContext.Provider value={clock}>
      <LyricTimelineEditor
        lines={lines}
        duration={120}
        isPlaying={isPlaying}
        onSeek={onSeek}
        onSaveLines={onSaveLines}
      />
    </PlaybackClockContext.Provider>
  );
  return { onSaveLines, onSeek };
};

describe('LyricTimelineEditor on the playback clock', () => {
  beforeEach(() => {
    localStorage.clear();
    renders.editor = 0;
    renders.rows = 0;
  });

  // A line stays highlighted until 1 s after its end, so the times below sit well inside
  // line 7 (30-34.5 s) and line 8 (35-39.5 s)
  const resetCounts = () => {
    renders.editor = 0;
    renders.rows = 0;
  };

  it('re-renders at word boundaries, not on every timeupdate', () => {
    const clock = createPlaybackClock();
    renderEditor(clock);
    act(() => clock.setTime(31.1));
    expect(screen.getByTestId('active-timeline-word')).toHaveTextContent('WordB_7');
    resetCounts();

    act(() => {
      for (const t of [31.3, 31.5, 31.7, 31.9]) clock.setTime(t);
    });
    expect(renders).toEqual({ editor: 0, rows: 0 });

    // Next word: the editor and only the active line's row re-render
    act(() => clock.setTime(32.1));
    expect(screen.getByTestId('active-timeline-word')).toHaveTextContent('WordC_7');
    expect(renders).toEqual({ editor: 1, rows: 1 });

    // Next line: the rows leaving and entering the highlight
    resetCounts();
    act(() => clock.setTime(35.6));
    expect(screen.getByTestId('active-timeline-word')).toHaveTextContent('WordA_8');
    expect(renders).toEqual({ editor: 1, rows: 2 });
  });

  it('scrolls once per line while playback moves within it', () => {
    const clock = createPlaybackClock();
    renderEditor(clock);
    const container = screen.getByTestId('timeline-scroll-container');
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object') container.scrollTop = options.top ?? 0;
    });
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;

    act(() => clock.setTime(31.1));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    act(() => {
      for (const t of [31.6, 32.2, 32.8, 33.4, 34.0]) clock.setTime(t);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);

    act(() => clock.setTime(35.6));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('resumes paused auto-scroll on a seek, not on playback', () => {
    const clock = createPlaybackClock();
    renderEditor(clock);
    act(() => clock.setTime(31.1));
    const container = screen.getByTestId('timeline-scroll-container');

    act(() => {
      fireEvent.wheel(container);
      container.scrollTop = 900;
      fireEvent.scroll(container);
    });
    expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

    act(() => clock.setTime(31.4));
    act(() => clock.setTime(36.2));
    expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

    act(() => clock.setTime(60, { seek: true }));
    expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
  });

  it("stamps taps at the clock's live position", async () => {
    const user = userEvent.setup();
    const clock = createPlaybackClock();
    clock.setTime(4.25);
    // Between timeupdates the media element is already further along
    clock.setLiveReader(() => 4.37);
    const { onSaveLines } = renderEditor(clock, false);

    await user.click(screen.getByTestId('tap-to-sync-btn'));
    await user.click(screen.getByTestId('tap-now-btn'));
    await user.click(screen.getByTestId('save-lyrics-btn'));

    const saved = onSaveLines.mock.calls[0][0] as LyricLine[];
    expect(saved[0].start_time).toBe(4.37);
  });

  it('offers playhead snaps on expanded rows, reading the clock on click', async () => {
    const user = userEvent.setup();
    const clock = createPlaybackClock();
    clock.setTime(0.4);
    const { onSaveLines } = renderEditor(clock, false);

    await user.click(screen.getByRole('button', { name: 'Expand word timings for line 1' }));
    act(() => clock.setTime(0.62));
    await user.click(screen.getByRole('button', { name: 'Snap end of word WordA_1 to playhead' }));
    await user.click(screen.getByTestId('save-lyrics-btn'));

    const saved = onSaveLines.mock.calls[0][0] as LyricLine[];
    expect(saved[0].words[0].end_time).toBe(0.62);
  });
});

describe('TransportDock on the playback clock', () => {
  it('shows the clock position without a currentTime prop', () => {
    const clock = createPlaybackClock();
    render(
      <PlaybackClockContext.Provider value={clock}>
        <TransportDock
          masterAudioUrl="/static/output/song.wav"
          duration={180}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      </PlaybackClockContext.Provider>
    );
    expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');

    act(() => clock.setTime(75.4));
    expect(screen.getByTestId('transport-time')).toHaveTextContent('1:15');
    expect(screen.getByRole('slider', { name: 'Audio timeline position' })).toHaveAttribute(
      'aria-valuenow',
      '75'
    );
  });
});

describe('useInterpolatedTime getLiveTime', () => {
  it("holds the live position while the element's own clock reads 0 (a reloading source)", () => {
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'paused', { value: true, configurable: true });
    const audioRef = { current: audio };

    const { result } = renderHook(() =>
      useInterpolatedTime({
        currentTime: 42.5,
        isPlaying: true,
        audioRef,
        getLiveTime: () => 42.5,
      })
    );
    act(() => frame?.(performance.now()));
    expect(audio.currentTime).toBe(0);
    expect(result.current).toBe(42.5);
    vi.restoreAllMocks();
  });
});
