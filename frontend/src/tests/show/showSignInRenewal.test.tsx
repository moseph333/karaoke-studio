/**
 * A show sign-in that renews itself: the host screen trades its show token for a new one when
 * it opens and every few hours while it is open, so a venue that runs a show every week is
 * not signed out in the middle of one. The studio's sign-in is left alone.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShowApp } from '../../components/show/ShowApp';
import { AUTH_UNAUTHORIZED_EVENT, getShowToken, setAuthToken, setShowToken } from '../../api';
import { SHOW_RENEW_AFTER_MS } from '../../hooks/useShowAuth';

const RENEW = '/api/auth/show-renew';

interface Server {
  status: Record<string, unknown>;
  /** What a renewal answers: a new token each time, or whatever a test puts here. */
  renew: () => Response;
  calls: { url: string; headers: Headers }[];
}

let server: Server;
let renewals: number;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const venue = { auth_required: true, authenticated: false, show: true, show_authenticated: true };
const owner = { auth_required: true, authenticated: true, show: true, show_authenticated: false };

beforeEach(() => {
  // The clock is the test's to move; it also runs by itself, so the screen's waits end
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renewals = 0;
  server = {
    status: venue,
    renew: () => json({ status: 'ok', token: `renewed-${++renewals}`, expires_in: 604800 }),
    calls: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      server.calls.push({ url, headers: new Headers(init?.headers) });
      if (url === '/api/auth/status') return json(server.status);
      if (url === RENEW) return server.renew();
      if (url === '/api/auth/show-login') return json({ status: 'ok', token: 'signed-in' });
      return json({});
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAuthToken(null);
  setShowToken(null);
});

const renewCalls = () => server.calls.filter((call) => call.url === RENEW);

async function openHost() {
  render(<ShowApp />);
  await screen.findByRole('heading', { name: 'Add a singer' });
}

/** Lets the clock run on, with the screen's timers and their requests. */
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('a host screen opened with a show sign-in', () => {
  it('trades its token for a new one at once', async () => {
    setShowToken('a-week-old');

    await openHost();

    await waitFor(() => expect(getShowToken()).toBe('renewed-1'));
    expect(renewCalls()).toHaveLength(1);
    expect(renewCalls()[0].headers.get('X-Show-Token')).toBe('a-week-old');
  });

  it('keeps the token it has when the server renews nothing', async () => {
    setShowToken('kept');
    server.renew = () => json({ status: 'none' });

    await openHost();

    await waitFor(() => expect(renewCalls()).toHaveLength(1));
    expect(getShowToken()).toBe('kept');
  });

  it('keeps its token and stays open when the server does not answer', async () => {
    setShowToken('kept');
    server.renew = () => {
      throw new TypeError('Failed to fetch');
    };

    await openHost();

    await waitFor(() => expect(renewCalls()).toHaveLength(1));
    expect(getShowToken()).toBe('kept');
    expect(screen.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
  });

  it('is not signed out by a renewal the server refuses', async () => {
    setShowToken('kept');
    server.renew = () => json({ detail: 'refused' }, 401);
    const signedOut = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);

    await openHost();

    await waitFor(() => expect(renewCalls()).toHaveLength(1));
    expect(signedOut).not.toHaveBeenCalled();
    expect(getShowToken()).toBe('kept');
    expect(screen.queryByTestId('show-signed-out')).toBeNull();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
  });
});

describe('a host screen left open', () => {
  it('renews again once its token is some hours old, without being touched', async () => {
    setShowToken('a-week-old');
    await openHost();
    await waitFor(() => expect(getShowToken()).toBe('renewed-1'));

    await later(SHOW_RENEW_AFTER_MS - 60_000);
    expect(renewCalls()).toHaveLength(1);

    await later(31 * 60_000);
    expect(renewCalls()).toHaveLength(2);
    expect(getShowToken()).toBe('renewed-2');
  });

  it('renews when it is come back to after that long', async () => {
    setShowToken('a-week-old');
    await openHost();
    await waitFor(() => expect(getShowToken()).toBe('renewed-1'));

    vi.setSystemTime(Date.now() + SHOW_RENEW_AFTER_MS + 1000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(getShowToken()).toBe('renewed-2'));
  });

  it('does not renew each time it is come back to', async () => {
    setShowToken('a-week-old');
    await openHost();
    await waitFor(() => expect(getShowToken()).toBe('renewed-1'));

    vi.setSystemTime(Date.now() + 60 * 60_000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(renewCalls()).toHaveLength(1);
  });

  it('tries again at the next look when a renewal did not go through', async () => {
    setShowToken('a-week-old');
    server.renew = () => json({ status: 'none' });
    await openHost();
    await waitFor(() => expect(renewCalls()).toHaveLength(1));
    server.renew = () => json({ status: 'ok', token: 'renewed-late' });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(getShowToken()).toBe('renewed-late'));
  });
});

describe('signing in with the show passphrase', () => {
  it('asks for no renewal: the token is new', async () => {
    server.status = { ...venue, show_authenticated: false };
    render(<ShowApp />);
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the host screen' }));
    await screen.findByRole('heading', { name: 'Add a singer' });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(getShowToken()).toBe('signed-in');
    expect(renewCalls()).toHaveLength(0);
  });
});

describe('a host screen opened with the studio sign-in', () => {
  it('renews nothing: only a show sign-in is renewed', async () => {
    server.status = owner;
    setAuthToken('session-token');

    await openHost();
    await later(SHOW_RENEW_AFTER_MS + 31 * 60_000);

    expect(renewCalls()).toHaveLength(0);
  });
});
