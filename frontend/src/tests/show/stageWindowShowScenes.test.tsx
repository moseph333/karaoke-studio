/**
 * What a stage window shows for a show: the cards between singers, a YouTube karaoke video in
 * YouTube's player, and a video file. A video plays in the stage window, takes the host's
 * commands and reports back to the host that put it there.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StageWindow } from '../../components/stage-window/StageWindow';
import {
  STAGE_CHANNEL_NAME,
  type PlayerReport,
  type StageMessage,
  type StageScene,
} from '../../utils/stageLink';
import { YT_STATE } from '../../utils/youtube';
import { FakeYouTubePlayer, installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const HOST = 'host-1';

/** A show's host, as far as the stage window can tell: it sends scenes and hears reports. */
function openHost(id = HOST) {
  const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
  const reports: PlayerReport[] = [];
  channel.onmessage = (event: MessageEvent<StageMessage>) => {
    if (event.data.type === 'report' && event.data.to === id) reports.push(event.data.report);
  };
  const post = (message: StageMessage) => act(() => channel.postMessage(message));
  return {
    reports,
    show: (scene: StageScene | null) => post({ type: 'scene', from: id, scene }),
    command: (command: Extract<StageMessage, { type: 'player' }>['command']) =>
      post({ type: 'player', from: id, command }),
    /** Lets the player's API promise settle, so the player exists. */
    settle: () => act(async () => {}),
    last: () => reports[reports.length - 1],
  };
}

const sceneOf = () => screen.getByTestId('stage-window').getAttribute('data-scene');

beforeEach(() => installFakeYouTube());
afterEach(() => removeFakeYouTube());

describe('the cards between singers', () => {
  it('calls the next singer with their song, and who follows', () => {
    render(<StageWindow />);
    const host = openHost();

    host.show({
      kind: 'upnext',
      title: 'Thursday night',
      now: { singer: 'Alex', title: 'Dancing Queen', artist: 'ABBA' },
      next: [
        { singer: 'Bo', title: 'Halo' },
        { singer: 'Cy', title: 'Jolene' },
      ],
    });

    expect(sceneOf()).toBe('upnext');
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    expect(screen.getByText('Dancing Queen · ABBA')).toBeInTheDocument();
    expect(screen.getByText(/Thursday night/)).toBeInTheDocument();
    const then = screen.getByTestId('stage-coming-up');
    expect(then).toHaveTextContent('Bo');
    expect(then).toHaveTextContent('Jolene');
  });

  it('shows the night’s name when nobody is waiting', () => {
    render(<StageWindow />);
    const host = openHost();

    host.show({ kind: 'idle', title: 'Thursday night', next: [] });

    expect(screen.getByRole('heading', { name: 'Thursday night' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Karaoke Studio' })).toBeNull();
  });

  it('goes back to its own idle card when the host screen closes', () => {
    render(<StageWindow />);
    const host = openHost();
    host.show({ kind: 'idle', title: 'Thursday night', next: [] });

    host.show(null);

    expect(sceneOf()).toBe('none');
    expect(screen.getByRole('heading', { name: 'Karaoke Studio' })).toBeInTheDocument();
  });

  it('keeps its scene when another window says it is closing', () => {
    render(<StageWindow />);
    const host = openHost();
    host.show({ kind: 'idle', title: 'Thursday night', next: [] });

    openHost('someone-else').show(null);

    expect(sceneOf()).toBe('idle');
  });
});

describe('a YouTube video on the stage', () => {
  async function playVideo() {
    render(<StageWindow />);
    const host = openHost();
    host.show({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', play: 7 });
    await host.settle();
    const player = FakeYouTubePlayer.current!;
    return { host, player };
  }

  it('plays in YouTube’s player, without its controls, and starts by itself', async () => {
    const { player } = await playVideo();

    expect(sceneOf()).toBe('youtube');
    expect(player.options.videoId).toBe('dQw4w9WgXcQ');
    expect(player.options.playerVars).toMatchObject({
      autoplay: 1,
      controls: 0,
      origin: window.location.origin,
    });
    act(() => player.ready());
    expect(player.calls).toContain('play');
  });

  it('tells the host when it plays, where it is, and when it ends', async () => {
    const { host, player } = await playVideo();
    act(() => player.ready());

    act(() => player.setState(YT_STATE.playing, 12.5));
    expect(host.last()).toMatchObject({ play: 7, status: 'playing', time: 12.5, duration: 200 });

    act(() => player.setState(YT_STATE.paused, 30));
    expect(host.last()).toMatchObject({ status: 'paused', time: 30 });

    act(() => player.setState(YT_STATE.ended, 200));
    expect(host.last()).toMatchObject({ play: 7, status: 'ended' });
  });

  it.each([
    [101, 'embed'],
    [150, 'embed'],
    [153, 'embed'],
    [100, 'unavailable'],
    [2, 'unavailable'],
    [5, 'playback'],
  ])('reports YouTube’s error %i as %s', async (code, error) => {
    const { host, player } = await playVideo();

    act(() => player.fail(code));

    expect(host.last()).toMatchObject({ play: 7, status: 'error', error });
  });

  it('carries out the host’s commands', async () => {
    const { host, player } = await playVideo();

    host.command({ name: 'pause' });
    host.command({ name: 'seek', time: 42 });
    host.command({ name: 'play' });
    host.command({ name: 'volume', volume: 0.5, muted: false });

    expect(player.calls).toEqual(['pause', 'seek 42', 'play', 'volume 50', 'unmute']);
  });

  it('ignores commands from a window that is not its host', async () => {
    const { player } = await playVideo();

    openHost('someone-else').command({ name: 'pause' });

    expect(player.calls).toEqual([]);
  });

  it('pauses and plays on Space, and steps on the arrows, in its own window', async () => {
    const { player } = await playVideo();
    act(() => player.setState(YT_STATE.playing, 20));

    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(player.calls).toEqual(['pause', 'seek 25', 'seek 20']);
  });

  it('starts a fresh player when the same video is played again', async () => {
    const { host, player } = await playVideo();

    host.show({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', play: 8 });
    await host.settle();

    expect(player.destroyed).toBe(true);
    expect(FakeYouTubePlayer.current).not.toBe(player);
    act(() => FakeYouTubePlayer.current!.setState(YT_STATE.playing, 1));
    expect(host.last()).toMatchObject({ play: 8, status: 'playing' });
  });

  it('is taken down when the card comes back', async () => {
    const { host, player } = await playVideo();

    host.show({ kind: 'idle', title: 'Thursday night', next: [] });

    expect(player.destroyed).toBe(true);
    expect(screen.queryByTestId('stage-youtube')).toBeNull();
  });
});

describe('a video file on the stage', () => {
  it('plays the server’s copy and reports like the YouTube player', () => {
    render(<StageWindow />);
    const host = openHost();

    host.show({ kind: 'file', url: '/api/show/videos/dQw4w9WgXcQ/file', play: 3 });

    const video = screen.getByTestId('stage-file-video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', '/api/show/videos/dQw4w9WgXcQ/file');
    expect(video.play).toHaveBeenCalled();

    act(() => {
      fireEvent(video, new Event('playing'));
    });
    expect(host.last()).toMatchObject({ play: 3, status: 'playing' });

    act(() => {
      fireEvent(video, new Event('ended'));
    });
    expect(host.last()).toMatchObject({ play: 3, status: 'ended' });
  });

  it('reports a file that will not play', () => {
    render(<StageWindow />);
    const host = openHost();
    host.show({ kind: 'file', url: '/api/show/videos/dQw4w9WgXcQ/file', play: 3 });

    act(() => {
      fireEvent(screen.getByTestId('stage-file-video'), new Event('error'));
    });

    expect(host.last()).toMatchObject({ status: 'error', error: 'playback' });
  });

  it('takes the host’s volume and seek', () => {
    render(<StageWindow />);
    const host = openHost();
    host.show({ kind: 'file', url: '/api/show/videos/dQw4w9WgXcQ/file', play: 3 });
    const video = screen.getByTestId('stage-file-video') as HTMLVideoElement;

    host.command({ name: 'volume', volume: 0.25, muted: false });
    host.command({ name: 'seek', time: 61 });

    expect(video.volume).toBe(0.25);
    expect(video.currentTime).toBe(61);
  });
});
