/**
 * One host screen at a time: a second tab that opens the show says it is open elsewhere and
 * runs nothing, can take the show over (the first tab then waits), and takes over by itself
 * when the first tab closes or dies. Two renders of the app stand for two tabs.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShowApp } from '../../components/show/ShowApp';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import { SHOW_HOST_LOCK } from '../../hooks/useShowHostLock';
import { setAuthToken, setShowToken } from '../../api';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { loadShowResume } from '../../utils/showResume';
import { YT_STATE } from '../../utils/youtube';
import {
  dropFakeLock,
  fakeLockHeld,
  installFakeLocks,
  removeFakeLocks,
} from '../helpers/fakeLocks';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Alex',
    status: 'waiting',
    source: {
      kind: 'youtube',
      videoId: 'a3vO3thiYV4',
      title: 'Dancing Queen',
      artist: 'Zoom Karaoke',
      duration: 200,
    },
  },
];

let status: Record<string, unknown>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  installFakeLocks();
  installFakeYouTube();
  status = { auth_required: false, authenticated: true, show: false };
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/status') return json(status);
      if (url.startsWith('/api/show/videos/')) {
        return json({ embeddable: true, status: 'none', progress: 0, url: null, downloads: true });
      }
      return json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeLocks();
  removeFakeYouTube();
  setAuthToken(null);
  setShowToken(null);
});

/** A tab with the show's address open. */
function openTab() {
  const view = render(
    <ToastProvider>
      <ShowApp />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  const tab = within(view.container);
  return {
    tab,
    close: () => view.unmount(),
    runsTheShow: () => tab.findByRole('heading', { name: 'Add a singer' }),
    isRunning: () => tab.queryByRole('heading', { name: 'Add a singer' }) !== null,
    saysElsewhere: () => tab.findByRole('heading', { name: 'The show is open in another tab' }),
    isElsewhere: () => tab.queryByTestId('show-elsewhere') !== null,
  };
}

function openStageWindow() {
  const view = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  return within(view.container);
}

describe('the only tab with the show open', () => {
  it('runs it', async () => {
    const first = openTab();

    await first.runsTheShow();
    expect(first.isElsewhere()).toBe(false);
    expect(fakeLockHeld(SHOW_HOST_LOCK)).toBe(true);
  });

  it('gives the show up when it closes', async () => {
    const first = openTab();
    await first.runsTheShow();

    first.close();

    await waitFor(() => expect(fakeLockHeld(SHOW_HOST_LOCK)).toBe(false));
  });
});

describe('a second tab that opens the show', () => {
  it('says the show is open in another tab, and runs nothing', async () => {
    const stage = openStageWindow();
    const first = openTab();
    await first.runsTheShow();
    const before = localStorage.getItem(SHOW_QUEUE_STORAGE_KEY);

    const second = openTab();

    await second.saysElsewhere();
    expect(second.isRunning()).toBe(false);
    expect(first.isRunning()).toBe(true);
    // It has written no queue and sent the stage window nothing
    expect(localStorage.getItem(SHOW_QUEUE_STORAGE_KEY)).toBe(before);
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
  });

  it('takes the show over when told to, and the first tab then waits', async () => {
    const first = openTab();
    await first.runsTheShow();
    const second = openTab();
    await second.saysElsewhere();

    fireEvent.click(second.tab.getByRole('button', { name: 'Run the show here' }));

    await second.runsTheShow();
    await first.saysElsewhere();
    expect(first.isRunning()).toBe(false);
  });

  it('can be taken back the same way', async () => {
    const first = openTab();
    await first.runsTheShow();
    const second = openTab();
    await second.saysElsewhere();
    fireEvent.click(second.tab.getByRole('button', { name: 'Run the show here' }));
    await first.saysElsewhere();

    fireEvent.click(first.tab.getByRole('button', { name: 'Run the show here' }));

    await first.runsTheShow();
    await second.saysElsewhere();
  });

  it('takes over by itself when the first tab closes', async () => {
    const first = openTab();
    await first.runsTheShow();
    const second = openTab();
    await second.saysElsewhere();

    first.close();

    await second.runsTheShow();
    expect(second.isElsewhere()).toBe(false);
  });

  it('takes over by itself when the first tab dies', async () => {
    const first = openTab();
    await first.runsTheShow();
    const second = openTab();
    await second.saysElsewhere();

    // A crashed tab runs no code: the browser gives its lock up
    act(() => dropFakeLock(SHOW_HOST_LOCK));

    await second.runsTheShow();
  });

  it('keeps the stage window on the tab that runs the show', async () => {
    const stage = openStageWindow();
    const first = openTab();
    await first.runsTheShow();
    const second = openTab();
    await second.saysElsewhere();

    fireEvent.click(second.tab.getByRole('button', { name: 'Run the show here' }));
    await second.runsTheShow();
    await first.saysElsewhere();

    // The first tab said it was leaving; the second one's card is what stays up
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
  });
});

describe('a song that is playing when the show is taken over', () => {
  it('has its place kept, and the new tab offers to resume it', async () => {
    openStageWindow();
    const first = openTab();
    await first.runsTheShow();
    fireEvent.click(first.tab.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});
    const player = FakeYouTubePlayer.current!;
    act(() => player.setState(YT_STATE.playing, 81));
    act(() => player.setState(YT_STATE.playing, 83.9));
    expect(loadShowResume()?.time).toBe(81);

    const second = openTab();
    await second.saysElsewhere();
    fireEvent.click(second.tab.getByRole('button', { name: 'Run the show here' }));
    await second.runsTheShow();
    await first.saysElsewhere();

    // Written exactly as the first tab's screen went
    expect(loadShowResume()).toMatchObject({ entryId: 'e1', time: 83.9 });
  });
});

describe('a tab at the sign-in', () => {
  it('does not keep the show from a tab that is signed in', async () => {
    status = { auth_required: true, authenticated: false, show: false };
    render(<ShowApp />, { container: document.body.appendChild(document.createElement('div')) });
    await screen.findByRole('heading', { name: 'Run the show' });

    expect(fakeLockHeld(SHOW_HOST_LOCK)).toBe(false);

    status = { auth_required: true, authenticated: true, show: false, expires_in: 600000 };
    const signedIn = openTab();
    await signedIn.runsTheShow();
  });
});

describe('a browser without the Web Locks API', () => {
  it('runs the show in every tab, as before', async () => {
    removeFakeLocks();
    const first = openTab();
    await first.runsTheShow();

    const second = openTab();

    await second.runsTheShow();
    expect(second.isElsewhere()).toBe(false);
  });
});
