/** Synthetic voices for pitch tests: a held note is a sine, a real voice has overtones. */

/** `seconds` of a pure tone at `hz`, as one channel of samples. */
export function sine(hz: number, sampleRate: number, samples: number, level = 0.5): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1)
    out[i] = level * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** A voice-like tone: a fundamental at `hz` with overtones, each at its own level. */
export function voiced(
  hz: number,
  sampleRate: number,
  samples: number,
  overtones: number[] = [1, 0.6, 0.4, 0.25]
): Float32Array {
  const out = new Float32Array(samples);
  const total = overtones.reduce((sum, level) => sum + Math.abs(level), 0) || 1;
  for (let i = 0; i < samples; i += 1) {
    let value = 0;
    overtones.forEach((level, n) => {
      value += level * Math.sin((2 * Math.PI * hz * (n + 1) * i) / sampleRate);
    });
    out[i] = (0.6 * value) / total;
  }
  return out;
}

/** Hiss: nothing with a pitch. The same every run. */
export function noise(samples: number, level = 0.3): Float32Array {
  const out = new Float32Array(samples);
  let seed = 12345;
  for (let i = 0; i < samples; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = level * ((seed / 0x7fffffff) * 2 - 1);
  }
  return out;
}

/** A note's frequency: MIDI 69 is A4 at 440 Hz. */
export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** How far `hz` is from `target`, in cents (a hundredth of a semitone). */
export const centsApart = (hz: number, target: number) => 1200 * Math.log2(hz / target);
