/**
 * A show's host screen, alone and beside a stage window: adding singers, the queue, calling
 * the next singer, playing a karaoke video on the stage window and a library song in the
 * host's, and what happens to a video YouTube will not play in its embedded player.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import type { ShowVideoInfo } from '../../hooks/useShowVideos';
import type { ProjectState, SearchResult } from '../../types';
import { SHOW_QUEUE_STORAGE_KEY, type ShowQueue } from '../../utils/showQueue';
import { YT_STATE } from '../../utils/youtube';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const ZOOM = 'a3vO3thiYV4';
const SINGKING = 'WHayJZ3eMcE';

const results: SearchResult[] = [
  {
    id: ZOOM,
    title: 'ABBA - Dancing Queen (Karaoke Version)',
    artist: 'Zoom Karaoke',
    duration: 223,
    url: `https://www.youtube.com/watch?v=${ZOOM}`,
  },
  {
    id: SINGKING,
    title: 'Dancing Queen in the style of ABBA',
    artist: 'Sing King',
    duration: 255,
    url: `https://www.youtube.com/watch?v=${SINGKING}`,
  },
];

const song = {
  id: 'demo',
  status: 'ready',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  duration: 62,
  master_audio_url: '/static/output/demo_mix.wav',
  lines: [
    {
      id: 1,
      text: 'city lights are humming',
      start_time: 2,
      end_time: 6,
      words: [
        { word: 'city', start_time: 2, end_time: 3 },
        { word: 'lights', start_time: 3, end_time: 4 },
        { word: 'are', start_time: 4, end_time: 5 },
        { word: 'humming', start_time: 5, end_time: 6 },
      ],
    },
  ],
} as unknown as ProjectState;

const videoInfo = (over: Partial<ShowVideoInfo> = {}): ShowVideoInfo => ({
  embeddable: true,
  status: 'none',
  progress: 0,
  url: null,
  error: null,
  downloads: true,
  ...over,
});

interface Server {
  videos: Record<string, ShowVideoInfo>;
  /** What a video's entry becomes once its copy is asked for. */
  onFetch: Partial<ShowVideoInfo>;
  calls: { method: string; url: string; body: string }[];
}

let server: Server;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  installFakeYouTube();
  server = {
    videos: { [ZOOM]: videoInfo(), [SINGKING]: videoInfo({ embeddable: false }) },
    onFetch: { status: 'fetching', progress: 10 },
    calls: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      server.calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : '' });
      if (url === '/api/search') return json({ results });
      const video = url.match(/^\/api\/show\/videos\/([^/]+)(\/fetch)?$/);
      if (video) {
        const id = video[1];
        if (video[2]) server.videos[id] = { ...videoInfo(server.videos[id]), ...server.onFetch };
        return json(server.videos[id] ?? videoInfo());
      }
      if (url.startsWith('/api/projects')) return json({ demo: { ...song, lines: undefined } });
      if (url === '/api/project/demo') return json(song);
      return json({ detail: 'Not found' }, 404);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeFakeYouTube();
});

const called = (method: string, url: string) =>
  server.calls.some((call) => call.method === method && call.url === url);

function openHost() {
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return within(view.container);
}

/** The host screen beside a stage window, each in its own container. */
function openBoth() {
  const stageView = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  return { host: openHost(), stage: within(stageView.container), stageRoot: stageView.container };
}

type Screen = ReturnType<typeof openHost>;

async function addVideo(host: Screen, singer: string, title: string) {
  fireEvent.change(host.getByLabelText('Singer'), { target: { value: singer } });
  if (!host.queryByTestId('show-video-results')) {
    fireEvent.change(host.getByLabelText('Song, artist or a YouTube link'), {
      target: { value: 'dancing queen' },
    });
    fireEvent.click(host.getByRole('button', { name: 'Search' }));
  }
  fireEvent.click(await host.findByRole('button', { name: `Add the video ${title}` }));
}

async function addLibrarySong(host: Screen, singer: string) {
  fireEvent.change(host.getByLabelText('Singer'), { target: { value: singer } });
  fireEvent.click(host.getByRole('tab', { name: 'Library' }));
  fireEvent.click(await host.findByRole('button', { name: 'Add the song Neon Skyline' }));
}

const savedQueue = (): ShowQueue =>
  JSON.parse(localStorage.getItem(SHOW_QUEUE_STORAGE_KEY) ?? '[]') as ShowQueue;
const queuedSingers = (host: Screen) =>
  host.queryAllByTestId('show-queue-row').map((row) => row.textContent ?? '');

describe('the host screen before anyone is queued', () => {
  it('says nobody is on and invites a first singer', () => {
    const host = openHost();

    expect(host.getByRole('heading', { name: 'Nobody is on' })).toBeInTheDocument();
    expect(host.getByText('Nobody is waiting. Add a singer and their song.')).toBeInTheDocument();
    expect(host.getByRole('heading', { name: 'Add a singer' })).toBeInTheDocument();
    expect(host.queryByRole('button', { name: 'Start the song' })).toBeNull();
  });

  it('keeps the name of the night, falling back when it is emptied', () => {
    const host = openHost();
    const name = host.getByLabelText('Name of the night');

    fireEvent.change(name, { target: { value: 'Thursday at the bar' } });
    expect(document.title).toBe('Thursday at the bar · Karaoke Studio');

    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.blur(name);
    expect(name).toHaveValue('Karaoke night');
  });
});

describe('adding a singer', () => {
  it('searches YouTube for a karaoke video of the song and queues the one picked', async () => {
    const host = openHost();

    await addVideo(host, 'Alex', results[0].title);

    const search = server.calls.find((call) => call.url === '/api/search');
    expect(JSON.parse(search?.body ?? '{}')).toMatchObject({ query: 'dancing queen karaoke' });
    expect(queuedSingers(host)).toHaveLength(1);
    expect(queuedSingers(host)[0]).toContain('Alex');
    expect(queuedSingers(host)[0]).toContain('Video');
    expect(savedQueue()).toMatchObject([
      { singer: 'Alex', status: 'waiting', source: { kind: 'youtube', videoId: ZOOM } },
    ]);
    // Ready for the next singer
    expect(host.getByLabelText('Singer')).toHaveValue('');
  });

  it('clears the search box and its results once the song is queued', async () => {
    const host = openHost();

    await addVideo(host, 'Alex', results[0].title);

    expect(host.getByLabelText('Song, artist or a YouTube link')).toHaveValue('');
    expect(host.queryByTestId('show-video-results')).toBeNull();
    expect(host.getByText(/Search for the song and pick a karaoke video/)).toBeInTheDocument();
    expect(host.getByLabelText('Singer')).toHaveFocus();
  });

  it('keeps the search when the song was not queued for want of a name', async () => {
    const host = openHost();
    fireEvent.change(host.getByLabelText('Song, artist or a YouTube link'), {
      target: { value: 'dancing queen' },
    });
    fireEvent.click(host.getByRole('button', { name: 'Search' }));

    fireEvent.click(await host.findByRole('button', { name: `Add the video ${results[0].title}` }));

    expect(host.getByLabelText('Song, artist or a YouTube link')).toHaveValue('dancing queen');
    expect(host.getByTestId('show-video-results')).toBeInTheDocument();
  });

  it('clears the library filter once a library song is queued', async () => {
    const host = openHost();
    fireEvent.change(host.getByLabelText('Singer'), { target: { value: 'Cy' } });
    fireEvent.click(host.getByRole('tab', { name: 'Library' }));
    await host.findByRole('button', { name: 'Add the song Neon Skyline' });
    fireEvent.change(host.getByLabelText('Find in the library'), { target: { value: 'neon' } });

    fireEvent.click(host.getByRole('button', { name: 'Add the song Neon Skyline' }));

    expect(host.getByLabelText('Find in the library')).toHaveValue('');
    expect(host.getByRole('button', { name: 'Add the song Neon Skyline' })).toBeInTheDocument();
  });

  it('asks for the singer’s name before it queues a song', async () => {
    const host = openHost();
    fireEvent.change(host.getByLabelText('Song, artist or a YouTube link'), {
      target: { value: 'dancing queen' },
    });
    fireEvent.click(host.getByRole('button', { name: 'Search' }));

    fireEvent.click(await host.findByRole('button', { name: `Add the video ${results[0].title}` }));

    expect(host.getByText('Type the singer’s name first.')).toBeInTheDocument();
    expect(queuedSingers(host)).toHaveLength(0);
    expect(host.getByLabelText('Singer')).toHaveFocus();
  });

  it('takes a pasted YouTube link as the video itself', async () => {
    server.videos.dQw4w9WgXcQ = videoInfo({ title: 'Halo (Karaoke)', channel: 'KaraFun' });
    const host = openHost();
    fireEvent.change(host.getByLabelText('Singer'), { target: { value: 'Bo' } });
    fireEvent.change(host.getByLabelText('Song, artist or a YouTube link'), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    fireEvent.click(host.getByRole('button', { name: 'Search' }));

    fireEvent.click(await host.findByRole('button', { name: 'Add the video Halo (Karaoke)' }));

    expect(called('POST', '/api/search')).toBe(false);
    expect(savedQueue()[0].source).toMatchObject({ kind: 'youtube', videoId: 'dQw4w9WgXcQ' });
  });

  it('queues a song from the library', async () => {
    const host = openHost();

    await addLibrarySong(host, 'Cy');

    expect(queuedSingers(host)[0]).toContain('Neon Skyline · The Midnight Static');
    expect(savedQueue()[0].source).toMatchObject({ kind: 'library', projectId: 'demo' });
  });

  it('fetches a copy at once of a video YouTube will not embed', async () => {
    const host = openHost();

    await addVideo(host, 'Alex', results[1].title);

    await waitFor(() => expect(called('POST', `/api/show/videos/${SINGKING}/fetch`)).toBe(true));
    expect(await host.findByText('Fetching a copy, 10%')).toBeInTheDocument();
  });

  it('fetches nothing for a video YouTube will embed', async () => {
    const host = openHost();

    await addVideo(host, 'Alex', results[0].title);

    await waitFor(() => expect(called('GET', `/api/show/videos/${ZOOM}`)).toBe(true));
    expect(called('POST', `/api/show/videos/${ZOOM}/fetch`)).toBe(false);
  });
});

describe('the queue', () => {
  async function three() {
    const host = openHost();
    await addVideo(host, 'Alex', results[0].title);
    await addVideo(host, 'Bo', results[0].title);
    await addVideo(host, 'Cy', results[0].title);
    return host;
  }
  /** The singers waiting, top to bottom, as the queue lists them. */
  const order = (host: Screen) => queuedSingers(host).map((row) => row.match(/Alex|Bo|Cy/)?.[0]);

  it('calls the first singer and lists the rest in order', async () => {
    const host = await three();

    expect(host.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(order(host)).toEqual(['Alex', 'Bo', 'Cy']);
    expect(host.getByRole('button', { name: 'Move Alex up' })).toBeDisabled();
    expect(host.getByRole('button', { name: 'Move Cy down' })).toBeDisabled();
  });

  it('moves a singer and takes one off', async () => {
    const host = await three();

    fireEvent.click(host.getByRole('button', { name: 'Move Cy up' }));
    expect(order(host)).toEqual(['Alex', 'Cy', 'Bo']);

    fireEvent.click(host.getByRole('button', { name: 'Take Alex off the queue' }));
    expect(order(host)).toEqual(['Cy', 'Bo']);
  });

  it('comes back after a reload, with the singer who was on at the head of the line', async () => {
    const host = await three();
    fireEvent.click(host.getByRole('button', { name: 'Start Bo' }));
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();

    document.body.innerHTML = '';
    const reloaded = openHost();

    expect(reloaded.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(order(reloaded)).toEqual(['Bo', 'Alex', 'Cy']);
  });
});

describe('a video with no stage window open', () => {
  it('says where videos play and offers to open the window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const host = openHost();
    await addVideo(host, 'Alex', results[0].title);

    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));

    expect(
      host.getByText('A video plays on the stage window, and none is open.')
    ).toBeInTheDocument();
    fireEvent.click(host.getByRole('button', { name: 'Open it for this video' }));
    expect(open).toHaveBeenCalledWith('/?stage=1', 'karaoke-stage', expect.any(String));
    open.mockRestore();
  });
});

describe('a show beside its stage window', () => {
  it('knows the stage window is open', () => {
    const { host } = openBoth();

    expect(host.getByText('The stage window is open')).toBeInTheDocument();
  });

  it('shows the night’s name on the stage until a singer is queued, then calls them', async () => {
    const { host, stage } = openBoth();
    expect(stage.getByRole('heading', { name: 'Karaoke night' })).toBeInTheDocument();

    await addVideo(host, 'Alex', results[0].title);

    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent(results[0].title);
  });

  it('plays a video on the stage window and follows it from the host', async () => {
    const { host, stage } = openBoth();
    await addVideo(host, 'Alex', results[0].title);

    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    const player = FakeYouTubePlayer.current!;
    expect(player.options.videoId).toBe(ZOOM);
    expect(stage.getByTestId('stage-youtube')).toBeInTheDocument();
    expect(host.getByRole('heading', { name: 'Now singing' })).toBeInTheDocument();

    act(() => player.setState(YT_STATE.playing, 30));
    fireEvent.click(host.getByRole('button', { name: 'Pause' }));
    expect(player.calls).toContain('pause');

    act(() => player.setState(YT_STATE.paused, 31));
    fireEvent.click(host.getByRole('button', { name: 'Play' }));
    expect(player.calls.filter((call) => call === 'play').length).toBeGreaterThan(0);
  });

  it('gives a video that has started the host’s volume', async () => {
    const { host } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});
    const player = FakeYouTubePlayer.current!;

    act(() => player.setState(YT_STATE.playing, 1));

    expect(player.calls).toContain('volume 100');
  });

  it('marks a singer as sung when their video ends, and calls the next', async () => {
    const { host, stage } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    await addVideo(host, 'Bo', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    act(() => FakeYouTubePlayer.current!.setState(YT_STATE.ended, 223));

    expect(within(host.getByTestId('show-sung')).getByText('Alex')).toBeInTheDocument();
    expect(host.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Bo');
    expect(stage.queryByTestId('stage-youtube')).toBeNull();
  });

  it('ends a song from the host and lets the singer go again', async () => {
    const { host } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));

    fireEvent.click(host.getByRole('button', { name: 'Song is over' }));
    expect(host.getByRole('heading', { name: 'Nobody is on' })).toBeInTheDocument();

    fireEvent.click(host.getByRole('button', { name: 'Put Alex back in the queue' }));
    expect(queuedSingers(host)[0]).toContain('Alex');
    expect(host.queryByTestId('show-sung')).toBeNull();
  });

  it('plays the server’s copy of a video YouTube refuses when it is played', async () => {
    server.onFetch = { status: 'ready', url: `/api/show/videos/${ZOOM}/file`, progress: 100 };
    const { host, stage } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    // YouTube listed it as embeddable and its player says otherwise
    act(() => FakeYouTubePlayer.current!.fail(150));

    await waitFor(() => expect(called('POST', `/api/show/videos/${ZOOM}/fetch`)).toBe(true));
    const video = await stage.findByTestId('stage-file-video');
    expect(video).toHaveAttribute('src', `/api/show/videos/${ZOOM}/file`);
    expect(stage.queryByTestId('stage-youtube')).toBeNull();
  });

  it('waits on the card while a refused video’s copy is fetched', async () => {
    const { host, stage } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    act(() => FakeYouTubePlayer.current!.fail(150));

    expect(await host.findByText(/the server is fetching a copy/)).toBeInTheDocument();
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');
  });

  it('says so when a video is gone, and lets the host skip it', async () => {
    const { host } = openBoth();
    await addVideo(host, 'Alex', results[0].title);
    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    act(() => FakeYouTubePlayer.current!.fail(100));

    expect(host.getByRole('alert')).toHaveTextContent(/gone or private/);
    fireEvent.click(host.getByRole('button', { name: 'Skip' }));
    expect(within(host.getByTestId('show-sung')).getByText('Skipped')).toBeInTheDocument();
  });

  it('plays a library song in the host’s window with its lyrics on the stage', async () => {
    const { host, stage, stageRoot } = openBoth();
    await addLibrarySong(host, 'Cy');

    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));

    const audio = (await host.findByTestId('show-audio')) as HTMLAudioElement;
    expect(audio).toHaveAttribute('src', '/static/output/demo_mix.wav');
    fireEvent.canPlay(audio);
    expect(audio.play).toHaveBeenCalled();
    fireEvent.play(audio);
    expect(host.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    // The stage window follows the host's lyrics stage, as it does the studio's
    expect(stage.getByTestId('lyric-display-stage')).toBeInTheDocument();
    expect(stageRoot.querySelector('[data-testid="stage-window"]')).toHaveAttribute(
      'data-scene',
      'lyrics'
    );
    expect(FakeYouTubePlayer.instances).toHaveLength(0);

    fireEvent.ended(audio);
    expect(within(host.getByTestId('show-sung')).getByText('Cy')).toBeInTheDocument();
    expect(stage.queryByTestId('lyric-display-stage')).toBeNull();
  });
});
