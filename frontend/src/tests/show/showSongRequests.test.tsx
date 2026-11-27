/**
 * Asking for a song on a show's host screen: a song that has no karaoke video and is not in
 * the library is filed as a request with the server, with who asked and the name of the
 * night, and the screen lists what has been asked for.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { ToastProvider } from '../../hooks/useToast';
import type { SearchResult } from '../../types';
import type { SongRequest } from '../../utils/songRequests';

const VIDEO: SearchResult = {
  id: 'a3vO3thiYV4',
  title: 'Somebody Else - Pink Pony Club (Cover)',
  artist: 'A cover channel',
  duration: 201,
  url: 'https://www.youtube.com/watch?v=a3vO3thiYV4',
};

const requestOf = (over: Partial<SongRequest> & { song: string }): SongRequest => ({
  id: over.song.toLowerCase().replace(/\W+/g, '-'),
  singers: [],
  show: '',
  count: 1,
  requested_at: 1_800_000_000,
  ...over,
});

interface Server {
  results: SearchResult[];
  requests: SongRequest[];
  /** What asking for a song answers when it is refused. */
  refusal: { status: number; detail: string } | null;
  calls: { method: string; url: string; body: string }[];
}

let server: Server;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  server = { results: [VIDEO], requests: [], refusal: null, calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      server.calls.push({ method, url, body });
      if (url === '/api/search') return json({ results: server.results });
      if (url.startsWith('/api/projects')) {
        return json({ demo: { id: 'demo', status: 'ready', title: 'Neon Skyline', artist: '' } });
      }
      if (url === '/api/show/requests' && method === 'GET') {
        return json({ requests: server.requests });
      }
      if (url === '/api/show/requests' && method === 'POST') {
        if (server.refusal) return json({ detail: server.refusal.detail }, server.refusal.status);
        const sent = JSON.parse(body) as { song: string; singer?: string; show?: string };
        const known = server.requests.find(
          (request) => request.song.toLowerCase() === sent.song.toLowerCase()
        );
        const request = known
          ? { ...known, count: known.count + 1 }
          : requestOf({
              song: sent.song,
              singers: sent.singer ? [sent.singer] : [],
              show: sent.show ?? '',
            });
        server.requests = [request, ...server.requests.filter((r) => r.id !== request.id)];
        return json({ request, requests: server.requests });
      }
      return json({ detail: 'Not found' }, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openHost() {
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return within(view.container);
}

type Screen = ReturnType<typeof openHost>;

const songBox = (host: Screen) => host.getByLabelText('Song, artist or a YouTube link');
const sentRequests = () =>
  server.calls
    .filter((call) => call.method === 'POST' && call.url === '/api/show/requests')
    .map((call) => JSON.parse(call.body) as Record<string, string>);

async function searchFor(host: Screen, words: string) {
  fireEvent.change(songBox(host), { target: { value: words } });
  fireEvent.click(host.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(host.queryByText('Searching YouTube')).toBeNull());
}

const requestButton = (host: Screen, song: string) =>
  host.findByRole('button', { name: `Request the song ${song}` });

describe('asking for a song the show could not find', () => {
  it('offers nothing to ask for before the song has been looked for', () => {
    const host = openHost();

    fireEvent.change(songBox(host), { target: { value: 'pink pony club' } });

    expect(host.queryByRole('button', { name: /Request the song/ })).toBeNull();
  });

  it('files the typed words with the singer and the name of the night', async () => {
    const host = openHost();
    fireEvent.change(host.getByLabelText('Name of the night'), {
      target: { value: 'Friday at Sluggos' },
    });
    fireEvent.change(host.getByLabelText('Singer'), { target: { value: ' Ana ' } });
    await searchFor(host, '  Pink  Pony Club ');
    expect(host.getByText(/None of these\?/)).toBeInTheDocument();

    fireEvent.click(await requestButton(host, 'Pink Pony Club'));

    await waitFor(() =>
      expect(sentRequests()).toEqual([
        { song: 'Pink Pony Club', singer: 'Ana', show: 'Friday at Sluggos' },
      ])
    );
    expect(await host.findByText('“Pink Pony Club” is on the request list')).toBeInTheDocument();
    // Nobody was queued: there is nothing to sing
    expect(host.queryAllByTestId('show-queue-row')).toHaveLength(0);
  });

  it('lists the song under Requested songs and clears the form for the next singer', async () => {
    const host = openHost();
    fireEvent.change(host.getByLabelText('Singer'), { target: { value: 'Ana' } });
    await searchFor(host, 'Pink Pony Club');

    fireEvent.click(await requestButton(host, 'Pink Pony Club'));

    const list = await host.findByTestId('show-requests');
    expect(within(list).getByText('Pink Pony Club')).toBeInTheDocument();
    expect(within(list).getByText('Asked for by Ana · Karaoke night')).toBeInTheDocument();
    expect(host.getByRole('heading', { name: /Requested songs/ })).toHaveTextContent('1');
    expect(songBox(host)).toHaveValue('');
    expect(host.getByLabelText('Singer')).toHaveValue('');
    expect(host.queryByTestId('show-video-results')).toBeNull();
    expect(host.queryByRole('button', { name: /Request the song/ })).toBeNull();
  });

  it('takes a request without a singer’s name', async () => {
    const host = openHost();
    await searchFor(host, 'Jolene');

    fireEvent.click(await requestButton(host, 'Jolene'));

    await waitFor(() =>
      expect(sentRequests()).toEqual([{ song: 'Jolene', show: 'Karaoke night' }])
    );
    expect(host.queryByText('Type the singer’s name first.')).toBeNull();
  });

  it('offers it when YouTube lists no video at all', async () => {
    server.results = [];
    const host = openHost();

    await searchFor(host, 'an obscure b-side');

    expect(host.getByText(/Not on YouTube\?/)).toBeInTheDocument();
    expect(await requestButton(host, 'an obscure b-side')).toBeInTheDocument();
  });

  it('does not offer to request a pasted video link', async () => {
    const host = openHost();

    await searchFor(host, 'https://www.youtube.com/watch?v=a3vO3thiYV4');

    expect(await host.findByTestId('show-video-results')).toBeInTheDocument();
    expect(host.queryByRole('button', { name: /Request the song/ })).toBeNull();
  });

  it('offers it in the library when no song there matches', async () => {
    const host = openHost();
    fireEvent.click(host.getByRole('tab', { name: 'Library' }));
    await host.findByRole('button', { name: 'Add the song Neon Skyline' });
    const box = host.getByLabelText('Find in the library');

    fireEvent.change(box, { target: { value: 'neon' } });
    expect(host.queryByRole('button', { name: /Request the song/ })).toBeNull();

    fireEvent.change(box, { target: { value: 'Valerie' } });
    expect(host.getByText(/Not in the library\?/)).toBeInTheDocument();
    fireEvent.click(await requestButton(host, 'Valerie'));

    await waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentRequests()[0]).toMatchObject({ song: 'Valerie' });
  });

  it('says how often a song has been asked for when it is asked for again', async () => {
    server.requests = [requestOf({ song: 'Pink Pony Club', singers: ['Ana'], count: 2 })];
    const host = openHost();
    await searchFor(host, 'pink pony club');

    fireEvent.click(await requestButton(host, 'pink pony club'));

    expect(
      await host.findByText('“pink pony club” has now been asked for 3 times')
    ).toBeInTheDocument();
    expect(within(host.getByTestId('show-requests')).getByText(/3 times/)).toBeInTheDocument();
  });

  it('says why a request was refused and keeps what was typed', async () => {
    server.refusal = { status: 409, detail: 'The request list is full.' };
    const host = openHost();
    fireEvent.change(host.getByLabelText('Singer'), { target: { value: 'Ana' } });
    await searchFor(host, 'Jolene');

    fireEvent.click(await requestButton(host, 'Jolene'));

    expect(await host.findByText('The request list is full.')).toBeInTheDocument();
    expect(songBox(host)).toHaveValue('Jolene');
    expect(host.getByLabelText('Singer')).toHaveValue('Ana');
    expect(host.queryByTestId('show-requests')).toBeNull();
  });
});

describe('the requested songs on the host screen', () => {
  it('lists what the server already holds when the screen opens', async () => {
    server.requests = [
      requestOf({ song: 'Valerie', singers: ['Bo', 'Cy'], count: 2, show: 'Friday' }),
      requestOf({ song: 'Jolene' }),
    ];
    const host = openHost();

    const list = await host.findByTestId('show-requests');

    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Asked for by Bo and Cy · 2 times · Friday')).toBeInTheDocument();
    // The host reads the list; taking a song off it is the studio's
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('shows no list while nothing has been asked for', async () => {
    const host = openHost();

    await waitFor(() =>
      expect(server.calls.some((call) => call.url === '/api/show/requests')).toBe(true)
    );

    expect(host.queryByRole('heading', { name: /Requested songs/ })).toBeNull();
  });
});
