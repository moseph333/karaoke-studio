/**
 * The home screen's requests: the songs a show asked for and could not find are listed for
 * the owner, "Find it" puts a request's words in the song search, starting a song from that
 * search takes the request off the list, and a request can be removed without making it.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as apiModule from '../../api';
import { TrackSearch } from '../../components/TrackSearch';
import type { SongSearchResult } from '../../types';
import type { SongRequest } from '../../utils/songRequests';

const requestOf = (over: Partial<SongRequest> & { id: string; song: string }): SongRequest => ({
  singers: [],
  show: '',
  count: 1,
  requested_at: 0,
  ...over,
});

const PINK_PONY = requestOf({
  id: 'r1',
  song: 'Pink Pony Club',
  singers: ['Ana', 'Bo'],
  count: 2,
  show: 'Friday at Sluggos',
});
const JOLENE = requestOf({ id: 'r2', song: 'Jolene' });

const FOUND: SongSearchResult = {
  id: 'deezer-9',
  title: 'Pink Pony Club',
  artist: 'Chappell Roan',
  url: 'https://www.deezer.com/track/9',
  album: '',
  year: 2020,
  duration: 258,
  preview: null,
  explicit: false,
  versions: [],
  project_id: null,
  project_status: null,
} as SongSearchResult;

interface Server {
  requests: SongRequest[] | unknown;
  /** What removing a request answers when it fails. */
  removal: { status: number; detail: string } | null;
  removed: string[];
  searched: string[];
}

let server: Server;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  server = { requests: [PINK_PONY, JOLENE], removal: null, removed: [], searched: [] };
  vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/show/requests') {
      return Array.isArray(server.requests)
        ? json({ requests: server.requests })
        : json(server.requests);
    }
    const removal = path.match(/^\/api\/show\/requests\/(.+)$/);
    if (removal && method === 'DELETE') {
      if (server.removal) return json({ detail: server.removal.detail }, server.removal.status);
      server.removed.push(removal[1]);
      server.requests = (server.requests as SongRequest[]).filter((r) => r.id !== removal[1]);
      return json({ requests: server.requests });
    }
    if (path.includes('/api/search/songs')) {
      server.searched.push((JSON.parse(String(init?.body ?? '{}')) as { query: string }).query);
      return json({ results: [FOUND], corrected: null, sources: ['deezer'] });
    }
    return json({});
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderHome() {
  const onSelectTrack = vi.fn();
  render(<TrackSearch onSelectTrack={onSelectTrack} isLoading={false} />);
  const box = screen.getByRole('textbox', { name: /Search for a song or artist/i });
  return { box, onSelectTrack };
}

const requestsSection = () => screen.findByTestId('song-requests');

describe('the requests on the home screen', () => {
  it('lists the songs asked for, with who asked, how often and where', async () => {
    renderHome();

    const section = await requestsSection();

    expect(within(section).getByRole('heading', { name: /Requests/ })).toHaveTextContent('2');
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('Pink Pony Club')).toBeInTheDocument();
    expect(
      within(section).getByText('Asked for by Ana and Bo · 2 times · Friday at Sluggos')
    ).toBeInTheDocument();
  });

  it('shows nothing while no song is asked for', async () => {
    server.requests = [];
    renderHome();

    await waitFor(() => expect(apiModule.apiFetch).toHaveBeenCalledWith('/api/show/requests'));

    expect(screen.queryByTestId('song-requests')).toBeNull();
  });

  it('shows nothing when the server answers something else', async () => {
    server.requests = { demo: { id: 'demo' } };
    renderHome();

    await waitFor(() => expect(apiModule.apiFetch).toHaveBeenCalledWith('/api/show/requests'));

    expect(screen.queryByTestId('song-requests')).toBeNull();
  });

  it('puts a request’s words in the song search and searches them', async () => {
    const { box } = renderHome();
    await requestsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Find the requested song Pink Pony Club' }));

    expect(box).toHaveValue('Pink Pony Club');
    expect(box).toHaveFocus();
    await waitFor(() => expect(server.searched).toEqual(['Pink Pony Club']));
    // Looking is not making: the request stays until a song is started
    expect(server.removed).toEqual([]);
  });

  it('takes the request off the list when a song is started from its search', async () => {
    const { onSelectTrack } = renderHome();
    await requestsSection();
    fireEvent.click(screen.getByRole('button', { name: 'Find the requested song Pink Pony Club' }));

    fireEvent.click(await screen.findByRole('button', { name: /^Create Karaoke: Pink Pony Club/ }));

    expect(onSelectTrack).toHaveBeenCalledWith(FOUND.url, undefined);
    await waitFor(() => expect(server.removed).toEqual(['r1']));
    await waitFor(() =>
      expect(within(screen.getByTestId('song-requests')).getAllByRole('listitem')).toHaveLength(1)
    );
    expect(screen.queryByText('Asked for by Ana and Bo · 2 times · Friday at Sluggos')).toBeNull();
  });

  it('keeps the request when the song started is of other words', async () => {
    const { box, onSelectTrack } = renderHome();
    await requestsSection();
    fireEvent.click(screen.getByRole('button', { name: 'Find the requested song Pink Pony Club' }));
    await screen.findByRole('button', { name: /^Create Karaoke: Pink Pony Club/ });

    fireEvent.change(box, { target: { value: 'pink pony' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Create Karaoke: Pink Pony Club/ }));

    expect(onSelectTrack).toHaveBeenCalled();
    expect(server.removed).toEqual([]);
  });

  it('removes a request that will not be made', async () => {
    renderHome();
    await requestsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the request for Jolene' }));

    await waitFor(() => expect(server.removed).toEqual(['r2']));
    await waitFor(() => expect(screen.queryByText('Jolene')).toBeNull());
    expect(screen.getByText('Pink Pony Club')).toBeInTheDocument();
  });

  it('takes the list away with its last request', async () => {
    server.requests = [JOLENE];
    renderHome();
    await requestsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the request for Jolene' }));

    await waitFor(() => expect(screen.queryByTestId('song-requests')).toBeNull());
  });

  it('says why a request could not be removed and keeps it listed', async () => {
    server.removal = { status: 507, detail: 'The disk is full.' };
    renderHome();
    await requestsSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the request for Jolene' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The disk is full.');
    expect(screen.getByText('Jolene')).toBeInTheDocument();
  });
});
