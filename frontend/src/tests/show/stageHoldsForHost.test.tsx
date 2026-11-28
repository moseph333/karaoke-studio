/**
 * The stage window when a show's host screen goes (closed, or reloaded): it keeps the night's
 * name up for a while instead of the app's own idle card, since a reloaded host is back in a
 * moment. It gives way at once to the host's next scene, or to a stage a studio sends after
 * the host went.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import {
  STAGE_CHANNEL_NAME,
  STAGE_HOLD_MS,
  type StageMessage,
  type StageScene,
} from '../../utils/stageLink';
import {
  SHOW_QUEUE_STORAGE_KEY,
  SHOW_TITLE_STORAGE_KEY,
  type ShowQueue,
} from '../../utils/showQueue';
import type { LyricLine } from '../../types';

const HOST = 'host-1';
const NIGHT = 'Thursday at Sluggos';

const lines: LyricLine[] = [
  {
    id: 1,
    text: 'draft one',
    start_time: 0,
    end_time: 4,
    words: [
      { word: 'draft', start_time: 0, end_time: 2 },
      { word: 'one', start_time: 2, end_time: 4 },
    ],
  },
];

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Alex',
    status: 'waiting',
    source: { kind: 'youtube', videoId: 'a3vO3thiYV4', title: 'Dancing Queen', artist: 'Zoom' },
  },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A show's host, as far as the stage window can tell. */
function openHost(id = HOST) {
  const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
  const post = (message: StageMessage) => act(() => channel.postMessage(message));
  return {
    show: (scene: StageScene) => post({ type: 'scene', from: id, scene }),
    /** The host screen goes, leaving the night's name (an older host leaves none). */
    leave: (title?: string) =>
      post({ type: 'scene', from: id, scene: null, ...(title ? { title } : {}) }),
  };
}

/** A studio tab's stage; `close` takes it away again. */
function openStudio() {
  const view = render(<LyricDisplay lines={lines} duration={60} isPlaying={false} />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  return { close: () => view.unmount() };
}

function openStageWindow() {
  const view = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const stage = within(view.container);
  return {
    stage,
    scene: () => stage.getByTestId('stage-window').getAttribute('data-scene'),
    words: () => (stage.queryByTestId('stage-frame')?.textContent ?? '').toLowerCase(),
  };
}

const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('a stage window whose host screen goes', () => {
  it('keeps the night’s name up, not the app’s own card', () => {
    const { stage, scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'youtube', videoId: 'a3vO3thiYV4', play: 1 });

    host.leave(NIGHT);

    expect(scene()).toBe('held');
    expect(stage.getByRole('heading', { name: NIGHT })).toBeInTheDocument();
    expect(stage.queryByRole('heading', { name: 'Karaoke Studio' })).toBeNull();
    // The video went with the scene
    expect(stage.queryByTestId('stage-youtube')).toBeNull();
  });

  it('shows the host’s scene at once when the host is back', () => {
    const { stage, scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });
    host.leave(NIGHT);

    // A reloaded host screen has a name of its own
    openHost('host-2').show({
      kind: 'upnext',
      title: NIGHT,
      now: { singer: 'Alex', title: 'Dancing Queen' },
      next: [],
    });

    expect(scene()).toBe('upnext');
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
  });

  it('goes back to its own card when no host has come back for a while', async () => {
    const { stage, scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });
    host.leave(NIGHT);

    await later(STAGE_HOLD_MS - 1000);
    expect(scene()).toBe('held');

    await later(1100);
    expect(scene()).toBe('none');
    expect(stage.getByRole('heading', { name: 'Karaoke Studio' })).toBeInTheDocument();
  });

  it('is not put back on the card by a host that returned and stayed', async () => {
    const { scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });
    host.leave(NIGHT);
    host.show({ kind: 'idle', title: NIGHT, next: [] });

    await later(STAGE_HOLD_MS + 1000);

    expect(scene()).toBe('idle');
  });

  it('goes straight to its own card for a host that leaves no name (an older one)', () => {
    const { stage, scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });

    host.leave();

    expect(scene()).toBe('none');
    expect(stage.getByRole('heading', { name: 'Karaoke Studio' })).toBeInTheDocument();
  });

  it('takes no notice of another window leaving', () => {
    const { scene } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });

    openHost('someone-else').leave('Another night');

    expect(scene()).toBe('idle');
  });
});

describe('a studio tab while the night’s name is held', () => {
  it('does not take the stage with a song that was already open', async () => {
    const { scene, words } = openStageWindow();
    openStudio();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });

    host.leave(NIGHT);
    expect(scene()).toBe('held');

    // Once the wait is over the studio's stage is what there is to show
    await later(STAGE_HOLD_MS + 100);
    expect(words()).toContain('draft');
  });

  it('takes the stage at once with a song opened after the host went', () => {
    const { scene, words } = openStageWindow();
    const host = openHost();
    host.show({ kind: 'idle', title: NIGHT, next: [] });
    host.leave(NIGHT);

    openStudio();

    expect(scene()).toBe('lyrics');
    expect(words()).toContain('draft');
  });
});

describe('the host screen itself', () => {
  const openShow = () =>
    render(
      <ToastProvider>
        <ShowScreen />
      </ToastProvider>,
      { container: document.body.appendChild(document.createElement('div')) }
    );

  beforeEach(() => {
    localStorage.setItem(SHOW_TITLE_STORAGE_KEY, NIGHT);
    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  });

  it('leaves the night’s name when it is reloaded, and calls the singer again after', () => {
    const { stage, scene } = openStageWindow();
    const first = openShow();
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');

    first.unmount();
    expect(scene()).toBe('held');
    expect(stage.getByRole('heading', { name: NIGHT })).toBeInTheDocument();

    openShow();
    expect(scene()).toBe('upnext');
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
  });

  it('leaves the name the host has since given the night', () => {
    const { stage } = openStageWindow();
    const show = openShow();
    const name = within(show.container).getByLabelText('Name of the night');
    act(() => {
      // As typed: the input is controlled
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        name,
        'Friday special'
      );
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });

    show.unmount();

    expect(stage.getByRole('heading', { name: 'Friday special' })).toBeInTheDocument();
  });

  it('sends its scene again when the browser brings its page back', () => {
    const { scene } = openStageWindow();
    openShow();
    // The page was put away (it said it had left) and is shown again without loading
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(scene()).toBe('held');

    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });

    expect(scene()).toBe('upnext');
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
  });
});
