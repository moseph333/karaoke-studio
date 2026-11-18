/**
 * Switching songs from the command palette with unsaved lyric edits: once the discard
 * prompt is accepted the editor holds the new song's lines, so Save can never post one
 * song's lyrics onto another.
 */
import { loadDeferredScreens } from '../../deferredScreens';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';

const song = (id: string, title: string, lineText: string) => ({
  id,
  title,
  artist: 'The Midnight Static',
  status: 'ready',
  progress: 100,
  created_by: 'Friend',
  master_audio_url: `/static/output/${id}.mp3`,
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

const first = song('first1', 'Neon Skyline', 'Citylights');
const second = song('second2', 'Paper Lanterns', 'Riverboats');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function serve() {
  const saves: { url: string; body: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/api/projects')) return json({ first1: first, second2: second });
      if (url.endsWith('/lyrics')) {
        saves.push({ url, body: String(init?.body ?? '') });
        return json({ status: 'ok' });
      }
      if (url.includes('/api/project/first1')) return json(first);
      if (url.includes('/api/project/second2')) return json(second);
      return json({});
    }
  );
  return saves;
}

const lineButton = (text: string) =>
  screen.queryByRole('button', { name: new RegExp(`Jump to line / Select line: ${text}`) });

beforeAll(() => loadDeferredScreens());

describe('switching songs from the palette with unsaved lyric edits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('opens the other song with its own lines and nothing left to save', async () => {
    const user = userEvent.setup();
    const saves = serve();
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Neon Skyline' }));
    await user.click(await screen.findByRole('button', { name: 'Nudge line 1 0.2s later' }));
    expect(lineButton('Citylights')).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(screen.getByRole('combobox', { name: /search commands/i }), 'Paper');
    await user.click(await screen.findByRole('option', { name: /Paper Lanterns/ }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Paper Lanterns' })
    ).toBeInTheDocument();
    await waitFor(() => expect(lineButton('Riverboats')).toBeInTheDocument());
    expect(lineButton('Citylights')).toBeNull();

    // Nothing of the first song is waiting to be saved onto the second
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(saves).toEqual([]);
  });
});
