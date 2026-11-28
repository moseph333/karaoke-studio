/**
 * A sign-in that ends while a show is on: the host screen stays, the song on stage keeps
 * playing, and the host signs in again from a line across the top. What the ended sign-in
 * would not load is tried again once the new one is in.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShowApp } from '../../components/show/ShowApp';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import { AUTH_UNAUTHORIZED_EVENT, getShowToken, setAuthToken, setShowToken } from '../../api';
import type { ProjectState } from '../../types';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';

const song = {
  id: 'demo',
  status: 'ready',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  duration: 62,
  master_audio_url: '/static/output/demo_mix.wav',
  lines: [
    {
      id: 1,
      text: 'city lights are humming',
      start_time: 2,
      end_time: 6,
      words: [{ word: 'city', start_time: 2, end_time: 6 }],
    },
  ],
} as unknown as ProjectState;

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Cy',
    status: 'waiting',
    source: {
      kind: 'library',
      projectId: 'demo',
      title: 'Neon Skyline',
      artist: 'The Midnight Static',
    },
  },
];

interface Server {
  /** The server has stopped taking the sign-in: everything but the sign-in answers 401. */
  signedOut: boolean;
  calls: string[];
}

let server: Server;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  server = { signedOut: false, calls: [] };
  setShowToken('show-token-1');
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      server.calls.push(url);
      if (url === '/api/auth/status') {
        return json({
          auth_required: true,
          authenticated: false,
          show: true,
          show_authenticated: true,
        });
      }
      if (url === '/api/auth/show-login') {
        server.signedOut = false;
        return json({ status: 'ok', token: 'show-token-2' });
      }
      if (server.signedOut) return json({ detail: 'Invalid or missing studio passphrase' }, 401);
      if (url === '/api/project/demo') return json(song);
      return json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(null);
  setShowToken(null);
  window.history.replaceState(null, '', '/');
});

async function openShow() {
  const stageView = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const hostView = render(
    <ToastProvider>
      <ShowApp />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  const host = within(hostView.container);
  await host.findByRole('heading', { name: 'Add a singer' });
  return { host, stageRoot: stageView.container };
}

type Host = Awaited<ReturnType<typeof openShow>>['host'];

async function startSong(host: Host) {
  fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
  const audio = (await host.findByTestId('show-audio')) as HTMLAudioElement;
  fireEvent.canPlay(audio);
  fireEvent.play(audio);
  return audio;
}

const endSignIn = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
  });

async function signInAgain(host: Host) {
  fireEvent.click(host.getByRole('button', { name: 'Sign in again' }));
  fireEvent.change(await screen.findByLabelText('Passphrase'), {
    target: { value: 'host-of-the-night' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('a sign-in that ends during a song', () => {
  it('leaves the song playing and its lyrics on the stage', async () => {
    const { host, stageRoot } = await openShow();
    const audio = await startSong(host);
    // Loading the song pauses its element once; what counts is what the sign-out does
    vi.mocked(audio.pause).mockClear();

    endSignIn();

    expect(host.getByTestId('show-audio')).toBe(audio);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(host.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(stageRoot.querySelector('[data-testid="stage-window"]')).toHaveAttribute(
      'data-scene',
      'lyrics'
    );
  });

  it('says so across the top, and asks for nothing until the host is ready', async () => {
    const { host } = await openShow();
    await startSong(host);

    endSignIn();

    expect(host.getByTestId('show-signed-out')).toHaveTextContent('The sign-in has ended');
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    // The queue and the controls are still there to use
    expect(host.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Song is over' })).toBeEnabled();
  });

  it('takes the passphrase from there and carries on', async () => {
    const { host } = await openShow();
    const audio = await startSong(host);
    endSignIn();

    await signInAgain(host);

    await waitFor(() => expect(host.queryByTestId('show-signed-out')).toBeNull());
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(getShowToken()).toBe('show-token-2');
    expect(host.getByTestId('show-audio')).toBe(audio);
  });

  it('can be put off: the dialog closes and the line stays', async () => {
    const { host } = await openShow();
    await startSong(host);
    endSignIn();

    fireEvent.click(host.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('heading', { name: 'Sign in again' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(host.getByTestId('show-signed-out')).toBeInTheDocument();
  });
});

describe('a song the ended sign-in would not load', () => {
  it('says it could not be loaded, keeps the singer on, and offers to try again', async () => {
    const { host } = await openShow();
    server.signedOut = true;

    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));

    expect(await host.findByText('That song could not be loaded.')).toBeInTheDocument();
    expect(host.getByTestId('show-signed-out')).toBeInTheDocument();
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is loaded once the host has signed in again', async () => {
    const { host } = await openShow();
    server.signedOut = true;
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await host.findByText('That song could not be loaded.');

    await signInAgain(host);

    const audio = await host.findByTestId('show-audio');
    expect(audio).toHaveAttribute('src', '/static/output/demo_mix.wav');
    expect(host.queryByText('That song could not be loaded.')).toBeNull();
  });

  it('is loaded by Try again when the server answers once more', async () => {
    const { host } = await openShow();
    server.signedOut = true;
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await host.findByText('That song could not be loaded.');
    server.signedOut = false;

    fireEvent.click(host.getByRole('button', { name: 'Try again' }));

    expect(await host.findByTestId('show-audio')).toBeInTheDocument();
  });
});

describe('the host screen’s address', () => {
  it('is kept as the host screen’s, so a reload made while signed out comes back to it', async () => {
    await openShow();

    expect(new URLSearchParams(window.location.search).has('show')).toBe(true);
  });
});
