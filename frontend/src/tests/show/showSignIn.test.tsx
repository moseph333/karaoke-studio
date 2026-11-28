/**
 * The host screen's sign-in: it takes the studio passphrase or, where the server has one, the
 * show passphrase a venue's host is given. A show sign-in sends its token in a header of its
 * own and has no way back to the songs.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShowApp } from '../../components/show/ShowApp';
import {
  AUTH_TOKEN_KEY,
  AUTH_UNAUTHORIZED_EVENT,
  SHOW_TOKEN_KEY,
  apiFetch,
  getShowToken,
  setAuthToken,
  setShowToken,
} from '../../api';

interface Server {
  status: Record<string, boolean>;
  showLogin: { status: number; token?: string };
  login: { status: number; token?: string };
  calls: { url: string; headers: Headers; body: string }[];
}

let server: Server;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  server = {
    status: { auth_required: true, authenticated: false, show: true, show_authenticated: false },
    showLogin: { status: 200, token: 'show-token-1' },
    login: { status: 200, token: 'session-token-1' },
    calls: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      server.calls.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      if (url === '/api/auth/status') return json(server.status);
      if (url === '/api/auth/show-login') {
        const { status, token } = server.showLogin;
        return json(status === 200 ? { status: 'ok', token } : { detail: 'refused' }, status);
      }
      if (url === '/api/auth/login') {
        const { status, token } = server.login;
        return json(status === 200 ? { status: 'ok', token } : { detail: 'refused' }, status);
      }
      return json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
  setShowToken(null);
});

const callsTo = (url: string) => server.calls.filter((call) => call.url === url);

async function signInWith(passphrase: string) {
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: 'Open the host screen' }));
}

const hostScreen = () => screen.findByRole('heading', { name: 'Add a singer' });

describe('a server with no passphrase', () => {
  it('opens the host screen at once, with the way back to the songs', async () => {
    server.status = { auth_required: false, authenticated: true, show: false };
    render(<ShowApp />);

    expect(await hostScreen()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the songs' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
  });
});

describe('signing in to the host screen', () => {
  it('asks for a passphrase and says a show passphrase will do', async () => {
    render(<ShowApp />);

    expect(await screen.findByRole('heading', { name: 'Run the show' })).toBeInTheDocument();
    expect(screen.getByText(/show passphrase you were given/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a singer' })).toBeNull();
  });

  it('opens the screen for the show passphrase, with no way back to the songs', async () => {
    render(<ShowApp />);

    await signInWith('  host-of-the-night ');

    expect(await hostScreen()).toBeInTheDocument();
    expect(JSON.parse(callsTo('/api/auth/show-login')[0].body)).toEqual({
      password: 'host-of-the-night',
    });
    expect(localStorage.getItem(SHOW_TOKEN_KEY)).toBe('show-token-1');
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Back to the songs' })).toBeNull();
    // The studio's sign-in was never tried
    expect(callsTo('/api/auth/login')).toHaveLength(0);
  });

  it('takes the studio passphrase too, which keeps the way back', async () => {
    server.showLogin = { status: 401 };
    render(<ShowApp />);

    await signInWith('studio-words');

    expect(await hostScreen()).toBeInTheDocument();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('session-token-1');
    expect(getShowToken()).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the songs' })).toBeInTheDocument();
  });

  it('says so when the passphrase is neither, and stays shut', async () => {
    server.showLogin = { status: 401 };
    server.login = { status: 401 };
    render(<ShowApp />);

    await signInWith('a guess');

    expect(await screen.findByRole('alert')).toHaveTextContent('That passphrase is not right');
    expect(screen.queryByRole('heading', { name: 'Add a singer' })).toBeNull();
    expect(localStorage.getItem(SHOW_TOKEN_KEY)).toBeNull();
  });

  it('says to wait when there have been too many tries', async () => {
    server.showLogin = { status: 429 };
    render(<ShowApp />);

    await signInWith('a guess');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries');
    expect(callsTo('/api/auth/login')).toHaveLength(0);
  });

  it('asks only for the studio passphrase on a server with no show passphrase', async () => {
    server.status = { auth_required: true, authenticated: false, show: false };
    render(<ShowApp />);

    expect(await screen.findByText('Enter the studio passphrase.')).toBeInTheDocument();
    await signInWith('studio-words');

    expect(await hostScreen()).toBeInTheDocument();
    expect(callsTo('/api/auth/show-login')).toHaveLength(0);
  });
});

describe('a browser that is already signed in', () => {
  it('opens for a show sign-in, with no way back to the songs', async () => {
    setShowToken('show-token-kept');
    server.status = {
      auth_required: true,
      authenticated: false,
      show: true,
      show_authenticated: true,
    };
    render(<ShowApp />);

    expect(await hostScreen()).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to the songs' })).toBeNull();
    expect(callsTo('/api/auth/status')[0].headers.get('X-Show-Token')).toBe('show-token-kept');
  });

  it('opens for a studio session, with the way back', async () => {
    server.status = { auth_required: true, authenticated: true, show: true };
    render(<ShowApp />);

    expect(await hostScreen()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the songs' })).toBeInTheDocument();
  });

  it('keeps the screen open once the server says the sign-in has ended, and offers to sign in', async () => {
    server.status = {
      auth_required: true,
      authenticated: false,
      show: true,
      show_authenticated: true,
    };
    render(<ShowApp />);
    await hostScreen();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    });

    // The show is the room's: it is not shut for a passphrase (showSignedOutMidSong.test.tsx)
    expect(screen.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('heading', { name: 'Sign in again' })).toBeInTheDocument();
  });
});

describe('the show token on requests', () => {
  it('goes in its own header, never in the studio’s', async () => {
    setShowToken('show-token-1');

    await apiFetch('/api/projects');

    const { headers } = callsTo('/api/projects')[0];
    expect(headers.get('X-Show-Token')).toBe('show-token-1');
    // The server would count it there as a wrong studio passphrase
    expect(headers.get('X-App-Password')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('is forgotten when the server answers 401', async () => {
    setShowToken('show-token-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ detail: 'Invalid or missing studio passphrase' }, 401))
    );
    const signedOut = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);

    await apiFetch('/api/projects');

    await waitFor(() => expect(signedOut).toHaveBeenCalled());
    expect(getShowToken()).toBeNull();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
  });

  it('is kept when a sign-in try is refused', async () => {
    setShowToken('show-token-1');
    server.login = { status: 401 };

    await apiFetch('/api/auth/login', { method: 'POST' });

    expect(getShowToken()).toBe('show-token-1');
  });
});
