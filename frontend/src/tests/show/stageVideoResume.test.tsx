/**
 * A stage window that is closed and opened again while a video is on: the new window's player
 * starts where the old one was, not at the video's first bar, and the host's own place in the
 * song does not jump to the start while it loads. A window that is already playing is never
 * moved by being sent its scene again.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import {
  RESUME_EDGE_SEC,
  STAGE_CHANNEL_NAME,
  resumeAt,
  type StageMessage,
  type StageScene,
} from '../../utils/stageLink';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { YT_STATE } from '../../utils/youtube';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const VIDEO = 'a3vO3thiYV4';

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Alex',
    status: 'waiting',
    source: { kind: 'youtube', videoId: VIDEO, title: 'Dancing Queen', artist: 'Zoom Karaoke' },
  },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  installFakeYouTube();
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/show/videos/')) {
        return json({ embeddable: true, status: 'none', progress: 0, url: null, downloads: true });
      }
      return json({});
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeYouTube();
});

function openStageWindow() {
  const view = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  return {
    /** Closes it as a window closes: it says so, then it is gone. */
    close: () => {
      const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
      act(() => channel.postMessage({ type: 'closed' } satisfies StageMessage));
      channel.close();
      view.unmount();
    },
  };
}

function openHost() {
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return within(view.container);
}

/** The host screen beside a stage window, with the video started and its player made. */
async function startVideo() {
  const stageWindow = openStageWindow();
  const host = openHost();
  fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
  await act(async () => {});
  return { host, stageWindow, player: FakeYouTubePlayer.current! };
}

/** A stage window opened again; resolves to its player once that is made. */
async function reopen() {
  const stageWindow = openStageWindow();
  await act(async () => {});
  return { stageWindow, player: FakeYouTubePlayer.current! };
}

const position = (host: ReturnType<typeof openHost>) =>
  Number((host.getByTestId('show-position') as HTMLInputElement).value);

describe('where a video is picked up', () => {
  it('is where it was, unless that is the first or the last few seconds', () => {
    expect(resumeAt(83, 200)).toBe(83);
    expect(resumeAt(RESUME_EDGE_SEC - 1, 200)).toBeNull();
    expect(resumeAt(200 - RESUME_EDGE_SEC + 1, 200)).toBeNull();
    // A length that is not known yet does not stand in the way
    expect(resumeAt(83, 0)).toBe(83);
    expect(resumeAt(Number.NaN, 200)).toBeNull();
  });
});

describe('a stage window opened again during a YouTube video', () => {
  it('starts its player where the video was', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));

    stageWindow.close();
    const again = await reopen();

    expect(again.player).not.toBe(player);
    expect(again.player.options.videoId).toBe(VIDEO);
    expect(again.player.options.playerVars?.start).toBe(83);
    expect(again.player.getCurrentTime()).toBe(83);
  });

  it('starts from a video that was paused there, too', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 60));
    act(() => player.setState(YT_STATE.paused, 61.4));

    stageWindow.close();
    const again = await reopen();

    expect(again.player.options.playerVars?.start).toBe(61);
  });

  it('starts from the top when the video had only just begun', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 2));

    stageWindow.close();
    const again = await reopen();

    expect(again.player.options.playerVars?.start).toBeUndefined();
    expect(again.player.getCurrentTime()).toBe(0);
  });

  it('starts from the top when the video was at its very end', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 198));

    stageWindow.close();
    const again = await reopen();

    expect(again.player.options.playerVars?.start).toBeUndefined();
  });

  it('moves a player that did not start where it was asked to, once', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));
    stageWindow.close();
    FakeYouTubePlayer.honoursStart = false;
    const again = await reopen();
    expect(again.player.getCurrentTime()).toBe(0);

    act(() => again.player.setState(YT_STATE.playing, 0));
    expect(again.player.calls).toContain('seek 83');

    // Playing again later (after a pause, say) is left where it is
    act(() => again.player.setState(YT_STATE.paused, 90));
    act(() => again.player.setState(YT_STATE.playing, 1));
    expect(again.player.calls.filter((call) => call.startsWith('seek'))).toHaveLength(1);
  });

  it('leaves a player alone that started where it was asked to', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));
    stageWindow.close();
    const again = await reopen();

    act(() => again.player.setState(YT_STATE.playing, 83.5));

    expect(again.player.calls.filter((call) => call.startsWith('seek'))).toHaveLength(0);
  });

  it('keeps the host’s place in the song while the new player loads', async () => {
    const { host, stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));
    expect(position(host)).toBe(83);

    stageWindow.close();
    await reopen();

    // The new player has only said it is loading, from 0
    expect(position(host)).toBe(83);
  });

  it('still knows the place when the window is opened a third time before it plays', async () => {
    const { stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));
    stageWindow.close();
    const second = await reopen();

    second.stageWindow.close();
    const third = await reopen();

    expect(third.player.options.playerVars?.start).toBe(83);
  });

  it('starts the next playing of the same video from the top', async () => {
    const { host, stageWindow, player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));
    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));
    fireEvent.click(host.getByRole('button', { name: 'Put Alex back in the queue' }));
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    stageWindow.close();
    const again = await reopen();

    expect(again.player.options.playerVars?.start).toBeUndefined();
  });
});

describe('a stage window that is still open and is sent its scene again', () => {
  it('keeps its player, and its place', async () => {
    const { player } = await startVideo();
    act(() => player.setState(YT_STATE.playing, 83));

    // Another window asks who is there (a studio tab opening): the stage window says hello
    // again, and the host answers with the scene and where the video is
    const other = new BroadcastChannel(STAGE_CHANNEL_NAME);
    act(() => other.postMessage({ type: 'who' } satisfies StageMessage));
    await act(async () => {});
    other.close();

    expect(FakeYouTubePlayer.current).toBe(player);
    expect(player.destroyed).toBe(false);
    expect(player.calls.filter((call) => call.startsWith('seek'))).toHaveLength(0);
  });
});

describe('a video file on a stage window opened part-way', () => {
  const HOST = 'host-1';
  const show = (scene: StageScene) => {
    const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
    act(() => channel.postMessage({ type: 'scene', from: HOST, scene } satisfies StageMessage));
    channel.close();
  };
  const file = () => screen.getByTestId('stage-file-video') as HTMLVideoElement;

  it('starts where it is told to', () => {
    render(<StageWindow />);

    show({ kind: 'file', url: '/api/show/videos/abc/file', play: 1, at: 40 });

    expect(file().currentTime).toBe(40);
    expect(file().play).toHaveBeenCalled();
  });

  it('starts from the top without a place', () => {
    render(<StageWindow />);

    show({ kind: 'file', url: '/api/show/videos/abc/file', play: 1 });

    expect(file().currentTime).toBe(0);
  });

  it('is not moved by the same scene sent again with another place', () => {
    render(<StageWindow />);
    show({ kind: 'file', url: '/api/show/videos/abc/file', play: 1 });
    const video = file();
    video.currentTime = 55;

    show({ kind: 'file', url: '/api/show/videos/abc/file', play: 1, at: 40 });

    expect(file()).toBe(video);
    expect(video.currentTime).toBe(55);
  });
});
