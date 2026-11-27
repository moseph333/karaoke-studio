/**
 * The original singer's player in practice: a second audio element that is never put in the
 * page, asked for at the master's key, kept with the master, and switched by its level alone
 * (no new mix).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  DEFAULT_VOCAL_LEVEL,
  FOLLOW_INTERVAL_MS,
  VOCAL_LEVEL_STORAGE_KEY,
  useOriginalVocal,
  type UseOriginalVocalOptions,
} from '../../hooks/useOriginalVocal';
import { captureAudioPlayers, installMediaPlayback } from '../helpers/audioPlayers';

interface Asked {
  url: string;
  semitones: number;
}

/** Every element the hook makes with `new Audio()`. */
let players: HTMLAudioElement[] = [];
let asked: Asked[] = [];
let answer: (semitones: number) => Response;

const vocalUrl = (semitones: number) =>
  semitones === 0 ? '/static/stems/song/vocals.wav' : `/static/output/vocal_${semitones}.wav?v=1`;

function setup(overrides: Partial<UseOriginalVocalOptions> = {}, { graph = true } = {}) {
  const master = document.createElement('audio');
  master.currentTime = 30;
  const analyserNode = graph
    ? (new AudioContext().createAnalyser() as unknown as AnalyserNode)
    : null;
  const initial: UseOriginalVocalOptions = {
    enabled: true,
    projectId: 'song',
    hasVocals: true,
    semitones: 0,
    audio: { audioRef: { current: master }, analyserNode },
    ...overrides,
  };
  const hook = renderHook((props: UseOriginalVocalOptions) => useOriginalVocal(props), {
    initialProps: initial,
  });
  return { ...hook, master, initial };
}

const vocal = () => players[players.length - 1];
/** The server has answered and the browser can play the file. */
async function loaded() {
  await waitFor(() => expect(vocal()?.src).toBeTruthy());
  act(() => void vocal().dispatchEvent(new Event('canplay')));
}
const masterPlays = (master: HTMLAudioElement) =>
  act(() => {
    void master.play();
    master.dispatchEvent(new Event('play'));
  });

describe('useOriginalVocal', () => {
  beforeEach(() => {
    players = captureAudioPlayers();
    asked = [];
    localStorage.clear();
    installMediaPlayback();
    answer = (semitones) =>
      new Response(JSON.stringify({ status: 'ok', url: vocalUrl(semitones), semitones }), {
        status: 200,
      });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input.toString();
      const semitones = JSON.parse(String(init?.body ?? '{}')).semitones ?? 0;
      asked.push({ url, semitones });
      return answer(semitones);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks for the vocals at the master’s key when practice opens', async () => {
    setup({ semitones: 2 });
    await loaded();
    expect(asked).toEqual([{ url: '/api/project/song/practice-vocal', semitones: 2 }]);
    expect(vocal().src).toContain('/static/output/vocal_2.wav?v=1');
  });

  it('does not ask while practice is off, or for a song without vocals', async () => {
    const off = setup({ enabled: false });
    const none = setup({ hasVocals: false });
    await act(async () => {});
    expect(asked).toEqual([]);
    expect(players).toEqual([]);
    expect(off.result.current.status).toBe('idle');
    expect(none.result.current.available).toBe(false);
  });

  it('keeps its player out of the page', async () => {
    setup();
    await loaded();
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    expect(vocal().isConnected).toBe(false);
  });

  it('is loading, then ready', async () => {
    const { result } = setup();
    expect(result.current.status).toBe('loading');
    await loaded();
    expect(result.current.status).toBe('ready');
    expect(result.current.on).toBe(false);
  });

  it('stays silent and still until the singer is switched on', async () => {
    const { master } = setup();
    await loaded();
    masterPlays(master);
    expect(vocal().paused).toBe(true);
  });

  it('joins the master where it is when switched on', async () => {
    const { result, master } = setup();
    await loaded();
    masterPlays(master);

    act(() => result.current.toggle());

    expect(result.current.on).toBe(true);
    expect(vocal().paused).toBe(false);
    expect(vocal().currentTime).toBeCloseTo(30, 0);
    expect(vocal().playbackRate).toBe(1);
  });

  it('switches by level alone: no request, no reload, still playing', async () => {
    const { result, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());
    const requests = asked.length;
    const source = vocal().src;
    const loads = vi.mocked(vocal().load).mock.calls.length;

    act(() => result.current.toggle());
    expect(result.current.on).toBe(false);
    // Still running beside the master, so switching on again is at once
    expect(vocal().paused).toBe(false);
    act(() => result.current.toggle());

    expect(asked).toHaveLength(requests);
    expect(vocal().src).toBe(source);
    expect(vi.mocked(vocal().load).mock.calls).toHaveLength(loads);
    expect(players).toHaveLength(1);
  });

  it('pauses, seeks and changes speed with the master', async () => {
    const { result, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());

    act(() => {
      master.currentTime = 12;
      master.dispatchEvent(new Event('seeked'));
    });
    expect(vocal().currentTime).toBeCloseTo(12, 0);

    act(() => {
      master.playbackRate = 0.5;
      master.dispatchEvent(new Event('ratechange'));
    });
    // Just after a jump the player is left alone, but it takes the master's speed at once
    expect(vocal().playbackRate).toBe(0.5);

    act(() => {
      master.pause();
      master.dispatchEvent(new Event('pause'));
    });
    expect(vocal().paused).toBe(true);
  });

  it('closes a small drift by speed, checked between the master’s events', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const { result, master } = setup();
    await vi.waitFor(() => expect(vocal()?.src).toBeTruthy());
    act(() => void vocal().dispatchEvent(new Event('canplay')));
    masterPlays(master);
    act(() => result.current.toggle());
    // Past the moment after a jump, a tenth of a second behind
    act(() => void vi.advanceTimersByTime(1000));
    master.currentTime = 40;
    vocal().currentTime = 39.9;

    act(() => void vi.advanceTimersByTime(FOLLOW_INTERVAL_MS));

    expect(vocal().playbackRate).toBeCloseTo(1.03);
    expect(vocal().currentTime).toBe(39.9);
  });

  it('finds the master when the dock’s player comes after practice has opened', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const master = document.createElement('audio');
    master.currentTime = 30;
    const audioRef: { current: HTMLAudioElement | null } = { current: null };
    const analyserNode = new AudioContext().createAnalyser() as unknown as AnalyserNode;
    const { result } = renderHook(() =>
      useOriginalVocal({
        enabled: true,
        projectId: 'song',
        hasVocals: true,
        semitones: 0,
        audio: { audioRef, analyserNode },
      })
    );
    await vi.waitFor(() => expect(vocal()?.src).toBeTruthy());
    act(() => void vocal().dispatchEvent(new Event('canplay')));
    act(() => result.current.toggle());

    // The dock mounts, and the song is started
    audioRef.current = master;
    act(() => void vi.advanceTimersByTime(FOLLOW_INTERVAL_MS));
    masterPlays(master);

    expect(vocal().paused).toBe(false);
    expect(vocal().currentTime).toBeCloseTo(30, 0);
    act(() => {
      master.pause();
      master.dispatchEvent(new Event('pause'));
    });
    expect(vocal().paused).toBe(true);
  });

  it('takes the master’s volume and mute', async () => {
    const { result, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());

    act(() => {
      master.volume = 0.4;
      master.muted = true;
      master.dispatchEvent(new Event('volumechange'));
    });

    expect(vocal().volume).toBeCloseTo(0.4);
    expect(vocal().muted).toBe(true);
  });

  it('carries the level on the element itself where there is no audio graph', async () => {
    const { result, master } = setup({}, { graph: false });
    await loaded();
    masterPlays(master);
    master.volume = 0.5;

    expect(vocal().muted).toBe(true);
    act(() => result.current.toggle());
    expect(vocal().muted).toBe(false);
    expect(vocal().volume).toBeCloseTo(0.5 * DEFAULT_VOCAL_LEVEL);

    act(() => result.current.setLevel(0.5));
    expect(vocal().volume).toBeCloseTo(0.25);

    act(() => result.current.toggle());
    expect(vocal().muted).toBe(true);
  });

  it('remembers the level', async () => {
    const first = setup();
    act(() => first.result.current.setLevel(0.35));
    expect(localStorage.getItem(VOCAL_LEVEL_STORAGE_KEY)).toBe('0.35');
    first.unmount();

    expect(setup().result.current.level).toBe(0.35);
  });

  it('keeps the level between nothing and full', () => {
    const { result } = setup();
    act(() => result.current.setLevel(4));
    expect(result.current.level).toBe(1);
    act(() => result.current.setLevel(-1));
    expect(result.current.level).toBe(0);
  });

  it('asks again at the new key when the master changes key, and stays switched on', async () => {
    const { result, rerender, initial, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());

    rerender({ ...initial, semitones: -3 });

    expect(result.current.on).toBe(true);
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(vocal().src).toContain('vocal_-3.wav'));
    expect(asked.map((request) => request.semitones)).toEqual([0, -3]);
    act(() => void vocal().dispatchEvent(new Event('canplay')));
    // The new file joins the master without another click
    expect(vocal().paused).toBe(false);
    expect(players).toHaveLength(1);
  });

  it('stops and lets go of the file when practice is left', async () => {
    const { result, rerender, initial, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());

    rerender({ ...initial, enabled: false });

    expect(result.current.on).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(vocal().paused).toBe(true);
    expect(vocal().getAttribute('src')).toBeNull();
  });

  it('switches off when another song opens', async () => {
    const { result, rerender, initial, master } = setup();
    await loaded();
    masterPlays(master);
    act(() => result.current.toggle());

    rerender({ ...initial, projectId: 'another' });

    expect(result.current.on).toBe(false);
    await waitFor(() =>
      expect(asked[asked.length - 1]?.url).toBe('/api/project/another/practice-vocal')
    );
  });

  it('says so when the server cannot give the vocals, and tries again when asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer = () => new Response(JSON.stringify({ detail: 'nope' }), { status: 400 });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('failed'));

    answer = (semitones) =>
      new Response(JSON.stringify({ status: 'ok', url: vocalUrl(semitones), semitones }));
    act(() => result.current.retry());
    await loaded();

    expect(result.current.status).toBe('ready');
    expect(asked).toHaveLength(2);
  });

  it('says so when the file will not play', async () => {
    const { result } = setup();
    await waitFor(() => expect(vocal()?.src).toBeTruthy());
    act(() => void vocal().dispatchEvent(new Event('error')));
    expect(result.current.status).toBe('failed');
  });

  it('waits for the first switch-on before fetching for a listener saving data', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
    try {
      const { result } = setup();
      await act(async () => {});
      expect(asked).toEqual([]);

      act(() => result.current.toggle());
      await waitFor(() => expect(asked).toHaveLength(1));
      expect(result.current.on).toBe(true);
    } finally {
      delete (navigator as unknown as { connection?: unknown }).connection;
    }
  });

  it('starts the player inside the click that first switches it on, silently if paused', async () => {
    const { result } = setup();
    await loaded();
    const play = vi.mocked(vocal().play);
    play.mockClear();

    await act(async () => result.current.toggle());

    // Started once from the click, then resting with the paused master
    expect(play).toHaveBeenCalledTimes(1);
    expect(vocal().paused).toBe(true);
    expect(vocal().currentTime).toBeCloseTo(30, 0);
  });

  it('ignores a toggle while practice is off', () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.toggle());
    expect(result.current.on).toBe(false);
  });
});

describe('the switch with an audio graph', () => {
  beforeEach(() => {
    players = captureAudioPlayers();
    asked = [];
    localStorage.clear();
    installMediaPlayback();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: 'ok', url: vocalUrl(0), semitones: 0 }), {
          status: 200,
        })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('fades a gain node and leaves the element at the master’s volume', async () => {
    const context = new AudioContext();
    const analyserNode = context.createAnalyser();
    const master = document.createElement('audio');
    master.volume = 0.6;
    const { result } = renderHook(() =>
      useOriginalVocal({
        enabled: true,
        projectId: 'song',
        hasVocals: true,
        semitones: 0,
        audio: { audioRef: { current: master }, analyserNode },
      })
    );
    await loaded();
    const createGain = vi.mocked(context.createGain);
    expect(createGain).toHaveBeenCalledTimes(1);
    const gain = createGain.mock.results[0].value as GainNode;
    expect(context.createMediaElementSource).toHaveBeenCalledWith(vocal());
    expect(gain.connect).toHaveBeenCalledWith(analyserNode);
    expect(gain.gain.value).toBe(0);

    masterPlays(master);
    act(() => result.current.toggle());
    expect(gain.gain.value).toBe(DEFAULT_VOCAL_LEVEL);
    expect(vocal().volume).toBeCloseTo(0.6);
    expect(vocal().muted).toBe(false);

    act(() => result.current.setLevel(0.3));
    expect(gain.gain.value).toBe(0.3);

    act(() => result.current.toggle());
    expect(gain.gain.value).toBe(0);
    // One graph for the element, however often it is switched
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  });
});
