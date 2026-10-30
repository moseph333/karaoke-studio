import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { mergePolledProject, useProjectPolling } from '../../hooks/useProjectPolling';
import { useNow } from '../../hooks/useNow';
import { useIsVisible } from '../../hooks/useIsVisible';
import { useWaveformPeaksState } from '../../hooks/useWaveformPeaks';
import { ProcessingView } from '../../components/ProcessingView';
import { WaveformScrubber } from '../../components/audio/WaveformScrubber';
import { ProjectState } from '../../types';

const line = (id: number) => ({
  id,
  text: `line ${id}`,
  start_time: id,
  end_time: id + 1,
  words: [],
});

const project = (fields: Partial<ProjectState> = {}): ProjectState => ({
  id: 'p1',
  status: 'ready',
  progress: 100,
  lines: [line(1), line(2)],
  semitones: 0,
  guide_volume: 0,
  render_status: 'rendering',
  render_progress: 20,
  ...fields,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('mergePolledProject', () => {
  it('keeps unchanged large fields as the same objects, so the editor is not reset', () => {
    const prev = project();
    const next = project({ render_progress: 40, lines: [line(1), line(2)] });

    const merged = mergePolledProject(prev, next);

    expect(merged.render_progress).toBe(40);
    expect(merged.lines).toBe(prev.lines);
  });

  it('takes changed fields and other songs as they come', () => {
    const prev = project();
    const edited = project({ lines: [line(1), line(3)] });
    expect(mergePolledProject(prev, edited).lines).toBe(edited.lines);

    const other = project({ id: 'p2', lines: [line(1), line(2)] });
    expect(mergePolledProject(prev, other)).toBe(other);
  });
});

describe('useProjectPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  const tick = async (ms = 1000) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  it('sends one request at a time on a slow connection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    renderHook(() => useProjectPolling(project()));

    await tick();
    await tick();
    await tick();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the same lines array when a poll returns the same lyrics', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(project({ render_progress: 55 }))
    );
    const { result } = renderHook(() => useProjectPolling(project()));
    const lines = result.current.project?.lines;

    await tick();

    expect(result.current.project?.render_progress).toBe(55);
    expect(result.current.project?.lines).toBe(lines);
  });

  it('drops a reply for a song that is no longer open', async () => {
    let reply: (res: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        reply = resolve;
      })
    );
    const { result } = renderHook(() => useProjectPolling(project()));
    await tick(); // the request for p1 goes out

    act(() => {
      result.current.setProject(project({ id: 'p2', title: 'Next song' }));
    });
    await act(async () => {
      reply(json(project({ title: 'Stale reply' })));
    });

    expect(result.current.project?.id).toBe('p2');
    expect(result.current.project?.title).toBe('Next song');
  });

  it('pauses in a hidden tab and catches up when it is shown again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(project()));
    renderHook(() => useProjectPolling(project()));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    await tick(3000);
    expect(fetchSpy).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('timers that only re-render what they label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('useNow advances while enabled and stops when it is not', () => {
    vi.setSystemTime(1_000_000);
    const { result, rerender } = renderHook(({ on }) => useNow(1000, on), {
      initialProps: { on: true },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(1_003_000);

    rerender({ on: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(1_003_000);
  });

  it('the processing heartbeat counts up between polls', () => {
    vi.setSystemTime(2_000_000);
    render(
      <ProcessingView
        project={project({ status: 'separating', progress: 40, heartbeat: 2_000_000 - 3000 })}
        onCancelProcess={() => {}}
        onResetProject={() => {}}
      />
    );
    expect(screen.getByText(/Pulse 3s ago/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByText(/Pulse 7s ago/)).toBeInTheDocument();
  });
});

describe('waveform peaks and the browser fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports when the peaks request has settled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('busy', { status: 409 }));
    const { result } = renderHook(() => useWaveformPeaksState('p1', true));
    expect(result.current).toEqual({ peaks: null, settled: false });

    await act(async () => {});

    expect(result.current).toEqual({ peaks: null, settled: true });
  });

  it('does not download the audio to decode it while server peaks are pending', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <WaveformScrubber
        currentTime={0}
        duration={120}
        onSeek={() => {}}
        audioUrl="/static/output/p1_master.wav"
        deferDecode
      />
    );
    await act(async () => {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useIsVisible', () => {
  it('follows the IntersectionObserver and starts visible', () => {
    let report: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
    const original = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    try {
      const { result } = renderHook(() => {
        const ref = useRef<HTMLDivElement>(document.createElement('div'));
        return useIsVisible(ref);
      });
      expect(result.current).toBe(true);

      act(() => report([{ isIntersecting: false }]));
      expect(result.current).toBe(false);
      act(() => report([{ isIntersecting: true }]));
      expect(result.current).toBe(true);
    } finally {
      window.IntersectionObserver = original;
    }
  });
});
