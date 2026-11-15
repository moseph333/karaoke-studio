import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  MAX_POLL_BACKOFF_MS,
  pollBackoffMs,
  useProjectPolling,
} from '../../hooks/useProjectPolling';
import { setAuthToken } from '../../api';
import { ProjectState } from '../../types';

const running: ProjectState = {
  id: 'backoff-1',
  status: 'separating',
  progress: 30,
  lines: [],
  semitones: 0,
  guide_volume: 0,
};

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const statusCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([url]) => String(url).endsWith('/status')).length;

describe('project polling after failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    setAuthToken('token-a');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    setAuthToken(null);
  });

  it('keeps the 1 s pace for two failures, then waits 2, 4 and 8 seconds, at most 15', () => {
    expect([0, 1, 2].map(pollBackoffMs)).toEqual([0, 0, 0]);
    expect([3, 4, 5, 6, 12].map(pollBackoffMs)).toEqual([
      2000,
      4000,
      8000,
      MAX_POLL_BACKOFF_MS,
      MAX_POLL_BACKOFF_MS,
    ]);
  });

  it('backs off on server errors instead of asking every second', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }));
    renderHook(() => useProjectPolling(running));

    for (let second = 0; second < 3; second++) await tick(1000); // three failures, 1 s apart
    expect(statusCalls(fetchSpy)).toBe(3);
    await tick(1000); // within the 2 s backoff: skipped
    expect(statusCalls(fetchSpy)).toBe(3);
    await tick(1000); // 2 s after the third failure: polls (and fails) again
    expect(statusCalls(fetchSpy)).toBe(4);
    await tick(3000); // within the 4 s backoff
    expect(statusCalls(fetchSpy)).toBe(4);
    await tick(1000);
    expect(statusCalls(fetchSpy)).toBe(5);
  });

  it('says the server had a problem, not that the network dropped', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }));
    const { result } = renderHook(() => useProjectPolling(running));
    for (let second = 0; second < 30; second++) await tick(1000);
    expect(result.current.isReconnecting).toBe(true);
    expect(result.current.project?.status_detail).toContain('server had a problem');
  });

  it('goes back to every second after a success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify(running), { status: 200 }));
    renderHook(() => useProjectPolling(running));

    for (let second = 0; second < 3; second++) await tick(1000); // three failures
    await tick(2000); // succeeds after the backoff
    const afterRecovery = statusCalls(fetchSpy);
    await tick(1000);
    expect(statusCalls(fetchSpy)).toBe(afterRecovery + 1);
  });

  it('pauses on 401 until a new sign-in stores another token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValue(new Response(JSON.stringify(running), { status: 200 }));
    renderHook(() => useProjectPolling(running));

    await tick(1000); // 401: apiFetch clears the token and asks for a sign-in
    expect(statusCalls(fetchSpy)).toBe(1);
    await tick(10_000);
    expect(statusCalls(fetchSpy)).toBe(1);

    setAuthToken('token-b'); // signed in again
    await tick(1000);
    expect(statusCalls(fetchSpy)).toBe(2);
  });
});
