/**
 * The microphone in practice: asked for only when the singer asks, read about thirty times a
 * second into notes, heard by nobody, and let go when practice is left, the page is hidden
 * or the studio goes away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  MIC_CONSTRAINTS,
  MIC_INTERVAL_MS,
  MIC_WINDOW,
  useMicPitch,
  type MicReading,
} from '../../hooks/useMicPitch';
import { installFakeMicrophone, type FakeMicrophone } from '../helpers/fakeMicrophone';

let mic: FakeMicrophone;

function setup(enabled = true) {
  const readings: MicReading[] = [];
  const hook = renderHook((props: { enabled: boolean }) => useMicPitch(props), {
    initialProps: { enabled },
  });
  const unsubscribe = hook.result.current.subscribe((reading) => readings.push(reading));
  return { ...hook, readings, unsubscribe };
}

/** Starts the microphone and lets the browser's answer arrive. */
async function start(result: { current: ReturnType<typeof useMicPitch> }) {
  await act(async () => {
    result.current.start();
    await Promise.resolve();
  });
}

const tick = (times = 1) => act(() => void vi.advanceTimersByTime(MIC_INTERVAL_MS * times));

describe('useMicPitch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    mic = installFakeMicrophone();
  });

  afterEach(() => {
    mic.restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not touch the microphone until it is asked for', () => {
    const { result } = setup();
    expect(result.current.status).toBe('idle');
    expect(result.current.wanted).toBe(false);
    expect(mic.getUserMedia).not.toHaveBeenCalled();
  });

  it('asks with echo cancelling on and the processing that flattens a held note off', async () => {
    const { result } = setup();
    await start(result);
    expect(mic.getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS).toEqual({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
  });

  it('is asking while the browser waits for an answer, then on', async () => {
    const prompt = mic.hold();
    const { result } = setup();
    act(() => result.current.start());
    expect(result.current.status).toBe('asking');
    expect(result.current.wanted).toBe(true);

    await act(async () => prompt.allow());
    expect(result.current.status).toBe('on');
  });

  it('reads the note being sung', async () => {
    const { result, readings } = setup();
    await start(result);
    mic.sing(220);
    tick(3);

    expect(readings).toHaveLength(3);
    expect(readings[0].midi).toBeCloseTo(57, 1);
    // The reading is of the middle of its window: a little while ago
    expect(readings[0].delay).toBeCloseTo(MIC_WINDOW / 2 / 44100, 4);
  });

  it('reads nothing while nobody sings', async () => {
    const { result, readings } = setup();
    await start(result);
    mic.sing(null);
    tick(2);
    expect(readings.map((reading) => reading.midi)).toEqual([null, null]);
  });

  it('follows the voice from note to note', async () => {
    const { result, readings } = setup();
    await start(result);
    mic.sing(220);
    tick();
    mic.sing(329.63);
    tick();
    expect(readings.map((reading) => Math.round(reading.midi!))).toEqual([57, 64]);
  });

  it('is heard by nobody: the sound ends in a silent node', async () => {
    const { result } = setup();
    await start(result);
    const context = mic.contexts[0];
    const analyser = vi.mocked(context.createAnalyser).mock.results[0].value as AnalyserNode;
    const silent = vi.mocked(context.createGain).mock.results[0].value as GainNode;

    expect(silent.gain.value).toBe(0);
    expect(analyser.connect).toHaveBeenCalledWith(silent);
    expect(silent.connect).toHaveBeenCalledWith(context.destination);
    // The microphone itself is never wired to the output
    const source = vi.mocked(context.createMediaStreamSource).mock.results[0].value as AudioNode;
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(analyser);
  });

  it('stops reading and lets the device go when stopped', async () => {
    const { result, readings } = setup();
    await start(result);
    mic.sing(220);
    tick();

    act(() => result.current.stop());

    expect(result.current.status).toBe('idle');
    expect(result.current.wanted).toBe(false);
    expect(mic.tracks[0].stop).toHaveBeenCalled();
    expect(mic.contexts[0].close).toHaveBeenCalled();
    tick(5);
    expect(readings).toHaveLength(1);
  });

  it('lets the device go when practice is left', async () => {
    const { result, rerender } = setup();
    await start(result);

    rerender({ enabled: false });

    expect(result.current.status).toBe('idle');
    expect(result.current.wanted).toBe(false);
    expect(mic.tracks[0].stop).toHaveBeenCalled();
  });

  it('lets the device go when the studio goes away, and when the page is hidden', async () => {
    const gone = setup();
    await start(gone.result);
    gone.unmount();
    expect(mic.tracks[0].stop).toHaveBeenCalled();

    const hidden = setup();
    await start(hidden.result);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(mic.tracks[1].stop).toHaveBeenCalled();
    expect(hidden.result.current.status).toBe('idle');
  });

  it('will not start while practice is off', () => {
    const { result } = setup(false);
    act(() => result.current.start());
    expect(mic.getUserMedia).not.toHaveBeenCalled();
    expect(result.current.wanted).toBe(false);
  });

  it('says refused when the browser says no', async () => {
    mic.restore();
    mic = installFakeMicrophone({ refuse: 'NotAllowedError' });
    const { result } = setup();
    await start(result);
    expect(result.current.status).toBe('refused');
    // Still wanted: the lane stays, with the melody alone
    expect(result.current.wanted).toBe(true);
  });

  it('says unavailable when there is no microphone to use', async () => {
    mic.restore();
    mic = installFakeMicrophone({ refuse: 'NotFoundError' });
    const { result } = setup();
    await start(result);
    expect(result.current.status).toBe('unavailable');
  });

  it('says unavailable on a page that may not have a microphone', async () => {
    mic.restore();
    const { result } = setup();
    await start(result);
    expect(result.current.status).toBe('unavailable');
    mic = installFakeMicrophone();
  });

  it('says unavailable on an address that is not secure', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    try {
      const { result } = setup();
      await start(result);
      expect(result.current.status).toBe('unavailable');
      expect(mic.getUserMedia).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { isSecureContext?: boolean }).isSecureContext;
    }
  });

  it('drops a permission that arrives after it was stopped', async () => {
    const prompt = mic.hold();
    const { result } = setup();
    act(() => result.current.start());
    act(() => result.current.stop());

    await act(async () => prompt.allow());

    expect(result.current.status).toBe('idle');
    // The stream that came anyway is closed at once
    expect(mic.tracks[0].stop).toHaveBeenCalled();
    expect(mic.contexts).toHaveLength(0);
  });

  it('says unavailable when the microphone is unplugged', async () => {
    const { result, readings } = setup();
    await start(result);
    act(() => mic.tracks[0].end());
    expect(result.current.status).toBe('unavailable');
    tick(3);
    expect(readings).toHaveLength(0);
  });

  it('stops telling a listener that has left', async () => {
    const { result, readings, unsubscribe } = setup();
    await start(result);
    mic.sing(220);
    tick();
    unsubscribe();
    tick(3);
    expect(readings).toHaveLength(1);
  });
});
