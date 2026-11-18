/**
 * A ?project= link whose song cannot be opened: the app says so and takes the song out of
 * the address, so the next song opened gets its own history entry and Back returns to the
 * library. A reply for a song asked for earlier never replaces the one asked for last.
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
  ...summary,
  summary: undefined,
  progress: 100,
  master_audio_url: '/static/output/song1.mp3',
  semitones: 0,
  guide_volume: 0,
  lines: [{ id: 1, text: 'City lights', start_time: 1, end_time: 2, words: [] }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const renderApp = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

const projectInAddress = () => new URLSearchParams(window.location.search).get('project');

beforeAll(() => loadDeferredScreens());

describe('a ?project= link that cannot be opened', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('says why, clears the address, and gives the next song its own history entry', async () => {
    window.history.replaceState(null, '', '/?project=gone&t=12');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/projects')) return json({ song1: summary });
      if (url.endsWith('/api/project/gone')) return json({ detail: 'Project not found' }, 404);
      if (url.endsWith('/api/project/song1')) return json(fullSong);
      return json({});
    });
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(window.location.search).toBe('');

    const entries = window.history.length;
    await user.click(await screen.findByRole('button', { name: 'Neon Skyline' }));
    await screen.findByRole('heading', { level: 1, name: 'Neon Skyline' });
    expect(projectInAddress()).toBe('song1');
    expect(window.history.length).toBe(entries + 1);
  });

  it('opens the later of two songs asked for, whichever reply arrives first', async () => {
    window.history.replaceState(null, '', '/?project=slow');
    let releaseSlow: (res: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/projects')) return Promise.resolve(json({ song1: summary }));
      if (url.endsWith('/api/project/slow')) {
        return new Promise<Response>((resolve) => (releaseSlow = resolve));
      }
      if (url.endsWith('/api/project/song1')) return Promise.resolve(json(fullSong));
      return Promise.resolve(json({}));
    });
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Neon Skyline' }));
    await screen.findByRole('heading', { level: 1, name: 'Neon Skyline' });
    releaseSlow(json({ ...fullSong, id: 'slow', title: 'Slow Reply' }));

    await waitFor(() => expect(projectInAddress()).toBe('song1'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Slow Reply' })).toBeNull();
  });
});
