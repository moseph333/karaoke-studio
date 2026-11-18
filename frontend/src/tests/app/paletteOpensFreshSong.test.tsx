/**
 * The command palette lists songs from a snapshot it keeps for a while. Choosing one
 * fetches the song as the server has it now, so edits saved since the snapshot (on another
 * device, or by a background job) are what the studio opens with.
 */
import { loadDeferredScreens } from '../../deferredScreens';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';

const songWith = (lineText: string) => ({
  id: 'song1',
  title: 'Paper Lanterns',
  artist: 'The Midnight Static',
  status: 'ready',
  progress: 100,
  created_by: 'Friend',
  master_audio_url: '/static/output/song1.mp3',
  semitones: 0,
  guide_volume: 0,
  lines: [
    {
      id: 1,
      text: lineText,
      start_time: 1,
      end_time: 2,
      words: [{ word: lineText, start_time: 1, end_time: 2 }],
    },
  ],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serve(song: () => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = input.toString();
    // The list the palette searched: the song before its lyrics were corrected
    if (url.includes('/api/projects')) return json({ song1: songWith('Oldwords') });
    if (url.includes('/api/project/song1')) return song();
    return json({});
  });
}

async function chooseSongInPalette(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  await user.type(screen.getByRole('combobox', { name: /search commands/i }), 'Paper');
  await user.click(await screen.findByRole('option', { name: /Paper Lanterns/ }));
}

const renderApp = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

beforeAll(() => loadDeferredScreens());

describe('opening a song from the command palette', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('opens the song as the server has it now, not the listed copy', async () => {
    const user = userEvent.setup();
    serve(() => json(songWith('Newwords')));
    renderApp();
    await screen.findByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i });

    await chooseSongInPalette(user);

    expect(
      await screen.findByRole('button', { name: /Jump to line \/ Select line: Newwords/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select line: Oldwords/ })).toBeNull();
  });

  it('says why and stays put when the song is gone', async () => {
    const user = userEvent.setup();
    serve(() => json({ detail: 'Project not found' }, 404));
    renderApp();
    await screen.findByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i });

    await chooseSongInPalette(user);

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /Turn Any Song Into Karaoke/i })
    ).toBeInTheDocument();
  });
});
