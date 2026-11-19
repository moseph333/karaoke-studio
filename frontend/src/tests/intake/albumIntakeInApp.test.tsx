/**
 * Whole albums in the app: an album opens its song list, the picked songs are started and the
 * first one opens, and "Try again" on a failed album song cuts it out of the album again
 * rather than pasting the album's link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const album = {
  id: 'AlbumVid001',
  track_id: 'AlbumVid001',
  url: 'https://www.youtube.com/watch?v=AlbumVid001',
  status: 'album',
  progress: 100,
  title: 'Seasick',
  artist: 'Imperial Teen',
  lines: [],
  album: {
    kind: 'link',
    title: 'Seasick',
    artist: 'Imperial Teen',
    duration: 400,
    source: 'chapters',
    tracks: [],
  },
};

const listing = {
  id: 'AlbumVid001',
  kind: 'link',
  title: 'Seasick',
  artist: 'Imperial Teen',
  duration: 400,
  source: 'chapters',
  whole_allowed: true,
  tracks: [
    { number: 1, title: 'Imperial Teen', start: 0, end: 200, named: true },
    { number: 2, title: 'Water Boy', start: 200, end: 400, named: true },
  ],
};

function renderApp() {
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}

describe('whole albums in the app', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an album as its song list and starts the picked songs, opening the first', async () => {
    window.history.replaceState(null, '', '/?project=AlbumVid001');
    const started: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes('/album/songs')) {
          started.push(JSON.parse(String(init?.body)));
          return json({
            projects: [
              { project_id: 'AlbumVid001-t01', number: 1, status: 'queued' },
              { project_id: 'AlbumVid001-t02', number: 2, status: 'queued' },
            ],
          });
        }
        if (url.endsWith('/api/project/AlbumVid001/album')) return json(listing);
        if (url.includes('/api/project/AlbumVid001-t01')) {
          return json({
            id: 'AlbumVid001-t01',
            status: 'separating',
            progress: 40,
            title: 'Imperial Teen',
          });
        }
        if (url.endsWith('/api/project/AlbumVid001')) return json(album);
        if (url.includes('/api/projects')) return json({});
        return json({});
      }
    );
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Seasick' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Pick all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make 2 songs' }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ songs: [{ number: 1 }, { number: 2 }] });
    // The first song's progress screen replaces the list; the toast says where the other is
    expect(await screen.findByText(/2 songs are on their way/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 1, name: 'Seasick' })).toBeNull()
    );
  });

  it('tries a failed album song again by cutting it out of the album again', async () => {
    window.history.replaceState(null, '', '/?project=local_abc123-t03');
    const started: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes('/album/songs') || url.includes('/api/process')) {
          started.push({ url, body: JSON.parse(String(init?.body)) });
          return json({
            projects: [{ project_id: 'local_abc123-t03', number: 3, status: 'queued' }],
          });
        }
        if (url.includes('/api/project/local_abc123-t03')) {
          return json({
            id: 'local_abc123-t03',
            status: 'error',
            error: 'Read timed out.',
            title: 'Third Song',
            created_by: 'Sam',
            separation_quality: 'best',
            lines: [],
            album_track: { album_id: 'local_abc123', number: 3, start: 100, end: 200 },
          });
        }
        if (url.includes('/api/projects')) return json({});
        return json({});
      }
    );
    renderApp();

    const failure = await screen.findByTestId('failure-reason');
    // Not "upload it again": the album it came from is still there
    expect(within(failure.parentElement!).queryByText(/upload it again/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0].url).toContain('/api/project/local_abc123/album/songs');
    expect(started[0].body).toMatchObject({
      songs: [{ number: 3 }],
      created_by: 'Sam',
      separation_quality: 'best',
    });
  });
});
