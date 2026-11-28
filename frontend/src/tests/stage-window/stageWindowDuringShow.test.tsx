/**
 * A stage window while a show is on, with a studio tab open in the same browser: it draws
 * the lyrics stage the show's host sends and no other, whatever order the windows speak in.
 * Without a show it is the studio that spoke last, and when that one closes its song, the
 * stage of the one still open.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, within } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { StageWindow } from '../../components/stage-window/StageWindow';
import {
  createPlaybackClock,
  PlaybackClock,
  PlaybackClockContext,
} from '../../hooks/usePlaybackClock';
import { StageLeaderIdContext } from '../../hooks/useStageLeader';
import { STAGE_CHANNEL_NAME, type StageMessage, type StageScene } from '../../utils/stageLink';
import type { LyricLine } from '../../types';

const HOST = 'host-1';

const song = (first: string, second: string): LyricLine[] => [
  {
    id: 1,
    text: `${first} one`,
    start_time: 1,
    end_time: 4,
    words: [
      { word: first, start_time: 1, end_time: 2.5 },
      { word: 'one', start_time: 2.5, end_time: 4 },
    ],
  },
  {
    id: 2,
    text: `${second} two`,
    start_time: 6,
    end_time: 9,
    words: [
      { word: second, start_time: 6, end_time: 7.5 },
      { word: 'two', start_time: 7.5, end_time: 9 },
    ],
  },
];

const showSong = song('singer', 'chorus');
const studioSong = song('draft', 'edit');
const otherSong = song('demo', 'bridge');

interface Sender {
  clock: PlaybackClock;
  close: () => void;
  onTogglePlay: ReturnType<typeof vi.fn>;
}

/** A lyrics stage in a window of its own: a studio's, or (with `as`) the show host's. */
function openStage(lines: LyricLine[], options: { as?: string; at?: number } = {}): Sender {
  const clock = createPlaybackClock();
  clock.setTime(options.at ?? 2, { seek: true });
  const onTogglePlay = vi.fn();
  const view = render(
    <StageLeaderIdContext.Provider value={options.as ?? null}>
      <PlaybackClockContext.Provider value={clock}>
        <LyricDisplay
          lines={lines}
          duration={60}
          isPlaying={false}
          onTogglePlay={onTogglePlay}
          trackTitle="A Song"
        />
      </PlaybackClockContext.Provider>
    </StageLeaderIdContext.Provider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return { clock, close: () => view.unmount(), onTogglePlay };
}

function openStageWindow() {
  const view = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const root = view.container;
  return {
    root,
    words: () => (within(root).queryByTestId('stage-frame')?.textContent ?? '').toLowerCase(),
    scene: () => within(root).getByTestId('stage-window').getAttribute('data-scene'),
  };
}

/** The show's host, as far as its scenes go. */
function openHost(id = HOST) {
  const channel = new BroadcastChannel(STAGE_CHANNEL_NAME);
  const heard: StageMessage[] = [];
  channel.onmessage = (event: MessageEvent<StageMessage>) => heard.push(event.data);
  return {
    heard,
    show: (scene: StageScene | null) =>
      act(() => channel.postMessage({ type: 'scene', from: id, scene } satisfies StageMessage)),
  };
}

describe('a show’s song with a studio tab open beside it', () => {
  it('draws the host’s lyrics when the studio tab speaks after it', () => {
    const stage = openStageWindow();
    const host = openHost();
    host.show({ kind: 'lyrics' });
    openStage(showSong, { as: HOST });

    openStage(studioSong);

    expect(stage.words()).toContain('singer');
    expect(stage.words()).not.toContain('draft');
  });

  it('draws the host’s lyrics when the scene comes last', () => {
    // host's stage, then the studio's, then the scene: the order that used to leave the
    // studio's lyrics on the TV for the whole song
    const stage = openStageWindow();
    const host = openHost();
    openStage(showSong, { as: HOST });
    openStage(studioSong);
    expect(stage.words()).toContain('draft');

    host.show({ kind: 'lyrics' });

    expect(stage.words()).toContain('singer');
    expect(stage.words()).not.toContain('draft');
  });

  it('draws nothing, not the studio’s lyrics, until the host’s stage arrives', () => {
    const stage = openStageWindow();
    const host = openHost();
    openStage(studioSong);

    host.show({ kind: 'lyrics' });

    expect(stage.scene()).toBe('lyrics');
    expect(stage.words()).toBe('');

    openStage(showSong, { as: HOST });
    expect(stage.words()).toContain('singer');
  });

  it('keeps the host’s lyrics while the studio tab is edited', () => {
    const stage = openStageWindow();
    const host = openHost();
    host.show({ kind: 'lyrics' });
    openStage(showSong, { as: HOST });
    const studio = openStage(studioSong);

    // Every change in the studio sends its stage again
    act(() => studio.clock.setTime(7, { seek: true }));
    studio.close();
    openStage(otherSong);

    expect(stage.words()).toContain('singer');
  });

  it('follows the host’s place in the song, not the studio’s', () => {
    const stage = openStageWindow();
    const host = openHost();
    host.show({ kind: 'lyrics' });
    const show = openStage(showSong, { as: HOST, at: 2 });
    const studio = openStage(studioSong, { at: 2 });

    act(() => studio.clock.setTime(7, { seek: true }));
    expect(stage.words()).toContain('singer');

    act(() => show.clock.setTime(7, { seek: true }));
    expect(stage.words()).toContain('chorus');
  });

  it('sends Space to the host’s stage, not the studio’s', () => {
    const stage = openStageWindow();
    const host = openHost();
    host.show({ kind: 'lyrics' });
    const show = openStage(showSong, { as: HOST });
    const studio = openStage(studioSong);

    fireEvent.keyDown(stage.root.ownerDocument.defaultView as Window, { key: ' ' });

    expect(show.onTogglePlay).toHaveBeenCalledTimes(1);
    expect(studio.onTogglePlay).not.toHaveBeenCalled();
  });

  it('shows a card over both while the show has one up', () => {
    const stage = openStageWindow();
    const host = openHost();
    openStage(studioSong);

    host.show({ kind: 'idle', title: 'Thursday night', next: [] });

    expect(stage.scene()).toBe('idle');
    expect(within(stage.root).getByRole('heading', { name: 'Thursday night' })).toBeVisible();
  });

  it('goes back to the studio’s stage once the show closes', () => {
    const stage = openStageWindow();
    const host = openHost();
    openStage(studioSong);
    host.show({ kind: 'lyrics' });
    const show = openStage(showSong, { as: HOST });
    expect(stage.words()).toContain('singer');

    show.close();
    host.show(null);

    expect(stage.words()).toContain('draft');
  });
});

describe('two studio tabs and no show', () => {
  it('draws the one that spoke last', () => {
    const stage = openStageWindow();
    openStage(studioSong);

    openStage(otherSong);

    expect(stage.words()).toContain('demo');
  });

  it('goes back to the other’s stage when the last one closes its song', () => {
    const stage = openStageWindow();
    openStage(studioSong, { at: 7 });
    const second = openStage(otherSong);

    second.close();

    expect(stage.words()).toContain('edit');
  });

  it('shows its idle card when both have closed', () => {
    const stage = openStageWindow();
    const first = openStage(studioSong);
    const second = openStage(otherSong);

    second.close();
    first.close();

    expect(stage.scene()).toBe('none');
    expect(within(stage.root).getByRole('heading', { name: 'Karaoke Studio' })).toBeVisible();
  });
});
