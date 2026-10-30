/**
 * The playback position is a store, not App state: media timeupdates reach the transport
 * time and the stage without re-rendering the rest of the studio, and opening another song
 * starts it from the top, paused.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';
import { ProjectState } from '../types';

const renders = vi.hoisted(() => ({ themePicker: 0, audioControls: 0 }));

vi.mock('../components/VisualThemePicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/VisualThemePicker')>();
  const Counted: typeof actual.VisualThemePicker = (props) => {
    renders.themePicker++;
    return <actual.VisualThemePicker {...props} />;
  };
  return { ...actual, VisualThemePicker: Counted };
});

vi.mock('../components/AudioControls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/AudioControls')>();
  const Counted: typeof actual.AudioControls = (props) => {
    renders.audioControls++;
    return <actual.AudioControls {...props} />;
  };
  return { ...actual, AudioControls: Counted };
});

const song: ProjectState = {
  id: 'iso-song',
  title: 'Isolation Anthem',
  artist: 'Render Counter',
  status: 'ready',
  progress: 100,
  duration: 180,
  lines: [
    {
      id: 1,
      text: 'First line here',
      start_time: 1.0,
      end_time: 3.0,
      words: [
        { word: 'First', start_time: 1.0, end_time: 1.6 },
        { word: 'line', start_time: 1.6, end_time: 2.2 },
        { word: 'here', start_time: 2.2, end_time: 3.0 },
      ],
    },
  ],
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/iso-song.wav',
};
const secondSong: ProjectState = {
  ...song,
  id: 'second-song',
  title: 'Second Song',
  master_audio_url: '/static/output/second-song.wav',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('App render isolation during playback', () => {
  beforeEach(() => {
    renders.themePicker = 0;
    renders.audioControls = 0;
    window.history.pushState({}, '', `/?project=${song.id}`);
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { value: false, configurable: true });
        return Promise.resolve();
      }),
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { value: true, configurable: true });
      }),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/api/projects')) {
        return json({ [song.id]: song, [secondSong.id]: secondSong });
      }
      if (url.endsWith(`/api/project/${song.id}`)) return json(song);
      if (url.endsWith(`/api/project/${secondSong.id}`)) return json(secondSong);
      return json({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const openStudioAndPlay = async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('audio-element')).toBeInTheDocument());
    const audio = screen.getByTestId('audio-element') as HTMLAudioElement;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start playback' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeInTheDocument()
    );
    return audio;
  };

  const timeUpdate = (audio: HTMLAudioElement, time: number) =>
    act(() => {
      audio.currentTime = time;
      fireEvent.timeUpdate(audio);
    });

  it('moves the transport time and the stage without re-rendering the inspector', async () => {
    const audio = await openStudioAndPlay();
    timeUpdate(audio, 1.0);
    const firstWord = screen.getByTestId('word-sung-0');
    expect(parseFloat(firstWord.style.width)).toBeLessThan(100);
    const before = { ...renders };
    expect(before.themePicker).toBeGreaterThan(0);
    expect(before.audioControls).toBeGreaterThan(0);

    for (const t of [1.25, 1.5, 1.75, 2.0, 2.25]) timeUpdate(audio, t);

    expect(screen.getByTestId('transport-time')).toHaveTextContent('0:02');
    expect(parseFloat(screen.getByTestId('word-sung-0').style.width)).toBe(100);
    expect(renders).toEqual(before);
  });

  it('opens another song from the library at 0:00, paused', async () => {
    const audio = await openStudioAndPlay();
    timeUpdate(audio, 42);
    expect(screen.getByTestId('transport-time')).toHaveTextContent('0:42');

    fireEvent.click(screen.getByRole('button', { name: /new song/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /community library/i }));
    fireEvent.click(await screen.findByRole('button', { name: secondSong.title }));

    await waitFor(() => expect(document.title).toContain(secondSong.title as string));
    expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
    expect(screen.getByRole('button', { name: 'Start playback' })).toBeInTheDocument();
  });
});
