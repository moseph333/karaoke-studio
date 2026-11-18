import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import type { LyricLine } from '../../types';

const lines: LyricLine[] = [
  {
    id: 1,
    text: 'hello world',
    start_time: 1,
    end_time: 3,
    words: [
      { word: 'hello', start_time: 1, end_time: 2 },
      { word: 'world', start_time: 2, end_time: 3 },
    ],
  },
];

/** The stage as the studio renders it: the player's element, but no volume or mute props. */
function renderStage(volume: number, muted: boolean) {
  const audio = document.createElement('audio');
  audio.volume = volume;
  audio.muted = muted;
  const audioRef = { current: audio } as React.RefObject<HTMLAudioElement>;
  render(<LyricDisplay lines={lines} currentTime={0} duration={60} audioRef={audioRef} />);
  fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
  return audio;
}

/** What the transport dock or the M shortcut does to the player. */
function setOnPlayer(audio: HTMLAudioElement, volume: number, muted: boolean) {
  act(() => {
    audio.volume = volume;
    audio.muted = muted;
    audio.dispatchEvent(new Event('volumechange'));
  });
}

describe('the fullscreen stage volume without volume props', () => {
  it("starts at the player's volume, not at full", () => {
    renderStage(0.4, false);

    expect(screen.getByTestId('stage-volume-slider')).toHaveValue('0.4');
    expect(screen.getByRole('button', { name: 'Mute master audio' })).toBeInTheDocument();
  });

  it('shows a muted player as muted', () => {
    renderStage(0.7, true);

    expect(screen.getByRole('button', { name: 'Unmute master audio' })).toBeInTheDocument();
    expect(screen.getByTestId('stage-volume-slider')).toHaveValue('0');
  });

  it('follows a change made elsewhere while it is fullscreen', () => {
    const audio = renderStage(1, false);

    setOnPlayer(audio, 0.25, false);
    expect(screen.getByTestId('stage-volume-slider')).toHaveValue('0.25');

    setOnPlayer(audio, 0.25, true);
    expect(screen.getByRole('button', { name: 'Unmute master audio' })).toBeInTheDocument();
  });

  it('unmutes a player that was muted before the stage went fullscreen', () => {
    const audio = renderStage(0.7, true);

    fireEvent.click(screen.getByTestId('stage-volume-btn'));

    expect(audio.muted).toBe(false);
  });
});
