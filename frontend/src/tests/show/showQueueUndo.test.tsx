/**
 * Taking back what the host did by hand: a singer taken off the queue, a song skipped, a
 * song ended. Each says what happened in a toast with Undo; an undone song is called again
 * and can be resumed where it was. While a song is on, the queue's rows start nobody.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { YT_STATE } from '../../utils/youtube';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const entry = (id: string, singer: string, title: string): ShowQueue[number] => ({
  id,
  singer,
  status: 'waiting',
  source: {
    kind: 'youtube',
    videoId: 'a3vO3thiYV4',
    title,
    artist: 'Zoom Karaoke',
    duration: 200,
  },
});

const queue: ShowQueue = [
  entry('e1', 'Alex', 'Dancing Queen'),
  entry('e2', 'Bo', 'Waterloo'),
  entry('e3', 'Cy', 'Fernando'),
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  installFakeYouTube();
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/show/videos/')
        ? json({ embeddable: true, status: 'none', progress: 0, url: null, downloads: true })
        : json({})
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeYouTube();
});

function openShow() {
  render(<StageWindow />, { container: document.body.appendChild(document.createElement('div')) });
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return within(view.container);
}

type Host = ReturnType<typeof openShow>;

const waiting = (host: Host) =>
  host.queryAllByTestId('show-queue-row').map((row) => row.textContent ?? '');
const sung = (host: Host) => host.queryByTestId('show-sung')?.textContent ?? '';
/** Toasts are drawn outside the screen's own element. */
const undo = () => screen.getAllByRole('button', { name: 'Undo' });

async function startFirst(host: Host, at: number) {
  fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
  await act(async () => {});
  const player = FakeYouTubePlayer.current!;
  act(() => player.setState(YT_STATE.playing, at));
  return player;
}

describe('a singer taken off the queue', () => {
  it('is listed with those who have been on, not lost', () => {
    const host = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Take Bo off the queue' }));

    expect(waiting(host).join()).not.toContain('Bo');
    expect(sung(host)).toContain('Bo');
    expect(host.getByRole('button', { name: 'Put Bo back in the queue' })).toBeInTheDocument();
  });

  it('says so, with a way to undo it', () => {
    const host = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Take Bo off the queue' }));

    expect(screen.getByText('Bo is off the queue')).toBeInTheDocument();
    expect(undo()).toHaveLength(1);
  });

  it('goes back where they stood when it is undone', () => {
    const host = openShow();
    fireEvent.click(host.getByRole('button', { name: 'Take Bo off the queue' }));

    fireEvent.click(undo()[0]);

    expect(waiting(host).map((row) => row.match(/Alex|Bo|Cy/)?.[0])).toEqual(['Alex', 'Bo', 'Cy']);
    expect(sung(host)).not.toContain('Bo');
  });

  it('is undone on its own when two were taken off', () => {
    const host = openShow();
    fireEvent.click(host.getByRole('button', { name: 'Take Alex off the queue' }));
    fireEvent.click(host.getByRole('button', { name: 'Take Cy off the queue' }));
    expect(undo()).toHaveLength(2);

    // The older toast's Undo: Cy stays off
    fireEvent.click(undo()[0]);

    expect(waiting(host).map((row) => row.match(/Alex|Bo|Cy/)?.[0])).toEqual(['Alex', 'Bo']);
    expect(sung(host)).toContain('Cy');
  });
});

describe('a song ended by hand', () => {
  it('says so, with a way to undo it', async () => {
    const host = openShow();
    await startFirst(host, 83);

    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));

    expect(screen.getByText('Alex’s song is over')).toBeInTheDocument();
    expect(sung(host)).toContain('Alex');
    expect(undo()).toHaveLength(1);
  });

  it('calls the singer again when undone, and offers to resume where the song was', async () => {
    const host = openShow();
    await startFirst(host, 83);
    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));

    fireEvent.click(undo()[0]);

    expect(host.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(sung(host)).not.toContain('Alex');
    expect(host.getByRole('button', { name: 'Resume at 1:23' })).toBeInTheDocument();
  });

  it('resumes on the stage from there', async () => {
    const host = openShow();
    await startFirst(host, 83);
    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));
    fireEvent.click(undo()[0]);

    fireEvent.click(host.getByRole('button', { name: 'Resume at 1:23' }));
    await act(async () => {});

    expect(FakeYouTubePlayer.current!.options.playerVars?.start).toBe(83);
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();
  });

  it('offers no undo when the song ran to its end by itself', async () => {
    const host = openShow();
    const player = await startFirst(host, 83);

    act(() => player.setState(YT_STATE.ended, 200));

    expect(sung(host)).toContain('Alex');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('a song skipped', () => {
  it('says so, and is called again when undone', async () => {
    const host = openShow();
    await startFirst(host, 40);

    fireEvent.click(host.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Alex skipped')).toBeInTheDocument();

    fireEvent.click(undo()[0]);

    expect(host.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Resume at 0:40' })).toBeInTheDocument();
  });

  it('is undone as the next to sing even after the next singer has started', async () => {
    const host = openShow();
    await startFirst(host, 40);
    fireEvent.click(host.getByRole('button', { name: 'Skip' }));
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    fireEvent.click(undo()[0]);

    // Bo keeps the stage; Alex waits at the head of the line, from the top
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();
    expect(waiting(host)[0]).toContain('Alex');
  });
});

describe('the queue while a song is on', () => {
  it('starts nobody from its rows: the song is ended or skipped first', async () => {
    const host = openShow();
    expect(host.getByRole('button', { name: 'Start Bo' })).toBeInTheDocument();

    await startFirst(host, 10);

    expect(host.queryByRole('button', { name: /^Start (Bo|Cy)/ })).toBeNull();
    // The rows still move and come off
    expect(host.getByRole('button', { name: 'Move Cy up' })).toBeEnabled();
    expect(host.getByRole('button', { name: 'Take Bo off the queue' })).toBeInTheDocument();
  });

  it('offers Start on its rows again once nobody is on', async () => {
    const host = openShow();
    await startFirst(host, 10);

    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));

    expect(host.getByRole('button', { name: 'Start Cy' })).toBeInTheDocument();
  });
});
