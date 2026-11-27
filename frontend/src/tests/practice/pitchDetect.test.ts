/**
 * Pitch from a moment of microphone sound: the note a voice sings is named to within a tenth
 * of a semitone across the range of voices, by its fundamental and not an overtone, and
 * silence, hiss and too little sound give no note at all.
 */
import { describe, it, expect } from 'vitest';
import { detectPitch, hzToMidi, midiToNoteName } from '../../utils/pitchDetect';
import { centsApart, midiToHz, noise, sine, voiced } from '../helpers/tones';

const WINDOW = 2048;

describe('detectPitch', () => {
  for (const sampleRate of [44100, 48000]) {
    // E2 (a low bass note) to A5 (a soprano's high note)
    for (const midi of [40, 45, 52, 57, 60, 64, 69, 72, 76, 81]) {
      const hz = midiToHz(midi);
      it(`names ${midiToNoteName(midi)} (${hz.toFixed(1)} Hz) at ${sampleRate} Hz`, () => {
        const reading = detectPitch(sine(hz, sampleRate, WINDOW), sampleRate);
        expect(reading).not.toBeNull();
        expect(Math.abs(centsApart(reading!.hz, hz))).toBeLessThan(10);
        expect(reading!.clarity).toBeGreaterThan(0.9);
      });
    }
  }

  it('names notes between the keys of a piano', () => {
    // A voice a third of a semitone sharp of A3
    const hz = midiToHz(57.33);
    const reading = detectPitch(sine(hz, 48000, WINDOW), 48000);
    expect(hzToMidi(reading!.hz)).toBeCloseTo(57.33, 1);
  });

  it('names the fundamental of a voice, not its overtones', () => {
    for (const midi of [45, 57, 64]) {
      const hz = midiToHz(midi);
      const reading = detectPitch(voiced(hz, 48000, WINDOW), 48000);
      expect(Math.abs(centsApart(reading!.hz, hz))).toBeLessThan(15);
    }
  });

  it('still names the fundamental when an overtone is louder than it', () => {
    const hz = midiToHz(52);
    const reading = detectPitch(voiced(hz, 48000, WINDOW, [0.3, 1, 0.5]), 48000);
    expect(Math.abs(centsApart(reading!.hz, hz))).toBeLessThan(20);
  });

  it('hears a quiet voice, and not what is under the floor', () => {
    const hz = midiToHz(60);
    expect(detectPitch(sine(hz, 48000, WINDOW, 0.03), 48000)).not.toBeNull();
    expect(detectPitch(sine(hz, 48000, WINDOW, 0.004), 48000)).toBeNull();
  });

  it('gives nothing for silence', () => {
    expect(detectPitch(new Float32Array(WINDOW), 48000)).toBeNull();
  });

  it('gives nothing for hiss', () => {
    expect(detectPitch(noise(WINDOW), 48000)).toBeNull();
  });

  it('gives nothing for too little sound or a rate that makes no sense', () => {
    expect(detectPitch(new Float32Array(0), 48000)).toBeNull();
    expect(detectPitch(sine(220, 48000, 64), 48000)).toBeNull();
    expect(detectPitch(sine(220, 48000, WINDOW), 0)).toBeNull();
    expect(detectPitch(sine(220, 48000, WINDOW), Number.NaN)).toBeNull();
  });

  it('gives nothing for sound that is not a number', () => {
    const broken = sine(220, 48000, WINDOW);
    broken[100] = Number.NaN;
    expect(detectPitch(broken, 48000)).toBeNull();
  });

  it('keeps to the range it is told to listen in', () => {
    const low = sine(60, 48000, 4096);
    expect(detectPitch(low, 48000)).toBeNull();
    expect(detectPitch(low, 48000, { minHz: 50 })).not.toBeNull();
  });

  it('is fast enough to run thirty times a second', () => {
    const samples = voiced(110, 48000, WINDOW);
    const started = performance.now();
    for (let n = 0; n < 30; n += 1) detectPitch(samples, 48000);
    // A second's worth of readings: far under a second even on a slow machine
    expect(performance.now() - started).toBeLessThan(600);
  });
});

describe('note names', () => {
  it('names notes with their octave', () => {
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(61)).toBe('C♯4');
    expect(midiToNoteName(59.6)).toBe('C4');
    expect(midiToNoteName(40)).toBe('E2');
  });

  it('turns a frequency into a note number', () => {
    expect(hzToMidi(440)).toBe(69);
    expect(hzToMidi(220)).toBe(57);
    expect(hzToMidi(261.63)).toBeCloseTo(60, 2);
  });
});
