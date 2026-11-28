/**
 * A song that was cut off, on the host screen: where it was is written down as it plays, and
 * after a reload the singer is called again with "Resume at ..." beside starting from the
 * top. A song that ran to its end, or a singer who goes again, starts from the top.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import type { ProjectState } from '../../types';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { loadShowResume } from '../../utils/showResume';
import { YT_STATE } from '../../utils/youtube';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const VIDEO = 'a3vO3thiYV4';

const song = {
  id: 'demo',
  status: 'ready',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  duration: 200,
  master_audio_url: '/static/output/demo_mix.wav',
  lines: [
    {
      id: 1,
      text: 'city lights',
      start_time: 2,
      end_time: 6,
      words: [{ word: 'city', start_time: 2, end_time: 6 }],
    },
  ],
} as unknown as ProjectState;

const videoQueue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Alex',
    status: 'waiting',
    source: {
      kind: 'youtube',
      videoId: VIDEO,
      title: 'Dancing Queen',
      artist: 'Zoom Karaoke',
      duration: 200,
    },
  },
  {
    id: 'e2',
    singer: 'Bo',
    status: 'waiting',
    source: { kind: 'youtube', videoId: VIDEO, title: 'Waterloo', artist: 'Zoom Karaoke' },
  },
];

const songQueue: ShowQueue = [
  {
    id: 's1',
    singer: 'Cy',
    status: 'waiting',
    source: { kind: 'library', projectId: 'demo', title: 'Neon Skyline', artist: 'The Static' },
  },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  installFakeYouTube();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/show/videos/')) {
        return json({ embeddable: true, status: 'none', progress: 0, url: null, downloads: true });
      }
      if (url === '/api/project/demo') return json(song);
      return json({});
    })
  );
});

afterEach(() => {
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
  return { host: within(view.container), close: () => view.unmount() };
}

type Host = ReturnType<typeof openHost>['host'];

function openShow(queue: ShowQueue) {
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  render(<StageWindow />, { container: document.body.appendChild(document.createElement('div')) });
  return openHost();
}

/** The first singer's video started, with its player made. */
async function startVideo(host: Host) {
  fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
  await act(async () => {});
  return FakeYouTubePlayer.current!;
}

async function startSong(host: Host) {
  fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
  const audio = (await host.findByTestId('show-audio')) as HTMLAudioElement;
  fireEvent.loadedMetadata(audio);
  fireEvent.canPlay(audio);
  fireEvent.play(audio);
  return audio;
}

const reachIn = (audio: HTMLAudioElement, seconds: number) => {
  audio.currentTime = seconds;
  fireEvent.timeUpdate(audio);
};

describe('where a video is, as it plays', () => {
  it('is written down', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);

    act(() => player.setState(YT_STATE.playing, 83));

    expect(loadShowResume()).toMatchObject({ entryId: 'e1', time: 83 });
  });

  it('is written again once the video has moved on some seconds, not at every report', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 81));

    act(() => player.setState(YT_STATE.playing, 82.5));
    expect(loadShowResume()?.time).toBe(81);

    act(() => player.setState(YT_STATE.playing, 86));
    expect(loadShowResume()?.time).toBe(86);
  });

  it('is written at once when the video is paused', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 81));

    act(() => player.setState(YT_STATE.paused, 82.5));

    expect(loadShowResume()?.time).toBe(82.5);
  });

  it('is written exactly when the page goes', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 81));
    act(() => player.setState(YT_STATE.playing, 83.9));
    expect(loadShowResume()?.time).toBe(81);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(loadShowResume()?.time).toBe(83.9);
  });
});

describe('a host screen reloaded during a video', () => {
  async function reloadedAt(seconds: number) {
    const first = openShow(videoQueue);
    const player = await startVideo(first.host);
    act(() => player.setState(YT_STATE.playing, seconds));
    first.close();
    return openHost().host;
  }

  it('calls the singer again and offers to resume where the song was', async () => {
    const host = await reloadedAt(83);

    expect(host.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(host.getByText('This song was cut off at 1:23.')).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Resume at 1:23' })).toBeInTheDocument();
    expect(host.getByRole('button', { name: 'Start from the top' })).toBeInTheDocument();
    expect(host.queryByRole('button', { name: 'Start the song' })).toBeNull();
  });

  it('resumes: the stage’s player starts there, and the host’s place is there too', async () => {
    const host = await reloadedAt(83);

    fireEvent.click(host.getByRole('button', { name: 'Resume at 1:23' }));
    await act(async () => {});

    const player = FakeYouTubePlayer.current!;
    expect(player.options.playerVars?.start).toBe(83);
    expect(Number((host.getByTestId('show-position') as HTMLInputElement).value)).toBe(83);
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();
  });

  it('starts from the top when asked, and forgets the place', async () => {
    const host = await reloadedAt(83);

    fireEvent.click(host.getByRole('button', { name: 'Start from the top' }));
    await act(async () => {});

    expect(FakeYouTubePlayer.current!.options.playerVars?.start).toBeUndefined();
    expect(loadShowResume()).toBeNull();
  });

  it('just starts a song that had only begun', async () => {
    const host = await reloadedAt(3);

    expect(host.getByRole('button', { name: 'Start the song' })).toBeInTheDocument();
    expect(host.queryByRole('button', { name: /Resume at/ })).toBeNull();
  });

  it('offers nothing for another singer who is started instead', async () => {
    const host = await reloadedAt(83);

    fireEvent.click(host.getByRole('button', { name: 'Start Bo' }));
    await act(async () => {});

    expect(loadShowResume()).toBeNull();
    fireEvent.click(host.getByRole('button', { name: 'Skip' }));
    // Alex is called again, from the top: the place belonged to a song since passed over
    expect(host.getByRole('button', { name: 'Start the song' })).toBeInTheDocument();
  });
});

describe('a video that is over', () => {
  it('keeps no place when it ran to its end', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 83));

    act(() => player.setState(YT_STATE.ended, 200));

    expect(loadShowResume()).toBeNull();
  });

  it('keeps its place when the host ended it by hand, in case that was a mistake', async () => {
    const { host } = openShow(videoQueue);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 83));

    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));

    expect(loadShowResume()).toMatchObject({ entryId: 'e1', time: 83 });
  });

  it('starts from the top for a singer who goes again', async () => {
    const { host } = openShow([videoQueue[0]]);
    const player = await startVideo(host);
    act(() => player.setState(YT_STATE.playing, 83));
    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));

    fireEvent.click(host.getByRole('button', { name: 'Put Alex back in the queue' }));

    expect(loadShowResume()).toBeNull();
    expect(host.getByRole('button', { name: 'Start the song' })).toBeInTheDocument();
    expect(host.queryByRole('button', { name: /Resume at/ })).toBeNull();
  });
});

describe('a library song that was cut off', () => {
  it('has its place written down as it plays', async () => {
    const { host } = openShow(songQueue);
    const audio = await startSong(host);

    reachIn(audio, 40);

    expect(loadShowResume()).toMatchObject({ entryId: 's1', time: 40 });
  });

  it('is resumed from there after a reload', async () => {
    const first = openShow(songQueue);
    reachIn(await startSong(first.host), 40);
    first.close();
    const { host } = openHost();

    fireEvent.click(host.getByRole('button', { name: 'Resume at 0:40' }));
    const audio = (await host.findByTestId('show-audio')) as HTMLAudioElement;
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(audio);
    fireEvent.canPlay(audio);

    expect(audio.currentTime).toBe(40);
    expect(audio.play).toHaveBeenCalled();
  });

  it('goes on from where it was when it failed and is tried again', async () => {
    const { host } = openShow(songQueue);
    const audio = await startSong(host);
    reachIn(audio, 40);

    fireEvent.error(audio);
    fireEvent.click(await host.findByRole('button', { name: 'Try again' }));
    const again = (await host.findByTestId('show-audio')) as HTMLAudioElement;
    Object.defineProperty(again, 'readyState', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(again);

    expect(again).not.toBe(audio);
    expect(again.currentTime).toBe(40);
  });
});
