/**
 * The library lists card-sized entries (GET /api/projects?summary=1). Choosing a card
 * fetches the song in full before the studio opens; a failure says so and stays put.
 */
import { loadDeferredScreens } from '../../deferredScreens';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';

const summary = {
  id: 'song1',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  status: 'ready',
  created_by: 'Friend',
  summary: true,
};

const fullSong = {
  id: 'song1',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  status: 'ready',
  progress: 100,
  created_by: 'Friend',
  master_audio_url: '/static/output/song1.mp3',
  semitones: 0,
  guide_volume: 0,
  lines: [{ id: 1, text: 'City lights', start_time: 1, end_time: 2, words: [] }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serve(song: () => Response | Promise<Response>) {
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = input.toString();
    requests.push(url);
    if (url.includes('/api/projects')) return json({ song1: summary });
    if (url.endsWith('/api/project/song1')) return song();
    return json({});
  });
  return requests;
}

const renderApp = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

beforeAll(() => loadDeferredScreens());

describe('opening a song from the library', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the whole song, then opens the studio on it', async () => {
    const user = userEvent.setup();
    const requests = serve(() => json(fullSong));
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Neon Skyline' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Neon Skyline' })
    ).toBeInTheDocument();
    expect(requests).toContain('/api/project/song1');
    expect(new URLSearchParams(window.location.search).get('project')).toBe('song1');
  });

  it('marks the card busy while the song is on its way', async () => {
    const user = userEvent.setup();
    let release: (res: Response) => void = () => {};
    serve(() => new Promise<Response>((resolve) => (release = resolve)));
    renderApp();

    const title = await screen.findByRole('button', { name: 'Neon Skyline' });
    await user.click(title);

    const card = title.closest('[aria-busy]');
    expect(card).toHaveAttribute('aria-busy', 'true');
    // Still the library until the song arrives
    expect(
      screen.getByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i })
    ).toBeInTheDocument();

    release(json(fullSong));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Neon Skyline' })
    ).toBeInTheDocument();
  });

  it('says why and stays in the library when the song cannot be fetched', async () => {
    const user = userEvent.setup();
    serve(() => json({ detail: 'Project not found' }, 404));
    renderApp();

    const title = await screen.findByRole('button', { name: 'Neon Skyline' });
    await user.click(title);

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i })
    ).toBeInTheDocument();
    await waitFor(() => expect(title.closest('[aria-busy]')).toBeNull());
  });
});
