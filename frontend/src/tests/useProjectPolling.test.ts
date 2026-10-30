import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mergeProjectStatus, useProjectPolling } from '../hooks/useProjectPolling';
import { LyricLine, ProjectState } from '../types';

const mockBaseProject: ProjectState = {
  id: 'test-proj-1',
  status: 'ready',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0.0,
};

describe('mergeProjectStatus', () => {
  const base: ProjectState = {
    ...mockBaseProject,
    status: 'separating',
    progress: 40,
    status_detail: 'Separating vocals',
    error: 'previous attempt failed',
    separation_job: { id: 'j1', status: 'running', quality: 'best', progress: 5 },
  };

  it('returns the same object when nothing changed', () => {
    const status = {
      id: base.id,
      status: 'separating' as const,
      progress: 40,
      status_detail: 'Separating vocals',
      error: 'previous attempt failed',
      separation_job: {
        id: 'j1',
        status: 'running' as const,
        quality: 'best' as const,
        progress: 5,
      },
    };
    expect(mergeProjectStatus(base, status)).toBe(base);
  });

  it('applies changed fields and leaves the rest of the project alone', () => {
    const merged = mergeProjectStatus(base, { progress: 55, status_detail: 'Almost there' });
    expect(merged).not.toBe(base);
    expect(merged.progress).toBe(55);
    expect(merged.status_detail).toBe('Almost there');
    expect(merged.lines).toBe(base.lines);
    expect(merged.separation_job).toBe(base.separation_job);
  });

  it('maps null to undefined, except for the fields that can be null', () => {
    const merged = mergeProjectStatus(base, { error: null, separation_job: null });
    expect(merged.error).toBeUndefined();
    expect('error' in merged && merged.error === null).toBe(false);
    expect(merged.separation_job).toBeNull();
  });

  it('ignores fields a reply does not carry', () => {
    expect(mergeProjectStatus(base, { id: base.id })).toBe(base);
  });
});

describe('useProjectPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('initializes with given project and computes isWorking=false when ready', () => {
    const { result } = renderHook(() => useProjectPolling(mockBaseProject));

    expect(result.current.project).toEqual(mockBaseProject);
    expect(result.current.isWorking).toBe(false);
  });

  it('computes isWorking=true when pipeline status is separating or downloading', () => {
    const activeProject: ProjectState = {
      ...mockBaseProject,
      status: 'separating',
      progress: 45,
    };

    const { result } = renderHook(() => useProjectPolling(activeProject));

    expect(result.current.isWorking).toBe(true);
  });

  it('keeps polling while the server reports the local-upload "processing" status', () => {
    const { result } = renderHook(() =>
      useProjectPolling({ ...mockBaseProject, status: 'processing', progress: 5 })
    );
    expect(result.current.isWorking).toBe(true);
  });

  it('computes isWorking=true when render_status is rendering', () => {
    const renderingProject: ProjectState = {
      ...mockBaseProject,
      status: 'ready',
      render_status: 'rendering',
      render_progress: 60,
    };

    const { result } = renderHook(() => useProjectPolling(renderingProject));

    expect(result.current.isWorking).toBe(true);
  });

  it('keeps polling while a stem re-separation job is queued or running', () => {
    const job = { id: 'job1', quality: 'best' as const, progress: 10 };
    const running = renderHook(() =>
      useProjectPolling({ ...mockBaseProject, separation_job: { ...job, status: 'running' } })
    );
    expect(running.result.current.isWorking).toBe(true);
    const queued = renderHook(() =>
      useProjectPolling({ ...mockBaseProject, separation_job: { ...job, status: 'queued' } })
    );
    expect(queued.result.current.isWorking).toBe(true);
    for (const status of ['done', 'error', 'cancelled'] as const) {
      const finished = renderHook(() =>
        useProjectPolling({ ...mockBaseProject, separation_job: { ...job, status } })
      );
      expect(finished.result.current.isWorking).toBe(false);
    }
  });

  it('keeps polling while a background lyric re-alignment is queued or running', () => {
    const job = { id: 'sync1', mode: 'lines' as const, progress: 40 };
    for (const status of ['queued', 'running'] as const) {
      const active = renderHook(() =>
        useProjectPolling({ ...mockBaseProject, sync_job: { ...job, status } })
      );
      expect(active.result.current.isWorking).toBe(true);
    }
    for (const status of ['done', 'error', 'cancelled'] as const) {
      const finished = renderHook(() =>
        useProjectPolling({ ...mockBaseProject, sync_job: { ...job, status } })
      );
      expect(finished.result.current.isWorking).toBe(false);
    }
  });

  it('polls /api/project/:id/status every 1000ms while isWorking is true and updates project state', async () => {
    const separatingProject: ProjectState = {
      ...mockBaseProject,
      status: 'separating',
      progress: 30,
    };

    const updatedProject: ProjectState = {
      ...mockBaseProject,
      status: 'mixing',
      progress: 70,
    };

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(updatedProject), { status: 200 }));

    const { result } = renderHook(() => useProjectPolling(separatingProject));

    expect(result.current.isWorking).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance timer by 1000ms to trigger poll
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/project/test-proj-1/status', expect.anything());
    expect(result.current.project?.status).toBe('mixing');
    expect(result.current.project?.progress).toBe(70);
  });

  describe('status replies and finished jobs', () => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const oldLines: LyricLine[] = [
      { id: 1, text: 'Old timing', start_time: 1, end_time: 2, words: [] },
    ];
    const newLines: LyricLine[] = [
      { id: 1, text: 'Old timing', start_time: 1.25, end_time: 2.25, words: [] },
    ];
    const syncJob = { id: 'sync1', mode: 'lines' as const, progress: 40 };
    const realigning: ProjectState = {
      ...mockBaseProject,
      lines: oldLines,
      sync_job: { ...syncJob, status: 'running' },
    };
    const doneStatus = {
      id: 'test-proj-1',
      status: 'ready',
      progress: 100,
      error: null,
      sync_job: { ...syncJob, status: 'done', progress: 100 },
    };
    const doneProject: ProjectState = {
      ...realigning,
      lines: newLines,
      sync_job: { ...syncJob, status: 'done', progress: 100 },
    };
    const poll = () =>
      act(async () => {
        vi.advanceTimersByTime(1000);
      });
    const urls = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map((call) => String(call[0]));

    it('keeps the same project object when a status reply changes nothing', async () => {
      const running = { ...realigning, sync_job: { ...syncJob, status: 'running' as const } };
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        json({ id: 'test-proj-1', status: 'ready', progress: 100, sync_job: running.sync_job })
      );
      const { result } = renderHook(() => useProjectPolling(running));
      const before = result.current.project;
      await poll();
      expect(result.current.project).toBe(before);
    });

    it('fetches the full project once when a job finishes and applies it in one update', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) =>
          String(input).endsWith('/status') ? json(doneStatus) : json(doneProject)
        );
      const seen: Array<ProjectState | null> = [];
      const { result } = renderHook(() => {
        const polling = useProjectPolling(realigning);
        seen.push(polling.project);
        return polling;
      });

      await poll();

      expect(urls(fetchSpy)).toEqual([
        '/api/project/test-proj-1/status',
        '/api/project/test-proj-1',
      ]);
      expect(result.current.project?.sync_job?.status).toBe('done');
      expect(result.current.project?.lines).toEqual(newLines);
      // No render ever showed the finished job with the lines it replaced
      expect(seen.some((p) => p?.sync_job?.status === 'done' && p.lines === oldLines)).toBe(false);

      // Nothing runs any more: polling stops
      await poll();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries the full project on the next poll when it fails', async () => {
      let fullAttempts = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).endsWith('/status')) return json(doneStatus);
        fullAttempts++;
        return fullAttempts === 1 ? json({ detail: 'busy' }, 500) : json(doneProject);
      });
      const { result } = renderHook(() => useProjectPolling(realigning));

      await poll();
      // The job still shows as running, so polling goes on
      expect(result.current.project?.sync_job?.status).toBe('running');
      expect(result.current.isWorking).toBe(true);

      await poll();
      expect(urls(fetchSpy)).toEqual([
        '/api/project/test-proj-1/status',
        '/api/project/test-proj-1',
        '/api/project/test-proj-1/status',
        '/api/project/test-proj-1',
      ]);
      expect(result.current.project?.sync_job?.status).toBe('done');
      expect(result.current.project?.lines).toEqual(newLines);
    });

    it('fetches the full project when the intake pipeline finishes', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) =>
          String(input).endsWith('/status')
            ? json({ id: 'test-proj-1', status: 'ready', progress: 100 })
            : json({ ...mockBaseProject, lines: newLines, master_audio_url: '/static/m.wav' })
        );
      const { result } = renderHook(() =>
        useProjectPolling({ ...mockBaseProject, status: 'aligning', progress: 80 })
      );
      await poll();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.current.project?.status).toBe('ready');
      expect(result.current.project?.master_audio_url).toBe('/static/m.wav');
    });
  });

  it('handles 404 retries and sets project to error after 5 consecutive 404s', async () => {
    const separatingProject: ProjectState = {
      ...mockBaseProject,
      status: 'downloading',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

    const { result } = renderHook(() => useProjectPolling(separatingProject));

    // Advance through 5 polling intervals (5 x 1000ms)
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(result.current.project?.status).toBe('error');
    expect(result.current.project?.error).toContain('Session timed out or server reloaded');
  });

  it('cleans up polling intervals on unmount', () => {
    const separatingProject: ProjectState = {
      ...mockBaseProject,
      status: 'separating',
    };

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useProjectPolling(separatingProject));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
