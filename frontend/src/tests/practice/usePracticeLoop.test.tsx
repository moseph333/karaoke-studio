/**
 * Repeating a stretch in practice, driven by a real playback clock: playback goes back to the
 * lead-in when a pass ends, the turn is aimed between clock ticks, and the stretch follows the
 * listener to another part.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createPlaybackClock, type PlaybackClock } from '../../hooks/usePlaybackClock';
import { usePracticeLoop, type UsePracticeLoopOptions } from '../../hooks/usePracticeLoop';
import { PRACTICE_LINES } from '../helpers/practiceFixtures';

/** A clock whose seeks land where they are sent, as the studio's player does. */
function setup(overrides: Partial<UsePracticeLoopOptions> = {}) {
  const clock: PlaybackClock = createPlaybackClock();
  const onSeek = vi.fn((time: number) => clock.setTime(time, { seek: true }));
  const onPassEnd = vi.fn();
  const initial: UsePracticeLoopOptions = {
    enabled: true,
    songId: 'song',
    lines: PRACTICE_LINES,
    duration: 64,
    clock,
    isPlaying: true,
    playbackRate: 1,
    onSeek,
    onPassEnd,
    ...overrides,
  };
  const hook = renderHook((props: UsePracticeLoopOptions) => usePracticeLoop(props), {
    initialProps: initial,
  });
  /** Playback reaching `time` (a media timeupdate). */
  const playTo = (time: number) => act(() => clock.setTime(time));
  /** The listener jumping to `time`. */
  const jumpTo = (time: number) => act(() => clock.setTime(time, { seek: true }));
  return { ...hook, clock, onSeek, onPassEnd, initial, playTo, jumpTo };
}

describe('usePracticeLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lists the parts only while practice is on', () => {
    expect(setup().result.current.parts).toHaveLength(3);
    expect(setup({ enabled: false }).result.current.parts).toEqual([]);
  });

  it('repeats the part being sung without jumping, and goes round at its end', () => {
    const { result, onSeek, onPassEnd, playTo, jumpTo } = setup();
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());

    expect(result.current.mode).toBe('part');
    expect(result.current.range).toMatchObject({ firstLine: 3, lastLine: 7, start: 26, end: 40.5 });
    expect(onSeek).not.toHaveBeenCalled();

    playTo(40.9);
    expect(onSeek).not.toHaveBeenCalled();
    playTo(41.15);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenLastCalledWith(24);
    expect(onPassEnd).toHaveBeenCalledWith(expect.objectContaining({ firstLine: 3, lastLine: 7 }));
    // Its own jump back does not move the stretch to the part before
    expect(result.current.range).toMatchObject({ firstLine: 3, lastLine: 7 });
  });

  it('aims the turn between clock ticks', () => {
    const { result, clock, onSeek, playTo, jumpTo } = setup();
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());
    // Last tick 0.4 s before the turn at 41.1; the player runs on meanwhile
    playTo(40.7);
    clock.setLiveReader(() => 41.1);
    act(() => void vi.advanceTimersByTime(390));
    expect(onSeek).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(20));
    expect(onSeek).toHaveBeenCalledWith(24);
  });

  it('waits longer for the turn when the song plays slower', () => {
    const { result, clock, onSeek, playTo, jumpTo } = setup({ playbackRate: 0.5 });
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());
    playTo(40.7);
    clock.setLiveReader(() => 41.1);
    act(() => void vi.advanceTimersByTime(700));
    expect(onSeek).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(120));
    expect(onSeek).toHaveBeenCalledWith(24);
  });

  it('does not go round while paused', () => {
    const { result, onSeek, playTo, jumpTo } = setup({ isPlaying: false });
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());
    playTo(41.2);
    act(() => void vi.advanceTimersByTime(2000));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('follows the listener to another part', () => {
    const { result, onSeek, jumpTo } = setup();
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());
    jumpTo(47);
    expect(result.current.range).toMatchObject({ firstLine: 8, lastLine: 12 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('repeats a picked part from its lead-in', () => {
    const { result, onSeek } = setup();
    act(() => result.current.repeatPart(1));
    expect(result.current.mode).toBe('part');
    expect(result.current.range).toMatchObject({ firstLine: 0, lastLine: 2 });
    expect(onSeek).toHaveBeenLastCalledWith(8);
  });

  it('keeps a stretch picked by lines where it is when the listener goes elsewhere', () => {
    const { result, onSeek, playTo, jumpTo } = setup();
    act(() => result.current.setStretch(4, 5));
    expect(result.current.mode).toBe('custom');
    expect(result.current.range).toEqual({ firstLine: 4, lastLine: 5, start: 29, end: 34.5 });
    expect(onSeek).toHaveBeenLastCalledWith(27);

    jumpTo(50);
    expect(result.current.range).toMatchObject({ firstLine: 4, lastLine: 5 });
    // Coming back, it still turns at its own end
    jumpTo(33);
    playTo(35.15);
    expect(onSeek).toHaveBeenLastCalledWith(27);
  });

  it('stops repeating when toggled again', () => {
    const { result, onSeek, playTo, jumpTo } = setup();
    jumpTo(30);
    act(() => result.current.toggleCurrentPart());
    act(() => result.current.toggleCurrentPart());
    expect(result.current.mode).toBe('off');
    expect(result.current.range).toBeNull();
    playTo(41.2);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('stops repeating when practice is left or another song opens', () => {
    const left = setup();
    act(() => left.result.current.repeatPart(2));
    left.rerender({ ...left.initial, enabled: false });
    expect(left.result.current.range).toBeNull();

    const switched = setup();
    act(() => switched.result.current.repeatPart(2));
    switched.rerender({ ...switched.initial, songId: 'another' });
    expect(switched.result.current.mode).toBe('off');
  });

  it('turns before the song ends when the stretch runs to the last second', () => {
    const { result, onSeek, playTo } = setup({ duration: 58 });
    act(() => result.current.repeatPart(3));
    onSeek.mockClear();
    playTo(57.75);
    expect(onSeek).toHaveBeenCalledWith(41);
  });
});
