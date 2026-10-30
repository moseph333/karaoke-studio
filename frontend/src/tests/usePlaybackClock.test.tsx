import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  createPlaybackClock,
  PlaybackClock,
  PlaybackClockContext,
  usePlaybackSeekListener,
  usePlaybackTime,
  usePlaybackValue,
} from '../hooks/usePlaybackClock';

describe('createPlaybackClock', () => {
  it('starts at 0 and publishes new positions to subscribers synchronously', () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    clock.subscribe(listener);
    expect(clock.getState()).toEqual({ time: 0, seekId: 0 });

    clock.setTime(12.5);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.getState().time).toBe(12.5);
  });

  it('keeps the same state object, and stays quiet, when nothing changed', () => {
    const clock = createPlaybackClock();
    clock.setTime(3);
    const state = clock.getState();
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.setTime(3);
    clock.setTime(Number.NaN);
    clock.setTime(Infinity);

    expect(listener).not.toHaveBeenCalled();
    expect(clock.getState()).toBe(state);
  });

  it('counts seeks, including a seek to the current position, but not playback', () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.setTime(1);
    clock.setTime(2);
    expect(clock.getState().seekId).toBe(0);

    clock.setTime(40, { seek: true });
    clock.setTime(40, { seek: true });
    expect(clock.getState()).toEqual({ time: 40, seekId: 2 });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('stops notifying after unsubscribe', () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    unsubscribe();
    clock.setTime(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it('now() prefers a finite live reading and falls back to the stored time', () => {
    const clock = createPlaybackClock();
    clock.setTime(10);
    expect(clock.now()).toBe(10);

    let live: number | null = 10.37;
    clock.setLiveReader(() => live);
    expect(clock.now()).toBe(10.37);

    live = null;
    expect(clock.now()).toBe(10);
    live = Number.NaN;
    expect(clock.now()).toBe(10);

    clock.setLiveReader(null);
    expect(clock.now()).toBe(10);
  });
});

describe('usePlaybackValue', () => {
  const renders = { count: 0 };

  const LineIndex: React.FC<{
    timeOverride?: number;
    live?: boolean;
  }> = ({ timeOverride, live }) => {
    renders.count++;
    // A line boundary every 5 seconds
    const line = usePlaybackValue((t) => Math.floor(t / 5), timeOverride, { live });
    return <span data-testid="line">{line}</span>;
  };

  const renderWithClock = (clock: PlaybackClock, ui: React.ReactElement) =>
    render(<PlaybackClockContext.Provider value={clock}>{ui}</PlaybackClockContext.Provider>);

  it('re-renders only when the selected value changes', () => {
    const clock = createPlaybackClock();
    renders.count = 0;
    renderWithClock(clock, <LineIndex />);
    expect(renders.count).toBe(1);

    // Eight timeupdates inside the first line, then one that crosses into the second
    act(() => {
      for (const t of [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4.75]) clock.setTime(t);
    });
    expect(renders.count).toBe(1);
    expect(screen.getByTestId('line')).toHaveTextContent('0');

    act(() => clock.setTime(5.25));
    expect(renders.count).toBe(2);
    expect(screen.getByTestId('line')).toHaveTextContent('1');
  });

  it('uses a time prop instead of the clock, without subscribing', () => {
    const clock = createPlaybackClock();
    renders.count = 0;
    renderWithClock(clock, <LineIndex timeOverride={12} />);
    expect(screen.getByTestId('line')).toHaveTextContent('2');

    act(() => clock.setTime(40));
    expect(renders.count).toBe(1);
    expect(screen.getByTestId('line')).toHaveTextContent('2');
  });

  it('works without a provider: the prop, else 0', () => {
    const { rerender } = render(<LineIndex timeOverride={26} />);
    expect(screen.getByTestId('line')).toHaveTextContent('5');
    rerender(<LineIndex />);
    expect(screen.getByTestId('line')).toHaveTextContent('0');
  });

  it('does not re-render while not live, and reads the clock again when live', () => {
    const clock = createPlaybackClock();
    renders.count = 0;
    const { rerender } = renderWithClock(clock, <LineIndex live={false} />);

    act(() => {
      clock.setTime(7);
      clock.setTime(12);
    });
    expect(renders.count).toBe(1);
    expect(screen.getByTestId('line')).toHaveTextContent('0');

    rerender(
      <PlaybackClockContext.Provider value={clock}>
        <LineIndex live />
      </PlaybackClockContext.Provider>
    );
    expect(screen.getByTestId('line')).toHaveTextContent('2');
    act(() => clock.setTime(16));
    expect(screen.getByTestId('line')).toHaveTextContent('3');
  });

  it('usePlaybackTime follows every change', () => {
    const clock = createPlaybackClock();
    const Time: React.FC = () => <span data-testid="time">{usePlaybackTime()}</span>;
    renderWithClock(clock, <Time />);
    act(() => clock.setTime(1.25));
    expect(screen.getByTestId('time')).toHaveTextContent('1.25');
    act(() => clock.setTime(1.5));
    expect(screen.getByTestId('time')).toHaveTextContent('1.5');
  });
});

describe('usePlaybackSeekListener', () => {
  const Listener: React.FC<{ onSeek: () => void; enabled?: boolean }> = ({ onSeek, enabled }) => {
    usePlaybackSeekListener(onSeek, enabled);
    return null;
  };

  it('calls back on seeks only, not on playback progress', () => {
    const clock = createPlaybackClock();
    const onSeek = vi.fn();
    render(
      <PlaybackClockContext.Provider value={clock}>
        <Listener onSeek={onSeek} />
      </PlaybackClockContext.Provider>
    );

    act(() => {
      clock.setTime(1);
      clock.setTime(2);
    });
    expect(onSeek).not.toHaveBeenCalled();

    act(() => clock.setTime(90, { seek: true }));
    expect(onSeek).toHaveBeenCalledTimes(1);
    act(() => clock.setTime(90.25));
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const clock = createPlaybackClock();
    const onSeek = vi.fn();
    render(
      <PlaybackClockContext.Provider value={clock}>
        <Listener onSeek={onSeek} enabled={false} />
      </PlaybackClockContext.Provider>
    );
    act(() => clock.setTime(30, { seek: true }));
    expect(onSeek).not.toHaveBeenCalled();
  });
});
