/**
 * The singer's pitch from the microphone, for practice.
 *
 * `start` asks the browser for the microphone (it must be called from a click or a key press)
 * and, once allowed, reads the pitch about thirty times a second (`utils/pitchDetect`) and
 * hands each reading to whoever subscribed: the pitch display, the score. Readings are not
 * React state, which would re-render the studio thirty times a second.
 *
 * The sound is analysed in the page and goes nowhere: it is not recorded, not sent to the
 * server and never played back (the graph ends in a silent node, which some browsers need
 * before they run it at all).
 *
 * Echo cancellation is asked for, so speakers do not feed the song back into the reading;
 * noise suppression and automatic gain are turned off, because both mistake a held note for
 * noise or flatten it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectPitch, hzToMidi } from '../utils/pitchDetect';

/**
 * `asking`: waiting for the browser's permission prompt. `refused`: the user or the browser
 * said no. `unavailable`: no microphone, or a page that may not have one (not https).
 */
export type MicStatus = 'idle' | 'asking' | 'on' | 'refused' | 'unavailable';

export interface MicReading {
  /** The note sung as a MIDI note number (fractions included), or null when nothing clear. */
  midi: number | null;
  /** How long ago the sound was made, in seconds: the reading looks back over a window. */
  delay: number;
}

export interface UseMicPitchOptions {
  /** Practice is on; leaving it lets the microphone go. */
  enabled: boolean;
}

export interface UseMicPitchReturn {
  status: MicStatus;
  /** The singer asked for the microphone (whatever came of it). */
  wanted: boolean;
  /** Asks for the microphone. Call it from a click or a key press. */
  start: () => void;
  stop: () => void;
  /** Calls `listener` with every reading while the microphone is on; returns the undo. */
  subscribe: (listener: (reading: MicReading) => void) => () => void;
}

/** Samples looked at for one reading: enough for two periods of a low bass note. */
export const MIC_WINDOW = 2048;
/** Time between readings, in ms. */
export const MIC_INTERVAL_MS = 33;

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
};

interface Listening {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  timer: number;
}

/** Whether this page can ask for a microphone at all. */
export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    window.isSecureContext !== false
  );
}

function statusForError(err: unknown): MicStatus {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'refused' : 'unavailable';
}

export function useMicPitch({ enabled }: UseMicPitchOptions): UseMicPitchReturn {
  const [status, setStatus] = useState<MicStatus>('idle');
  const [wanted, setWanted] = useState(false);
  const listeningRef = useRef<Listening | null>(null);
  const listenersRef = useRef(new Set<(reading: MicReading) => void>());
  /** Counts `start` calls, so a permission answered after `stop` is dropped. */
  const askRef = useRef(0);

  const release = useCallback(() => {
    askRef.current += 1;
    const listening = listeningRef.current;
    listeningRef.current = null;
    if (!listening) return;
    window.clearInterval(listening.timer);
    listening.stream.getTracks().forEach((track) => track.stop());
    void Promise.resolve(listening.context.close()).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    release();
    setWanted(false);
    setStatus('idle');
  }, [release]);

  const start = useCallback(() => {
    if (!enabled) return;
    release();
    setWanted(true);
    if (!micSupported()) {
      setStatus('unavailable');
      return;
    }
    const ask = askRef.current;
    setStatus('asking');
    void navigator.mediaDevices
      .getUserMedia(MIC_CONSTRAINTS)
      .then((stream) => {
        if (ask !== askRef.current) {
          // Stopped, or asked again, before the answer came
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const context = new AudioContextClass();
        const analyser = context.createAnalyser();
        analyser.fftSize = MIC_WINDOW;
        analyser.smoothingTimeConstant = 0;
        context.createMediaStreamSource(stream).connect(analyser);
        // Heard by nobody: a graph that reaches no output is not run by every browser
        const silent = context.createGain();
        silent.gain.value = 0;
        analyser.connect(silent);
        silent.connect(context.destination);
        void Promise.resolve(context.resume?.()).catch(() => {});

        const buffer = new Float32Array(MIC_WINDOW);
        // The reading is of the window's middle, and the browser buffers before that
        const delay = MIC_WINDOW / 2 / context.sampleRate + (context.baseLatency || 0);
        const timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buffer);
          const pitch = detectPitch(buffer, context.sampleRate);
          const reading: MicReading = { midi: pitch ? hzToMidi(pitch.hz) : null, delay };
          listenersRef.current.forEach((listener) => listener(reading));
        }, MIC_INTERVAL_MS);
        listeningRef.current = { stream, context, analyser, buffer, timer };
        // Unplugged, or taken back in the browser's own controls
        stream.getTracks().forEach((track) =>
          track.addEventListener('ended', () => {
            if (listeningRef.current?.stream !== stream) return;
            release();
            setStatus('unavailable');
          })
        );
        setStatus('on');
      })
      .catch((err: unknown) => {
        if (ask !== askRef.current) return;
        setStatus(statusForError(err));
      });
  }, [enabled, release]);

  const subscribe = useCallback((listener: (reading: MicReading) => void) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Leaving practice lets the microphone go (during render for the switch, in an effect for
  // the device)
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setWanted(false);
      setStatus('idle');
    }
  }
  useEffect(() => {
    if (!enabled) release();
  }, [enabled, release]);

  // Closing or leaving the page, and the studio going away
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      release();
    };
  }, [stop, release]);

  return useMemo(
    () => ({ status, wanted, start, stop, subscribe }),
    [status, wanted, start, stop, subscribe]
  );
}
