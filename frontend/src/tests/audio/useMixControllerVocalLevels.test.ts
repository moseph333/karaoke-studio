import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMixController, MIX_DEBOUNCE_MS } from '../../hooks/useMixController';
import type { VocalLevels } from '../../types';
import * as apiModule from '../../api';

const okResponse = (url = '/static/output/p_mix_0_0_abcd1234.wav') =>
  new Response(JSON.stringify({ status: 'ok', master_audio_url: url }), { status: 200 });

describe('useMixController with vocal levels', () => {
  let apiSpy: MockInstance<typeof apiModule.apiFetch>;

  beforeEach(() => {
    vi.useFakeTimers();
    apiSpy = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async () => okResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const debounce = () => act(() => void vi.advanceTimersByTime(MIX_DEBOUNCE_MS));
  const bodyOf = (call: number) =>
    JSON.parse(String((apiSpy.mock.calls[call] as [string, RequestInit])[1].body));

  it('starts from the levels the song has', () => {
    const { result } = renderHook(() =>
      useMixController({ projectId: 'p1', initialVocalLevels: { backing: 1 } })
    );
    expect(result.current.vocalLevels).toEqual({ backing: 1 });
    expect(result.current.isPending).toBe(false);
  });

  it('shows a dragged level at once and mixes only when it is committed', async () => {
    const onApplied = vi.fn();
    const { result } = renderHook(() => useMixController({ projectId: 'p1', onApplied }));

    act(() => result.current.setVocalLevels({ backing: 0.4 }));
    act(() => result.current.setVocalLevels({ backing: 0.8 }));
    expect(result.current.vocalLevels).toEqual({ backing: 0.8 });
    expect(result.current.isPending).toBe(true);
    debounce();
    expect(apiSpy).not.toHaveBeenCalled();

    act(() => result.current.commitVocalLevels({ backing: 1 }));
    debounce();
    await flush();

    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toEqual({ semitones: 0, guide_volume: 0, vocal_levels: { backing: 1 } });
    expect(onApplied).toHaveBeenCalledWith({
      semitones: 0,
      guideVolume: 0,
      vocalLevels: { backing: 1 },
      masterAudioUrl: '/static/output/p_mix_0_0_abcd1234.wav',
    });
    expect(result.current.isPending).toBe(false);
  });

  it('sends the levels with a key change, and none once they are cleared', async () => {
    const { result } = renderHook(() =>
      useMixController({
        projectId: 'p1',
        initialVocalLevels: { by: 'lines', singer1: 0, singer2: 1 },
      })
    );

    act(() => result.current.stepSemitones(2));
    debounce();
    await flush();
    expect(bodyOf(0)).toEqual({
      semitones: 2,
      guide_volume: 0,
      vocal_levels: { singer1: 0, singer2: 1, by: 'lines' },
    });

    act(() => result.current.commitVocalLevels({}));
    debounce();
    await flush();
    expect(bodyOf(1)).toEqual({ semitones: 2, guide_volume: 0 });
    expect(result.current.vocalLevels).toEqual({});
  });

  it('keeps levels within range before sending them', async () => {
    const { result } = renderHook(() => useMixController({ projectId: 'p1' }));

    act(() => result.current.commitVocalLevels({ backing: 3, singer1: -1 } as VocalLevels));
    debounce();
    await flush();

    expect(bodyOf(0).vocal_levels).toEqual({ backing: 1, singer1: 0 });
  });

  it('does not treat its own levels coming back from the project as a change', async () => {
    const applied: VocalLevels[] = [];
    const { result, rerender } = renderHook(
      ({ levels }: { levels: VocalLevels | null }) =>
        useMixController({
          projectId: 'p1',
          initialVocalLevels: levels,
          onApplied: (r) => applied.push(r.vocalLevels),
        }),
      { initialProps: { levels: null as VocalLevels | null } }
    );

    act(() => result.current.commitVocalLevels({ backing: 1 }));
    debounce();
    await flush();
    // The app stores what was applied; polling hands back a new object that says the same
    rerender({ levels: { backing: 1 } });
    act(() => result.current.setVocalLevels({ backing: 0.5 }));
    rerender({ levels: { backing: 1.0 } });

    expect(result.current.vocalLevels).toEqual({ backing: 0.5 });
    expect(result.current.isPending).toBe(true);
  });

  it('takes levels changed from outside, dropping what was pending', async () => {
    const { result, rerender } = renderHook(
      ({ levels }: { levels: VocalLevels | null }) =>
        useMixController({ projectId: 'p1', initialVocalLevels: levels }),
      { initialProps: { levels: { backing: 1 } as VocalLevels | null } }
    );
    act(() => result.current.commitVocalLevels({ backing: 0.2 }));

    // Another device set a different level before this one was sent
    rerender({ levels: { backing: 0.6 } });
    debounce();
    await flush();

    expect(result.current.vocalLevels).toEqual({ backing: 0.6 });
    expect(result.current.isPending).toBe(false);
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('opens another song with that song`s levels', () => {
    const { result, rerender } = renderHook(
      ({ id, levels }: { id: string; levels: VocalLevels | null }) =>
        useMixController({ projectId: id, initialVocalLevels: levels }),
      { initialProps: { id: 'p1', levels: { backing: 1 } as VocalLevels | null } }
    );
    act(() => result.current.setVocalLevels({ backing: 0.3 }));

    rerender({ id: 'p2', levels: null });

    expect(result.current.vocalLevels).toEqual({});
    expect(result.current.isPending).toBe(false);
  });

  it('mixes again with the same levels when asked to (a stale mix)', async () => {
    const { result } = renderHook(() =>
      useMixController({ projectId: 'p1', initialVocalLevels: { by: 'lines', singer2: 1 } })
    );

    await act(async () => {
      await result.current.applyNow();
    });

    expect(bodyOf(0)).toEqual({
      semitones: 0,
      guide_volume: 0,
      vocal_levels: { singer2: 1, by: 'lines' },
    });
  });
});
