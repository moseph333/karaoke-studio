import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectPolling } from '../hooks/useProjectPolling';
import { ProjectState } from '../types';

const mockBaseProject: ProjectState = {
  id: 'test-proj-1',
  status: 'ready',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0.0,
};

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

  it('polls /api/project/:id every 1000ms while isWorking is true and updates project state', async () => {
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/project/test-proj-1', expect.anything());
    expect(result.current.project?.status).toBe('mixing');
    expect(result.current.project?.progress).toBe(70);
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
