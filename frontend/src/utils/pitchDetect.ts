/**
 * The pitch of a singing voice, from a moment of microphone sound. Practice draws it against
 * the song's melody. Everything here runs in the browser; the sound itself goes nowhere.
 *
 * The method is YIN (de Cheveigné and Kawahara): a voiced sound repeats itself every period,
 * so the sound is compared with itself shifted by every candidate period and the shift at
 * which the two differ least is the period. It names the note a voice sings, not the octave
 * above it, which a plain spectrum peak often does. The server reads the song's own melody
 * the same way (`backend/services/vocal_analyzer.py`).
 */

export interface PitchReading {
  /** The fundamental frequency in Hz. */
  hz: number;
  /** How clearly the sound repeats, 0 to 1: a clean held note is near 1. */
  clarity: number;
}

export interface PitchOptions {
  /** The lowest note listened for, in Hz (a low bass voice). */
  minHz?: number;
  /** The highest (a soprano's top). */
  maxHz?: number;
  /** A candidate period counts when the sound differs from itself by less than this share. */
  threshold?: number;
  /** Quieter than this (RMS, full scale 1) is not singing. */
  minRms?: number;
}

export const DEFAULT_MIN_HZ = 70;
export const DEFAULT_MAX_HZ = 1100;
const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_MIN_RMS = 0.01;

/** A frequency as a MIDI note number (A4, 440 Hz, is 69), fractions included. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A MIDI note number as a name with its octave: 69 is "A4", 60 is "C4". */
export function midiToNoteName(midi: number): string {
  const note = Math.round(midi);
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

/**
 * The pitch in `samples` (one channel, -1 to 1), or null when nothing clear is sung: too
 * quiet, noise, or a buffer too short to hold two periods of the lowest note.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchOptions = {}
): PitchReading | null {
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minRms = options.minRms ?? DEFAULT_MIN_RMS;
  if (!(sampleRate > 0) || samples.length < 4) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(samples.length / 2), Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin) return null;
  // Every shift is compared over the same stretch, so they can be compared with each other
  const length = samples.length - tauMax;

  let energy = 0;
  for (let i = 0; i < length; i += 1) energy += samples[i] * samples[i];
  if (!Number.isFinite(energy) || Math.sqrt(energy / length) < minRms) return null;

  // How much the sound differs from itself shifted by tau, each divided by the mean of the
  // differences up to it: 1 at first, dipping toward 0 at the period
  const normalized = new Float32Array(tauMax + 1);
  normalized[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let difference = 0;
    for (let i = 0; i < length; i += 1) {
      const delta = samples[i] - samples[i + tau];
      difference += delta * delta;
    }
    running += difference;
    normalized[tau] = running > 0 ? (difference * tau) / running : 1;
  }

  // The first dip under the threshold, followed down to its lowest point
  let period = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (normalized[tau] < threshold) {
      while (tau + 1 <= tauMax && normalized[tau + 1] < normalized[tau]) tau += 1;
      period = tau;
      break;
    }
  }
  if (period < 0) return null;

  // The true period usually falls between two samples: a parabola through the three points
  // around the dip finds it
  let refined = period;
  if (period > 1 && period < tauMax) {
    const before = normalized[period - 1];
    const at = normalized[period];
    const after = normalized[period + 1];
    const curve = before - 2 * at + after;
    if (curve > 0) refined = period + (before - after) / (2 * curve);
  }
  const hz = sampleRate / refined;
  if (!Number.isFinite(hz) || hz < minHz * 0.9 || hz > maxHz * 1.1) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - normalized[period])) };
}
