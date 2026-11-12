/**
 * "Update now": when the server says a host service applies updates (self_update) and GitHub's
 * main is ahead of the running build, the studio offers to start the update.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import {
  SERVER_UPDATE_CHECK_INTERVAL_MS,
  SERVER_UPDATE_FAILED_MESSAGE,
  SERVER_UPDATE_MIN_GAP_MS,
  SERVER_UPDATE_SIGN_IN_MESSAGE,
  SERVER_UPDATE_STARTED_MESSAGE,
  ServerUpdateStatus,
  serverUpdateMessage,
  useServerUpdatePrompt,
} from '../../hooks/useServerUpdatePrompt';

const AVAILABLE: ServerUpdateStatus = {
  self_update: true,
  update_available: true,
  updating: false,
  latest_version: 'v2.2.0 (616d179)',
  remote_commit: '616d179',
};
const OFFER = serverUpdateMessage(AVAILABLE);

let health: ServerUpdateStatus | Error = AVAILABLE;
let updateStatus = 200;
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.startsWith('/api/system/update')) {
    return new Response('{}', { status: updateStatus });
  }
  if (health instanceof Error) throw health;
  return new Response(JSON.stringify(health), { status: 200 });
});

let visibility: DocumentVisibilityState = 'visible';

function Probe() {
  useServerUpdatePrompt();
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

async function tabBecomesVisible() {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
}

const healthCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/health')).length;

beforeEach(() => {
  vi.useFakeTimers();
  health = AVAILABLE;
  updateStatus = 200;
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

describe('serverUpdateMessage', () => {
  it('names the version when the server knows it', () => {
    expect(serverUpdateMessage({ latest_version: 'v2.3.0' })).toContain('v2.3.0');
    expect(serverUpdateMessage({})).toBe('A new version of Karaoke Studio is available.');
  });
});

describe('useServerUpdatePrompt', () => {
  it('does nothing outside a built page', async () => {
    renderInBuiltPage(false);
    await wait(SERVER_UPDATE_CHECK_INTERVAL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the server for a remote check on load and offers Update now', async () => {
    renderInBuiltPage();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health?check_remote=1',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(screen.getByText(OFFER)).toBeInTheDocument();
  });

  it('starts the update and confirms it', async () => {
    renderInBuiltPage();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await settle();

    const post = fetchMock.mock.calls.find(([url]) => url === '/api/system/update');
    expect(post?.[1]?.method).toBe('POST');
    expect(post?.[1]?.body).toBe(JSON.stringify({ action: 'update' }));
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();
    expect(screen.getByText(SERVER_UPDATE_STARTED_MESSAGE)).toBeInTheDocument();

    // No further checks or offers from this tab once the update is under way
    await wait(SERVER_UPDATE_CHECK_INTERVAL_MS);
    expect(healthCalls()).toBe(1);
  });

  it.each([
    ['the server has no update service', { ...AVAILABLE, self_update: false }],
    ['the build is current', { ...AVAILABLE, update_available: false }],
    ['an update is already running', { ...AVAILABLE, updating: true }],
  ])('stays quiet when %s', async (_label, status) => {
    health = status;
    renderInBuiltPage();
    await settle();
    expect(healthCalls()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
  });

  it('stays quiet while the server cannot be reached', async () => {
    health = new TypeError('Failed to fetch');
    renderInBuiltPage();
    await settle();
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
  });

  it('asks to sign in when the update is refused, and offers it again later', async () => {
    updateStatus = 401;
    renderInBuiltPage();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await settle();
    expect(screen.getByText(SERVER_UPDATE_SIGN_IN_MESSAGE)).toBeInTheDocument();

    await wait(SERVER_UPDATE_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(screen.getByText(OFFER)).toBeInTheDocument();
  });

  it('reports a failed request', async () => {
    updateStatus = 500;
    renderInBuiltPage();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    await settle();
    expect(screen.getByText(SERVER_UPDATE_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('offers each remote commit once and replaces the offer for a newer one', async () => {
    renderInBuiltPage();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    await wait(SERVER_UPDATE_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(healthCalls()).toBe(2);
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument();

    health = { ...AVAILABLE, remote_commit: 'abcdef0', latest_version: 'v2.2.0 (abcdef0)' };
    await wait(SERVER_UPDATE_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(screen.getAllByRole('button', { name: 'Update now' })).toHaveLength(1);

    health = { ...AVAILABLE, remote_commit: '1234567', latest_version: 'v2.2.0 (1234567)' };
    await wait(SERVER_UPDATE_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(screen.getAllByRole('button', { name: 'Update now' })).toHaveLength(1);
  });

  it('does not repeat the remote check when the tab returns within two minutes', async () => {
    health = { ...AVAILABLE, update_available: false };
    renderInBuiltPage();
    await settle();
    await tabBecomesVisible();
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(healthCalls()).toBe(1);
  });

  it('checks every 10 minutes while visible and never while hidden', async () => {
    health = { ...AVAILABLE, update_available: false };
    renderInBuiltPage();
    await settle();
    await wait(SERVER_UPDATE_CHECK_INTERVAL_MS);
    expect(healthCalls()).toBe(2);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(SERVER_UPDATE_CHECK_INTERVAL_MS * 2);
    expect(healthCalls()).toBe(2);
  });
});
