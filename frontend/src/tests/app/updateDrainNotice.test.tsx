/**
 * While an update waits for running jobs, everyone using the studio sees a notice that new
 * songs, renders and re-made stems are paused; it goes away once the drain ends.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import type { ServerUpdateStatus } from '../../hooks/useServerUpdatePrompt';
import {
  UPDATE_DRAIN_CHECK_INTERVAL_MS,
  updateDrainMessage,
  useUpdateDrainNotice,
} from '../../hooks/useUpdateDrainNotice';

let health: ServerUpdateStatus | Error = { draining: false, active_jobs: 0 };
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  if (health instanceof Error) throw health;
  return new Response(JSON.stringify(health), { status: 200 });
});

let visibility: DocumentVisibilityState = 'visible';

function Probe() {
  useUpdateDrainNotice();
  return null;
}

function renderInBuiltPage(built = true) {
  if (built) {
    const script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', '/assets/index-abc123.js');
    document.head.appendChild(script);
  }
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>
  );
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

const notice = () => screen.queryByText(/about to update/);

beforeEach(() => {
  vi.useFakeTimers();
  health = { draining: false, active_jobs: 0 };
  visibility = 'visible';
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('script[type="module"]').forEach((s) => s.remove());
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe('updateDrainMessage', () => {
  it('says how many jobs the update waits for', () => {
    expect(updateDrainMessage({ active_jobs: 1 })).toContain('the running job finishes');
    expect(updateDrainMessage({ active_jobs: 3 })).toContain('3 running jobs finish');
    expect(updateDrainMessage({ active_jobs: 0 })).toContain('in a moment');
    expect(updateDrainMessage({})).toContain('your edits still save');
  });
});

describe('useUpdateDrainNotice', () => {
  it('shows nothing while no update waits', async () => {
    renderInBuiltPage();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/health');
    expect(notice()).toBeNull();
  });

  it('shows the notice while draining and removes it once the update is done', async () => {
    health = { draining: true, active_jobs: 2 };
    renderInBuiltPage();
    await settle();

    expect(notice()?.textContent).toContain('2 running jobs finish');

    health = { draining: true, active_jobs: 1 };
    await wait(UPDATE_DRAIN_CHECK_INTERVAL_MS);
    expect(screen.getAllByText(/about to update/)).toHaveLength(1);
    expect(notice()?.textContent).toContain('the running job finishes');

    health = { draining: false, active_jobs: 0 };
    await wait(UPDATE_DRAIN_CHECK_INTERVAL_MS);
    await wait(1000); // the toast's exit animation
    expect(notice()).toBeNull();
  });

  it('keeps the notice while the server restarts', async () => {
    health = { draining: true, active_jobs: 1 };
    renderInBuiltPage();
    await settle();

    health = new Error('offline');
    await wait(UPDATE_DRAIN_CHECK_INTERVAL_MS);

    expect(notice()).not.toBeNull();
  });

  it('does not check from a hidden tab', async () => {
    visibility = 'hidden';
    renderInBuiltPage();
    await wait(UPDATE_DRAIN_CHECK_INTERVAL_MS * 3);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing outside a built page', async () => {
    renderInBuiltPage(false);
    await wait(UPDATE_DRAIN_CHECK_INTERVAL_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
