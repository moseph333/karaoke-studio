/**
 * The score in the studio's practice panel: sing a part through with the microphone on and
 * the panel says how much of it was in tune, the part's row shows it, and a repeat going
 * round scores each pass by itself.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { MIC_INTERVAL_MS } from '../../hooks/useMicPitch';
import { installMediaPlayback } from '../helpers/audioPlayers';
import { installFakeMicrophone, type FakeMicrophone } from '../helpers/fakeMicrophone';
import { PRACTICE_SONG, mockPracticeFetch } from '../helpers/practiceFixtures';
import { midiToHz } from '../helpers/tones';

beforeAll(() => loadDeferredScreens());

let mic: FakeMicrophone;

const A3 = midiToHz(57); // the fixture melody's note
const master = () => screen.getByTestId('audio-element') as HTMLAudioElement;
const status = () => screen.getByTestId('practice-score');
const partScore = (number: number) => screen.queryByTestId(`practice-part-score-${number}`);

async function openWithMicrophone() {
  window.history.pushState({}, '', `/?project=${PRACTICE_SONG.id}&practice=1`);
  render(<App />);
  await screen.findByTestId('practice-panel');
  await act(async () => {
    fireEvent.click(screen.getByRole('switch', { name: 'See your pitch' }));
    await Promise.resolve();
  });
  await screen.findByText(/The grey line is the song/);
}

/** The song plays from `from` to `to` (song seconds), the microphone reading as it goes: ten
 *  readings a second, which is enough to tick off every frame of the melody and keeps the
 *  test quick (each step redraws the stage). */
function playThrough(from: number, to: number) {
  act(() => {
    for (let time = from; time <= to; time += 0.1) {
      master().currentTime = time;
      fireEvent.timeUpdate(master());
      vi.advanceTimersByTime(MIC_INTERVAL_MS);
    }
  });
}

/** Starts the song; the player says it is playing a moment after the click. */
async function play() {
  fireEvent.click(screen.getByRole('button', { name: /start playback/i }));
  await screen.findByRole('button', { name: /pause playback/i });
}
const pause = () => fireEvent.click(screen.getByRole('button', { name: /pause playback/i }));

describe('the score in the practice panel', () => {
  beforeEach(() => {
    localStorage.clear();
    // Only the microphone's and the player's ticks are stepped by hand
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    installMediaPlayback();
    mockPracticeFetch();
    mic = installFakeMicrophone();
  });

  afterEach(() => {
    mic.restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('says nothing before a pass, beyond how to get a score', async () => {
    await openWithMicrophone();
    expect(status()).toBeEmptyDOMElement();
    expect(status()).toHaveAttribute('role', 'status');
    expect(screen.getByText(/Sing a part through to see how much of it was in tune/)).toBeVisible();
    expect(partScore(1)).toBeNull();
  });

  it('scores a part sung through in tune when the song is paused', async () => {
    await openWithMicrophone();
    mic.sing(A3);
    await play();
    playThrough(9, 19);
    pause();

    await waitFor(() =>
      expect(status()).toHaveTextContent('Last pass: 100% in tune, lines 1 to 3.')
    );
    expect(status()).toHaveTextContent('Best: 100%.');
    expect(partScore(1)).toHaveTextContent('100% in tune');
    expect(partScore(2)).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Repeat part 1: Morning comes in slowly, 100% in tune last time',
      })
    ).toBeInTheDocument();
    // The hint gives way to the score
    expect(screen.queryByText(/Sing a part through/)).toBeNull();
  });

  it('gives a low score for the wrong note', async () => {
    await openWithMicrophone();
    mic.sing(midiToHz(61));
    await play();
    playThrough(9, 19);
    pause();

    await waitFor(() => expect(status()).toHaveTextContent('Last pass: 0% in tune, lines 1 to 3.'));
    expect(partScore(1)).toHaveTextContent('0% in tune');
  });

  it('gives part marks for a part half sung', async () => {
    await openWithMicrophone();
    await play();
    mic.sing(A3);
    playThrough(9, 14.2);
    mic.sing(null);
    playThrough(14.2, 19);
    pause();

    await waitFor(() => expect(status()).toHaveTextContent(/Last pass: \d+% in tune/));
    const share = Number(/Last pass: (\d+)%/.exec(status().textContent ?? '')![1]);
    // Lines 1 and half of line 2, of three lines
    expect(share).toBeGreaterThan(40);
    expect(share).toBeLessThan(65);
  });

  it('scores each pass of a repeat by itself, and keeps the best', async () => {
    await openWithMicrophone();
    fireEvent.click(screen.getByRole('button', { name: /^Repeat part 1:/ }));
    await play();

    // First pass in tune: at the turn (18.5 s + 0.6 s) the part goes round
    mic.sing(A3);
    playThrough(8, 19.2);
    await waitFor(() =>
      expect(status()).toHaveTextContent('Last pass: 100% in tune, lines 1 to 3.')
    );
    expect(master().currentTime).toBe(8);

    // Second pass silent
    mic.sing(null);
    playThrough(8, 19.2);
    await waitFor(() => expect(status()).toHaveTextContent('Last pass: 0% in tune, lines 1 to 3.'));
    expect(status()).toHaveTextContent('Best: 100%.');
    expect(partScore(1)).toHaveTextContent('0% in tune');
  });

  it('takes the score away with the microphone', async () => {
    await openWithMicrophone();
    mic.sing(A3);
    await play();
    playThrough(9, 19);
    pause();
    await waitFor(() => expect(status()).toHaveTextContent('Last pass: 100%'));

    fireEvent.click(screen.getByRole('switch', { name: 'See your pitch' }));
    expect(status()).toBeEmptyDOMElement();
  });
});
