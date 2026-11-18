/**
 * A song's dialogs (export, edit details, delete, improve stems) belong to the song they
 * were opened over. Leaving the song with one open (the Back button) closes it, so it does
 * not come back over the next song opened.
 */
import { loadDeferredScreens } from '../../deferredScreens';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeAll(() => loadDeferredScreens());

describe("a song's dialogs when the song is left", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/projects')) return json({ song1: summary });
      if (url.endsWith('/api/project/song1')) return json(fullSong);
      return json({});
    });
  });

  const openSong = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Neon Skyline' }));
    await screen.findByRole('heading', { level: 1, name: 'Neon Skyline' });
  };

  const runCommand = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.click(await screen.findByRole('option', { name }));
  };

  it.each([
    ['the export dialog', /Export video, subtitles & stems/],
    ['the edit details dialog', /Edit song details/],
  ])('does not bring %s back over the song opened next', async (_label, command) => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
    await openSong(user);
    await runCommand(user, command);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Back: the song closes under the dialog
    window.history.back();
    await screen.findByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openSong(user);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
