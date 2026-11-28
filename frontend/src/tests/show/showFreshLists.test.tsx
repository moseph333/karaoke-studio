/**
 * Lists that keep up with a night: the library tab lists a song finished since it was read,
 * and can be read again when that failed; the requested songs are read again when the host
 * comes back to the window; and a video nobody is waiting for any more is not asked about.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { ToastProvider } from '../../hooks/useToast';
import { useSongRequests } from '../../hooks/useSongRequests';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const MINUTE = 60_000;
const BLOCKED = 'WHayJZ3eMcE';

const songOf = (id: string, title: string) => ({ id, status: 'ready', title, artist: 'The Band' });
const requestOf = (id: string, song: string) => ({
  id,
  song,
  singer: 'Di',
  show: 'Karaoke night',
  count: 1,
  created_at: 0,
  updated_at: 0,
});

interface Server {
  songs: ReturnType<typeof songOf>[];
  /** The library answers 500 while this is set. */
  libraryDown: boolean;
  requests: ReturnType<typeof requestOf>[];
  video: Record<string, unknown>;
  calls: string[];
}

let server: Server;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFakeYouTube();
  server = {
    songs: [songOf('one', 'First Song')],
    libraryDown: false,
    requests: [requestOf('r1', 'Wonderwall')],
    video: { embeddable: false, status: 'fetching', progress: 10, url: null, downloads: true },
    calls: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      server.calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url}`);
      if (url.startsWith('/api/projects')) {
        if (server.libraryDown) return json({ detail: 'down' }, 500);
        return json(Object.fromEntries(server.songs.map((song) => [song.id, song])));
      }
      if (url === '/api/show/requests') return json({ requests: server.requests });
      if (url.startsWith('/api/show/videos/')) return json(server.video);
      return json({});
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeFakeYouTube();
});

function openHost() {
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>
  );
  return within(view.container);
}

type Host = ReturnType<typeof openHost>;

const calls = (what: string) => server.calls.filter((call) => call.startsWith(what)).length;
const libraryReads = () => calls('GET /api/projects');
const openTab = (host: Host, name: string) => fireEvent.click(host.getByRole('tab', { name }));
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const comeBack = () =>
  act(async () => {
    window.dispatchEvent(new Event('focus'));
  });

async function openLibrary(host: Host) {
  openTab(host, 'Library');
  await host.findByRole('button', { name: 'Add the song First Song' });
}

describe('the library tab during a night', () => {
  it('lists a song finished since it was read, when the tab is opened again', async () => {
    const host = openHost();
    await openLibrary(host);
    server.songs.push(songOf('two', 'Made Tonight'));

    await later(MINUTE + 1000);
    openTab(host, 'Karaoke videos');
    openTab(host, 'Library');

    expect(await host.findByRole('button', { name: 'Add the song Made Tonight' })).toBeVisible();
    expect(libraryReads()).toBe(2);
  });

  it('is not read again when it was read a moment ago', async () => {
    const host = openHost();
    await openLibrary(host);

    openTab(host, 'Karaoke videos');
    openTab(host, 'Library');
    await comeBack();

    expect(libraryReads()).toBe(1);
  });

  it('is read again when the host comes back to a window left on it', async () => {
    const host = openHost();
    await openLibrary(host);
    server.songs.push(songOf('two', 'Made Tonight'));
    await later(MINUTE + 1000);

    await comeBack();

    expect(await host.findByRole('button', { name: 'Add the song Made Tonight' })).toBeVisible();
  });

  it('is read again after a singer is queued, so the next one sees what is new', async () => {
    const host = openHost();
    await openLibrary(host);
    server.songs.push(songOf('two', 'Made Tonight'));
    await later(MINUTE + 1000);

    fireEvent.change(host.getByLabelText('Singer'), { target: { value: 'Cy' } });
    fireEvent.click(host.getByRole('button', { name: 'Add the song First Song' }));

    expect(await host.findByRole('button', { name: 'Add the song Made Tonight' })).toBeVisible();
  });

  it('keeps the list it has while it is read again, and when that fails', async () => {
    const host = openHost();
    await openLibrary(host);
    server.libraryDown = true;
    await later(MINUTE + 1000);

    await comeBack();

    await waitFor(() => expect(libraryReads()).toBe(2));
    expect(host.getByRole('button', { name: 'Add the song First Song' })).toBeVisible();
    expect(host.queryByText('The library could not be read.')).toBeNull();
  });
});

describe('a library that could not be read', () => {
  it('says so, and reads it again from a button, without reloading the page', async () => {
    server.libraryDown = true;
    const host = openHost();
    openTab(host, 'Library');
    expect(await host.findByText('The library could not be read.')).toBeVisible();
    expect(host.queryByText(/Reload the page/)).toBeNull();
    server.libraryDown = false;

    fireEvent.click(host.getByRole('button', { name: 'Read it again' }));

    expect(await host.findByRole('button', { name: 'Add the song First Song' })).toBeVisible();
    expect(host.queryByText('The library could not be read.')).toBeNull();
  });

  it('says so again when it still cannot be read', async () => {
    server.libraryDown = true;
    const host = openHost();
    openTab(host, 'Library');
    await host.findByText('The library could not be read.');

    fireEvent.click(host.getByRole('button', { name: 'Read it again' }));

    await waitFor(() => expect(libraryReads()).toBe(2));
    expect(await host.findByText('The library could not be read.')).toBeVisible();
  });
});

describe('the requested songs on the host screen', () => {
  it('are read again when the host comes back to the window', async () => {
    const host = openHost();
    expect(await host.findByText('Wonderwall')).toBeVisible();
    // The owner made the song in the studio, which takes it off the list, and one was added
    server.requests = [requestOf('r2', 'Mr. Brightside')];
    await later(MINUTE);

    await comeBack();

    expect(await host.findByText('Mr. Brightside')).toBeVisible();
    expect(host.queryByText('Wonderwall')).toBeNull();
  });

  it('are not read again for a glance away', async () => {
    const host = openHost();
    await host.findByText('Wonderwall');
    const before = calls('GET /api/show/requests');

    await later(5000);
    await comeBack();

    expect(calls('GET /api/show/requests')).toBe(before);
  });

  it('are left as they are on the studio’s home screen, which asks for no refresh', async () => {
    const view = renderHook(() => useSongRequests());
    await waitFor(() => expect(view.result.current.requests).toHaveLength(1));
    const before = calls('GET /api/show/requests');

    await later(MINUTE);
    await comeBack();

    expect(calls('GET /api/show/requests')).toBe(before);
  });
});

describe('a video’s copy being fetched', () => {
  const entry = (status: ShowQueue[number]['status']): ShowQueue[number] => ({
    id: 'e1',
    singer: 'Alex',
    status,
    source: { kind: 'youtube', videoId: BLOCKED, title: 'Dancing Queen', artist: 'Sing King' },
  });
  const asks = () => calls(`GET /api/show/videos/${BLOCKED}`);

  it('is followed while its singer is waiting', async () => {
    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify([entry('waiting')]));
    openHost();
    await later(100);
    const before = asks();

    await later(6500);

    expect(asks()).toBeGreaterThanOrEqual(before + 3);
  });

  it('is no longer asked about once nobody is waiting for it', async () => {
    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify([entry('waiting')]));
    const host = openHost();
    await later(2500);

    // Taken off, then cleared from the list: the video is nobody's now
    fireEvent.click(host.getByRole('button', { name: 'Take Alex off the queue' }));
    fireEvent.click(host.getByRole('button', { name: 'Clear the list' }));
    fireEvent.click(host.getByRole('button', { name: 'Clear it' }));
    await later(100);
    const before = asks();

    await later(10_000);

    expect(asks()).toBe(before);
  });
});
