/**
 * A stage window beside the studio's stage: it draws the studio's stage at the studio's
 * moment of the song, hears edits and look changes, asks the studio to play, pause and seek,
 * goes idle when the song closes, and saves no stage settings of its own.
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
import { getStageLook } from '../../theme/stageLooks';
import { STAGE_SETTINGS_STORAGE_KEY } from '../../theme/stageSettingsStorage';
import { STAGE_CHANNEL_NAME, type StageMessage } from '../../utils/stageLink';
import type { LyricLine } from '../../types';

const lines: LyricLine[] = [
  {
    id: 1,
    text: 'first line here',
    start_time: 1,
    end_time: 4,
    words: [
      { word: 'first', start_time: 1, end_time: 2 },
      { word: 'line', start_time: 2, end_time: 3 },
      { word: 'here', start_time: 3, end_time: 4 },
    ],
  },
  {
    id: 2,
    text: 'second line now',
    start_time: 6,
    end_time: 9,
    words: [
      { word: 'second', start_time: 6, end_time: 7 },
      { word: 'line', start_time: 7, end_time: 8 },
      { word: 'now', start_time: 8, end_time: 9 },
    ],
  },
];

interface StudioProps {
  clock: PlaybackClock;
  stageLines?: LyricLine[];
  isPlaying?: boolean;
  lookId?: string;
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
}

/** The studio's stage, on a playback clock as in the app. */
function Studio({
  clock,
  stageLines = lines,
  isPlaying = false,
  lookId,
  onTogglePlay,
  onSeek,
}: StudioProps) {
  return (
    <PlaybackClockContext.Provider value={clock}>
      <LyricDisplay
        lines={stageLines}
        duration={60}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        selectedTheme={lookId ? getStageLook(lookId) : undefined}
        trackTitle="A Song"
        trackArtist="A Singer"
      />
    </PlaybackClockContext.Provider>
  );
}

/** Two windows of the app in one test page: each renders into its own container. */
function openBoth(props: Omit<StudioProps, 'clock'> = {}) {
  const clock = createPlaybackClock();
  const stageWindow = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const studio = render(<Studio clock={clock} {...props} />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const rerenderStudio = (next: Omit<StudioProps, 'clock'>) =>
    studio.rerender(<Studio clock={clock} {...props} {...next} />);
  return { clock, studio, stageWindow, rerenderStudio };
}

const frameOf = (container: HTMLElement) => within(container).getByTestId('stage-frame');
// Lower case: a look may draw its words in capitals
const wordsOn = (container: HTMLElement) => (frameOf(container).textContent ?? '').toLowerCase();

describe('a stage window with no studio stage', () => {
  it('shows its idle card and a way to fill the screen', () => {
    const { getByRole, queryByTestId } = render(<StageWindow />);

    expect(getByRole('heading', { name: 'Karaoke Studio' })).toBeInTheDocument();
    expect(getByRole('button', { name: /Fill this screen/ })).toBeInTheDocument();
    expect(queryByTestId('lyric-display-stage')).toBeNull();
  });
});

describe('a stage window beside the studio', () => {
  it('draws the same frame as the studio at the same moment', () => {
    const { clock, studio, stageWindow } = openBoth();

    act(() => clock.setTime(2.5, { seek: true }));

    expect(wordsOn(stageWindow.container)).toBe(wordsOn(studio.container));
    expect(wordsOn(stageWindow.container)).toContain('first');
    expect(frameOf(stageWindow.container).innerHTML).toBe(frameOf(studio.container).innerHTML);
  });

  it('is the screen alone: no toolbar, no controls', () => {
    const { stageWindow } = openBoth();
    const stage = within(stageWindow.container);

    expect(stage.getByTestId('lyric-display-stage')).toBeInTheDocument();
    expect(stage.queryByTestId('stage-toolbar')).toBeNull();
    expect(stage.queryByTestId('stage-floating-controls')).toBeNull();
  });

  it('follows the song as it moves to another line', () => {
    const { clock, studio, stageWindow } = openBoth();

    act(() => clock.setTime(7.5, { seek: true }));

    expect(wordsOn(stageWindow.container)).toContain('second');
    expect(wordsOn(stageWindow.container)).toBe(wordsOn(studio.container));
  });

  it('shows a lyric edit that has not been saved', () => {
    const { clock, stageWindow, rerenderStudio } = openBoth();
    act(() => clock.setTime(2.5, { seek: true }));

    const edited = [{ ...lines[0], text: 'changed line here' }, lines[1]];
    edited[0].words = [{ word: 'changed', start_time: 1, end_time: 2 }, ...lines[0].words.slice(1)];
    rerenderStudio({ stageLines: edited });

    expect(wordsOn(stageWindow.container)).toContain('changed');
    expect(wordsOn(stageWindow.container)).not.toContain('first');
  });

  it('changes look with the studio', () => {
    const { stageWindow, rerenderStudio } = openBoth({ lookId: 'marquee' });
    expect(frameOf(stageWindow.container)).toHaveAttribute('data-look', 'marquee');

    rerenderStudio({ lookId: 'songbook' });

    expect(frameOf(stageWindow.container)).toHaveAttribute('data-look', 'songbook');
  });

  it('picks up a stage that was already open when the window opens', () => {
    const clock = createPlaybackClock();
    clock.setTime(7.5, { seek: true });
    const studio = render(<Studio clock={clock} />, {
      container: document.body.appendChild(document.createElement('div')),
    });

    const stageWindow = render(<StageWindow />, {
      container: document.body.appendChild(document.createElement('div')),
    });

    expect(wordsOn(stageWindow.container)).toBe(wordsOn(studio.container));
    expect(wordsOn(stageWindow.container)).toContain('second');
  });

  it('goes back to its idle card when the song closes', () => {
    const { studio, stageWindow } = openBoth();
    expect(within(stageWindow.container).queryByTestId('lyric-display-stage')).not.toBeNull();

    studio.unmount();

    expect(within(stageWindow.container).queryByTestId('lyric-display-stage')).toBeNull();
    expect(
      within(stageWindow.container).getByRole('heading', { name: 'Karaoke Studio' })
    ).toBeInTheDocument();
  });

  it('saves no stage settings', () => {
    openBoth({ lookId: 'songbook' });

    expect(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY)).toBeNull();
  });
});

describe('the studio beside a stage window', () => {
  it('marks its button once a stage window is open', () => {
    const clock = createPlaybackClock();
    const studio = render(<Studio clock={clock} />, {
      container: document.body.appendChild(document.createElement('div')),
    });
    const button = () => within(studio.container).getByTestId('stage-window-open');
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(button()).toHaveAccessibleName('Open the stage window');

    render(<StageWindow />, {
      container: document.body.appendChild(document.createElement('div')),
    });

    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(button()).toHaveAccessibleName('Show the stage window');
  });

  it('unmarks it when the stage window closes', () => {
    const { studio } = openBoth();
    const button = () => within(studio.container).getByTestId('stage-window-open');
    expect(button()).toHaveAttribute('aria-pressed', 'true');

    // What a closing stage window says on its way out
    const closing = new BroadcastChannel(STAGE_CHANNEL_NAME);
    act(() => closing.postMessage({ type: 'closed' } satisfies StageMessage));
    closing.close();

    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('keys pressed in the stage window', () => {
  it('Space asks the studio to play', () => {
    const onTogglePlay = vi.fn();
    openBoth({ onTogglePlay });

    fireEvent.keyDown(window, { key: ' ' });

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('Space asks a playing studio to pause', () => {
    const onTogglePlay = vi.fn();
    openBoth({ onTogglePlay, isPlaying: true });

    fireEvent.keyDown(window, { key: ' ' });

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('the arrow keys ask for a seek of five seconds', () => {
    const onSeek = vi.fn();
    const { clock } = openBoth({ onSeek });
    act(() => clock.setTime(20, { seek: true }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(onSeek).toHaveBeenNthCalledWith(1, 25);
    expect(onSeek).toHaveBeenNthCalledWith(2, 15);
  });

  it('F fills the screen from the stage window', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    render(<StageWindow />);

    fireEvent.keyDown(window, { key: 'f' });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('a command that arrives late', () => {
  /** A stage window whose picture of the studio is out of date sends the command directly. */
  function sendAs(studioId: string, command: 'play' | 'pause') {
    const stale = new BroadcastChannel(STAGE_CHANNEL_NAME);
    act(() =>
      stale.postMessage({
        type: 'command',
        to: studioId,
        command: { name: command },
      } satisfies StageMessage)
    );
    stale.close();
  }

  /** The id the studio signs its messages with, read off the channel. */
  function studioIdOf(run: () => void): string {
    const listener = new BroadcastChannel(STAGE_CHANNEL_NAME);
    let id = '';
    listener.onmessage = (event: MessageEvent<StageMessage>) => {
      if (event.data.type === 'state') id = event.data.from;
    };
    run();
    listener.close();
    return id;
  }

  it('does not pause a song that a "play" was meant to start', () => {
    const onTogglePlay = vi.fn();
    const clock = createPlaybackClock();
    const id = studioIdOf(() => {
      render(<Studio clock={clock} isPlaying onTogglePlay={onTogglePlay} />);
    });

    sendAs(id, 'play');

    expect(id).not.toBe('');
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('is ignored by a studio it was not sent to', () => {
    const onTogglePlay = vi.fn();
    const clock = createPlaybackClock();
    render(<Studio clock={clock} onTogglePlay={onTogglePlay} />);

    sendAs('another-studio', 'play');

    expect(onTogglePlay).not.toHaveBeenCalled();
  });
});
