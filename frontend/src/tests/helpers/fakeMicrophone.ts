import { vi } from 'vitest';

/**
 * A microphone for tests: `navigator.mediaDevices.getUserMedia` answers with a stream whose
 * sound is whatever note the test says is being sung (`sing`), read through the mock audio
 * context's analyser. jsdom has no media devices and no sound of its own.
 */

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  /** The device going away: unplugged, or permission taken back. */
  end: () => void;
  addEventListener: (name: string, listener: () => void) => void;
}

export interface FakeMicrophone {
  /** The note being sung, in Hz; null is silence. */
  sing: (hz: number | null) => void;
  getUserMedia: ReturnType<typeof vi.fn>;
  /** Every track handed out. */
  tracks: FakeTrack[];
  /** Every audio context made for the microphone. */
  contexts: AudioContext[];
  /** The next request waits here until the test answers the browser's prompt. */
  hold: () => { allow: () => void; refuse: (name?: string) => void };
  /** Takes the fake away again. */
  restore: () => void;
}

export interface FakeMicrophoneOptions {
  /** Every request is refused with a DOMException of this name. */
  refuse?: 'NotAllowedError' | 'NotFoundError' | 'SecurityError' | 'NotReadableError';
}

export function installFakeMicrophone(options: FakeMicrophoneOptions = {}): FakeMicrophone {
  let hz: number | null = null;
  const tracks: FakeTrack[] = [];
  const contexts: AudioContext[] = [];
  let held: { resolve: (stream: MediaStream) => void; reject: (err: unknown) => void } | null =
    null;
  let holdNext = false;

  const stream = (): MediaStream => {
    const enders: Array<() => void> = [];
    const track: FakeTrack = {
      stop: vi.fn(),
      end: () => enders.forEach((listener) => listener()),
      addEventListener: (name, listener) => {
        if (name === 'ended') enders.push(listener);
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] } as unknown as MediaStream;
  };
  const refusal = (name: string) => Object.assign(new Error(name), { name });

  const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => {
    if (holdNext) {
      holdNext = false;
      return new Promise<MediaStream>((resolve, reject) => {
        held = { resolve, reject };
      });
    }
    return options.refuse ? Promise.reject(refusal(options.refuse)) : Promise.resolve(stream());
  });

  const Base = window.AudioContext as unknown as new () => AudioContext;
  class MicContext extends Base {
    constructor() {
      super();
      contexts.push(this);
      const make = this.createAnalyser.bind(this);
      const sampleRate = this.sampleRate;
      this.createAnalyser = vi.fn(() => {
        const analyser = make();
        analyser.getFloatTimeDomainData = vi.fn((array: Float32Array) => {
          for (let i = 0; i < array.length; i += 1) {
            array[i] = hz === null ? 0 : 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
          }
        }) as unknown as AnalyserNode['getFloatTimeDomainData'];
        return analyser;
      }) as unknown as AudioContext['createAnalyser'];
    }
  }
  const realContext = window.AudioContext;
  window.AudioContext = MicContext as unknown as typeof AudioContext;

  const realDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  return {
    sing: (next) => {
      hz = next;
    },
    getUserMedia,
    tracks,
    contexts,
    hold: () => {
      holdNext = true;
      return {
        allow: () => held?.resolve(stream()),
        refuse: (name = 'NotAllowedError') => held?.reject(refusal(name)),
      };
    },
    restore: () => {
      window.AudioContext = realContext;
      if (realDevices) Object.defineProperty(navigator, 'mediaDevices', realDevices);
      else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    },
  };
}
