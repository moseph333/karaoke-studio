/**
 * Whether the stage window is still there. A window that closes says so; one that crashed or
 * was killed says nothing, so the host asks every few seconds and takes a window that has
 * stopped answering to be gone. A window that never answered (an older one) is believed
 * until it says it has closed.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import {
  STAGE_CHANNEL_NAME,
  STAGE_PINGS_MISSED,
  STAGE_PING_MS,
  type StageMessage,
} from '../../utils/stageLink';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Alex',
    status: 'waiting',
    source: { kind: 'youtube', videoId: 'a3vO3thiYV4', title: 'Dancing Queen', artist: 'Zoom' },
  },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

/** Long enough for a host to have asked, and gone unanswered, as often as it takes. */
const GONE_MS = STAGE_PING_MS * (STAGE_PINGS_MISSED + 1) + 100;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFakeYouTube();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeFakeYouTube();
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

function openStageWindow() {
  const view = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  // A window that dies says nothing: its page is simply gone
  return { kill: () => view.unmount() };
}

/** A stage window from before the host asked: it says hello and answers no ask. */
function openOldStageWindow() {
  const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
  const post = (message: StageMessage) => act(() => channel.postMessage(message));
  channel.onmessage = (event: MessageEvent<StageMessage>) => {
    if (event.data.type === 'who') channel.postMessage({ type: 'hello' } satisfies StageMessage);
  };
  post({ type: 'hello' });
  return { close: () => post({ type: 'closed' }) };
}

const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const isOpen = (host: ReturnType<typeof openHost>) =>
  host.queryByText('The stage window is open') !== null;

describe('a stage window that keeps answering', () => {
  it('stays open for as long as it does', async () => {
    openStageWindow();
    const host = openHost();

    await later(20 * STAGE_PING_MS);

    expect(isOpen(host)).toBe(true);
  });
});

describe('a stage window that dies without a word', () => {
  it('is taken to be gone once it has stopped answering', async () => {
    const stageWindow = openStageWindow();
    const host = openHost();
    await later(STAGE_PING_MS + 100);
    expect(isOpen(host)).toBe(true);

    stageWindow.kill();
    await later(GONE_MS);

    expect(isOpen(host)).toBe(false);
    expect(host.getByText('No stage window yet')).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Open stage window' })).toBeInTheDocument();
  });

  it('is not given up on for one ask that went unanswered', async () => {
    const stageWindow = openStageWindow();
    const host = openHost();
    await later(STAGE_PING_MS + 100);

    stageWindow.kill();
    await later(STAGE_PING_MS + 100);

    expect(isOpen(host)).toBe(true);
  });

  it('says a video needs a stage window, where Play would have spun for ever', async () => {
    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    const stageWindow = openStageWindow();
    const host = openHost();
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await later(STAGE_PING_MS + 100);

    stageWindow.kill();
    await later(GONE_MS);

    expect(host.getByText('A video plays on the stage window, and none is open.')).toBeVisible();
    expect(host.getByRole('button', { name: 'Open it for this video' })).toBeInTheDocument();
  });

  it('is open again when a new one is opened', async () => {
    const stageWindow = openStageWindow();
    const host = openHost();
    await later(STAGE_PING_MS + 100);
    stageWindow.kill();
    await later(GONE_MS);

    openStageWindow();

    expect(isOpen(host)).toBe(true);
    await later(GONE_MS);
    expect(isOpen(host)).toBe(true);
  });

  it('leaves the stage open while another stage window is still there to answer', async () => {
    const first = openStageWindow();
    openStageWindow();
    const host = openHost();
    await later(STAGE_PING_MS + 100);

    first.kill();
    await later(GONE_MS);

    expect(isOpen(host)).toBe(true);
  });
});

describe('a stage window that never answers an ask', () => {
  it('is believed until it says it has closed', async () => {
    const old = openOldStageWindow();
    const host = openHost();
    expect(isOpen(host)).toBe(true);

    await later(20 * STAGE_PING_MS);
    expect(isOpen(host)).toBe(true);

    old.close();
    expect(isOpen(host)).toBe(false);
  });
});

describe('answers meant for another host', () => {
  it('do not count for this one', async () => {
    const stageWindow = openStageWindow();
    const host = openHost();
    await later(STAGE_PING_MS + 100);
    stageWindow.kill();
    const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
    const answerSomeoneElse = setInterval(
      () => channel.postMessage({ type: 'pong', to: 'another-host' } satisfies StageMessage),
      1000
    );

    await later(GONE_MS);
    clearInterval(answerSomeoneElse);
    channel.close();

    expect(isOpen(host)).toBe(false);
  });
});
