/**
 * A studio sign-in that would end during the night: the host screen asks for the passphrase
 * when it opens, before anybody is singing, and can be told to carry on without. A show
 * sign-in is never asked for this way (it renews itself).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShowApp } from '../../components/show/ShowApp';
import { AUTH_TOKEN_KEY, setAuthToken, setShowToken } from '../../api';

const HOUR = 60 * 60;

let status: Record<string, unknown>;
let calls: { url: string; body: string }[];

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });

const owner = (expiresIn: number | null) => ({
  auth_required: true,
  authenticated: true,
  show: true,
  show_authenticated: false,
  expires_in: expiresIn,
  show_expires_in: null,
});

beforeEach(() => {
  status = owner(3 * HOUR);
  calls = [];
  setAuthToken('session-token-old');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      if (url === '/api/auth/status') return json(status);
      if (url === '/api/auth/show-login') return json({ detail: 'refused' }, 401);
      if (url === '/api/auth/login') return json({ status: 'ok', token: 'session-token-new' });
      return json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
  setShowToken(null);
});

const asked = () => screen.queryByRole('heading', { name: 'Sign in for tonight' });

/** The host screen is mounted (a dialog over it hides its headings from role queries). */
async function opened() {
  await waitFor(() => expect(document.getElementById('show-queue-heading')).not.toBeNull());
}

describe('a host screen opened with a studio sign-in that ends tonight', () => {
  it('asks for the passphrase first, and says how soon the sign-in ends', async () => {
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Sign in for tonight' })).toBeInTheDocument();
    expect(screen.getByText(/ends in about 3 hours/)).toBeInTheDocument();
    // The screen is open behind it: nothing is held up
    await opened();
  });

  it('signs in for another week and does not ask again', async () => {
    render(<ShowApp />);
    fireEvent.change(await screen.findByLabelText('Passphrase'), {
      target: { value: 'studio-words' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(asked()).toBeNull());
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('session-token-new');
    expect(screen.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the songs' })).toBeInTheDocument();
  });

  it('carries on without when told to, with the sign-in it has', async () => {
    render(<ShowApp />);
    await screen.findByRole('heading', { name: 'Sign in for tonight' });

    fireEvent.click(screen.getByRole('button', { name: 'Carry on without' }));

    expect(asked()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('session-token-old');
    expect(calls.some((call) => call.url === '/api/auth/login')).toBe(false);
  });

  it('stays open on a wrong passphrase and says so', async () => {
    render(<ShowApp />);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/auth/status') return json(status);
        // Only the sign-in is refused: the session in hand still works
        return url.startsWith('/api/auth/') ? json({ detail: 'refused' }, 401) : json({});
      })
    );
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a guess' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That passphrase is not right');
    expect(asked()).not.toBeNull();
  });

  it.each([
    [20 * 60, 'in less than an hour'],
    [HOUR + 5 * 60, 'in about an hour'],
    [11 * HOUR, 'in about 11 hours'],
  ])('says a sign-in with %i seconds left ends %s', async (seconds, words) => {
    status = owner(seconds);
    render(<ShowApp />);

    await screen.findByRole('heading', { name: 'Sign in for tonight' });
    expect(screen.getByText(new RegExp(`ends ${words}`))).toBeInTheDocument();
  });
});

describe('a host screen that is not asked', () => {
  it('opens at once when the studio sign-in has days left', async () => {
    status = owner(2 * 24 * HOUR);
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(asked()).toBeNull();
  });

  it('opens at once for a sign-in that does not run out (the passphrase itself)', async () => {
    status = owner(null);
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(asked()).toBeNull();
  });

  it('opens at once on a server with no passphrase', async () => {
    status = { auth_required: false, authenticated: true, show: false, expires_in: null };
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(asked()).toBeNull();
  });

  it('opens at once for a show sign-in near its end, which renews itself instead', async () => {
    setAuthToken(null);
    setShowToken('show-token-old');
    status = {
      auth_required: true,
      authenticated: false,
      show: true,
      show_authenticated: true,
      expires_in: null,
      show_expires_in: 2 * HOUR,
    };
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(asked()).toBeNull();
    await waitFor(() =>
      expect(calls.some((call) => call.url === '/api/auth/show-renew')).toBe(true)
    );
  });
});
