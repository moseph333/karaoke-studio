import { useLayoutEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMixController, MIX_DEBOUNCE_MS } from '../hooks/useMixController';
import * as apiModule from '../api';

type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };

function okResponse(url = '/static/output/p_mix.wav') {
  return new Response(JSON.stringify({ status: 'ok', master_audio_url: url }), { status: 200 });
}

describe('useMixController', () => {
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

  it('starts from the applied project values', () => {
    const { result } = renderHook(() =>
      useMixController({ projectId: 'p1', initialSemitones: 2, initialGuideVolume: 0.2 })
    );
    expect(result.current.semitones).toBe(2);
    expect(result.current.guideVolume).toBe(0.2);
    expect(result.current.appliedSemitones).toBe(2);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isRemixing).toBe(false);
  });

  it('debounces key steps into a single POST with the latest values', async () => {
    const onApplied = vi.fn();
    const { result } = renderHook(() => useMixController({ projectId: 'p1', onApplied }));

    act(() => {
      result.current.stepSemitones(1);
      result.current.stepSemitones(1);
      result.current.stepSemitones(1);
    });
    expect(result.current.semitones).toBe(3);
    expect(result.current.isPending).toBe(true);
    expect(apiSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    await flush();

    expect(apiSpy).toHaveBeenCalledTimes(1);
    const [url, init] = apiSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/project/p1/mix');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ semitones: 3, guide_volume: 0 });
    expect(onApplied).toHaveBeenCalledWith({
      semitones: 3,
      guideVolume: 0,
      masterAudioUrl: '/static/output/p_mix.wav',
    });
    expect(result.current.appliedSemitones).toBe(3);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isRemixing).toBe(false);
  });

  it('clamps keys to ±12 and guide levels to 0–0.5', () => {
    const { result } = renderHook(() => useMixController({ projectId: 'p1' }));
    act(() => result.current.setSemitones(40));
    expect(result.current.semitones).toBe(12);
    act(() => result.current.setSemitones(-40));
    expect(result.current.semitones).toBe(-12);
    act(() => result.current.setGuideVolume(0.9));
    expect(result.current.guideVolume).toBe(0.5);
    act(() => result.current.setGuideVolume(-1));
    expect(result.current.guideVolume).toBe(0);
  });

  it('applies the guide level only when committed', async () => {
    const { result } = renderHook(() => useMixController({ projectId: 'p1' }));

    act(() => result.current.setGuideVolume(0.3));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS * 3);
    });
    expect(apiSpy).not.toHaveBeenCalled();

    act(() => result.current.commitGuideVolume());
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    await flush();
    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((apiSpy.mock.calls[0][1] as RequestInit).body))).toEqual({
      semitones: 0,
      guide_volume: 0.3,
    });
  });

  it('aborts a stale in-flight request so only the latest response is committed', async () => {
    const deferreds: Deferred[] = [];
    const signals: AbortSignal[] = [];
    apiSpy.mockImplementation(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          signals.push(init!.signal as AbortSignal);
          deferreds.push({ resolve, reject });
        })
    );
    const onApplied = vi.fn();
    const { result } = renderHook(() => useMixController({ projectId: 'p1', onApplied }));

    act(() => result.current.setSemitones(1));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    expect(result.current.isRemixing).toBe(true);

    act(() => result.current.setSemitones(4));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // The stale response resolving late must not win
    await act(async () => {
      deferreds[0].resolve(okResponse('/static/output/stale.wav'));
      await Promise.resolve();
    });
    expect(onApplied).not.toHaveBeenCalled();

    await act(async () => {
      deferreds[1].resolve(okResponse('/static/output/fresh.wav'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ semitones: 4, masterAudioUrl: '/static/output/fresh.wav' })
    );
    expect(result.current.isRemixing).toBe(false);
  });

  it('reports server errors and leaves the applied values untouched', async () => {
    apiSpy.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Instrumental stem not ready yet' }), { status: 400 })
    );
    const onError = vi.fn();
    const onApplied = vi.fn();
    const { result } = renderHook(() =>
      useMixController({ projectId: 'p1', initialSemitones: 1, onApplied, onError })
    );

    act(() => result.current.setSemitones(5));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('Instrumental stem not ready yet');
    expect(onApplied).not.toHaveBeenCalled();
    expect(result.current.appliedSemitones).toBe(1);
    expect(result.current.semitones).toBe(5);
    expect(result.current.isPending).toBe(true);
    expect(result.current.isRemixing).toBe(false);
  });

  it('ignores echoes of its own applied values from the project record', async () => {
    const { result, rerender } = renderHook(
      (props: { semitones: number }) =>
        useMixController({ projectId: 'p1', initialSemitones: props.semitones }),
      { initialProps: { semitones: 0 } }
    );

    act(() => result.current.setSemitones(2));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    await flush();
    expect(result.current.appliedSemitones).toBe(2);

    // User keeps stepping while the project record echoes the applied value
    act(() => result.current.setSemitones(3));
    rerender({ semitones: 2 });
    expect(result.current.semitones).toBe(3);
    expect(result.current.isPending).toBe(true);
  });

  it('re-seeds and cancels pending work when the project changes', () => {
    const { result, rerender } = renderHook(
      (props: { id: string; semitones: number }) =>
        useMixController({ projectId: props.id, initialSemitones: props.semitones }),
      { initialProps: { id: 'p1', semitones: 0 } }
    );

    act(() => result.current.setSemitones(6));
    rerender({ id: 'p2', semitones: -1 });

    expect(result.current.semitones).toBe(-1);
    expect(result.current.appliedSemitones).toBe(-1);
    expect(result.current.isPending).toBe(false);

    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS * 2);
    });
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it("shows a newly opened song's key from its first committed frame", () => {
    const frames: Array<[string | undefined, number]> = [];
    const { rerender } = renderHook(
      (props: { id?: string; semitones: number }) => {
        const mix = useMixController({ projectId: props.id, initialSemitones: props.semitones });
        useLayoutEffect(() => {
          frames.push([props.id, mix.semitones]);
        });
        return mix;
      },
      { initialProps: { id: undefined as string | undefined, semitones: 0 } }
    );

    rerender({ id: 'p1', semitones: 2 });

    expect(frames).not.toContainEqual(['p1', 0]);
    expect(frames[frames.length - 1]).toEqual(['p1', 2]);
  });

  it('adopts values changed from outside (e.g. another device) when nothing is pending', () => {
    const { result, rerender } = renderHook(
      (props: { semitones: number }) =>
        useMixController({ projectId: 'p1', initialSemitones: props.semitones }),
      { initialProps: { semitones: 0 } }
    );
    rerender({ semitones: 4 });
    expect(result.current.semitones).toBe(4);
    expect(result.current.appliedSemitones).toBe(4);
  });

  it('does nothing without a project or when disabled', async () => {
    const { result } = renderHook(() => useMixController({ projectId: undefined }));
    act(() => result.current.setSemitones(2));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS * 2);
    });
    let applied = true;
    await act(async () => {
      applied = await result.current.applyNow();
    });
    expect(applied).toBe(false);
    expect(apiSpy).not.toHaveBeenCalled();

    const disabled = renderHook(() => useMixController({ projectId: 'p1', enabled: false }));
    act(() => disabled.result.current.setSemitones(2));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS * 2);
    });
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('applyNow skips the debounce', async () => {
    const { result } = renderHook(() => useMixController({ projectId: 'p1' }));
    let ok = false;
    await act(async () => {
      ok = await result.current.applyNow(-2, 0.15);
    });
    expect(ok).toBe(true);
    expect(JSON.parse(String((apiSpy.mock.calls[0][1] as RequestInit).body))).toEqual({
      semitones: -2,
      guide_volume: 0.15,
    });
  });

  it('cancels its timer and request on unmount', () => {
    const signals: AbortSignal[] = [];
    apiSpy.mockImplementation((_url: string | URL, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal);
      return new Promise<Response>(() => {});
    });
    const { result, unmount } = renderHook(() => useMixController({ projectId: 'p1' }));
    act(() => result.current.setSemitones(1));
    act(() => {
      vi.advanceTimersByTime(MIX_DEBOUNCE_MS);
    });
    unmount();
    expect(signals[0].aborted).toBe(true);
  });
});
