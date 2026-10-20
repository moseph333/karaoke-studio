/**
 * Vocal Range & Pitch Mathematics Utilities
 *
 * Provides pitch conversions (Hz <-> MIDI <-> SPN note names), standard voice presets,
 * key transposition, and client-side multi-objective key recommendation optimization.
 */

import { VocalRangeData, VoicePreset, KeyRecommendation } from '../types';

export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

const PITCH_CLASS_MAP: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

/**
 * Converts a MIDI note number (e.g. 60) to Scientific Pitch Notation (e.g. "C4").
 */
export function midiToNoteName(midi: number): string {
  if (typeof midi !== 'number' || isNaN(midi) || !isFinite(midi)) return '-';
  const rounded = Math.round(midi);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Converts Scientific Pitch Notation (e.g. "C4", "C#3", "Db3") to a MIDI note number (e.g. 60).
 * Returns null if the string cannot be parsed.
 */
export function noteNameToMidi(noteName: string): number | null {
  if (!noteName || typeof noteName !== 'string') return null;
  const trimmed = noteName.trim();
  const match = trimmed.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = parseInt(match[3], 10);
  const pitchClass = `${letter}${accidental}`;

  const pitchIndex = PITCH_CLASS_MAP[pitchClass];
  if (pitchIndex === undefined) return null;

  return (octave + 1) * 12 + pitchIndex;
}

/**
 * Converts frequency in Hertz to fractional MIDI note number.
 * Returns null for invalid or non-positive values.
 */
export function hzToMidi(hz: number): number | null {
  if (typeof hz !== 'number' || isNaN(hz) || !isFinite(hz) || hz <= 0) return null;
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Converts a MIDI note number to fundamental frequency in Hertz.
 */
export function midiToHz(midi: number): number {
  if (typeof midi !== 'number' || isNaN(midi) || !isFinite(midi)) return 0;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface VoicePresetRange {
  name: VoicePreset;
  lowNote: string;
  highNote: string;
  lowMidi: number;
  highMidi: number;
  lowHz: number;
  highHz: number;
  description: string;
}

export const VOICE_PRESETS: Record<VoicePreset, VoicePresetRange> = {
  Bass: {
    name: 'Bass',
    lowNote: 'E2',
    highNote: 'E4',
    lowMidi: 40,
    highMidi: 64,
    lowHz: 82.41,
    highHz: 329.63,
    description: 'Deep male vocal range (E2–E4)',
  },
  Baritone: {
    name: 'Baritone',
    lowNote: 'A2',
    highNote: 'A4',
    lowMidi: 45,
    highMidi: 69,
    lowHz: 110.0,
    highHz: 440.0,
    description: 'Standard male vocal range (A2–A4)',
  },
  Tenor: {
    name: 'Tenor',
    lowNote: 'C3',
    highNote: 'C5',
    lowMidi: 48,
    highMidi: 72,
    lowHz: 130.81,
    highHz: 523.25,
    description: 'High male vocal range (C3–C5)',
  },
  Alto: {
    name: 'Alto',
    lowNote: 'F3',
    highNote: 'F5',
    lowMidi: 53,
    highMidi: 77,
    lowHz: 174.61,
    highHz: 698.46,
    description: 'Low female / Contralto range (F3–F5)',
  },
  'Mezzo-Soprano': {
    name: 'Mezzo-Soprano',
    lowNote: 'A3',
    highNote: 'A5',
    lowMidi: 57,
    highMidi: 81,
    lowHz: 220.0,
    highHz: 880.0,
    description: 'Middle female vocal range (A3–A5)',
  },
  Soprano: {
    name: 'Soprano',
    lowNote: 'C4',
    highNote: 'C6',
    lowMidi: 60,
    highMidi: 84,
    lowHz: 261.63,
    highHz: 1046.5,
    description: 'High female vocal range (C4–C6)',
  },
};

/**
 * Transposes a musical key name (e.g. "C# Minor" + -2 -> "B Minor").
 */
export function transposeKey(estimatedKey: string, semitones: number): string {
  if (!estimatedKey || estimatedKey === 'Unknown') return 'Unknown';
  const parts = estimatedKey.trim().split(/\s+/);
  if (parts.length < 2) return estimatedKey;
  const [root, ...rest] = parts;
  const mode = rest.join(' ');
  const rootMidi = noteNameToMidi(`${root}4`);
  if (rootMidi === null) return estimatedKey;
  const shiftedPitchIndex = (((rootMidi + semitones) % 12) + 12) % 12;
  const newRoot = NOTE_NAMES[shiftedPitchIndex];
  return `${newRoot} ${mode}`;
}

export interface RecommendKeyOptions {
  vocalRange?: VocalRangeData | null;
  targetPreset?: VoicePreset | null;
  customLowNote?: string | null;
  customHighNote?: string | null;
  minShift?: number; // default -12
  maxShift?: number; // default +12
}

/**
 * Client-side Smart Key Recommender matching the backend cost function.
 * Evaluates all candidate semitone shifts in [-12, +12] to fit vocal peaks into the target range.
 */
export function recommendKeyShift(options: RecommendKeyOptions): KeyRecommendation {
  const {
    vocalRange,
    targetPreset,
    customLowNote,
    customHighNote,
    minShift = -12,
    maxShift = 12,
  } = options;

  let targetLowMidi = 48; // Default Tenor C3
  let targetHighMidi = 72; // Default Tenor C5

  if (targetPreset && VOICE_PRESETS[targetPreset]) {
    targetLowMidi = VOICE_PRESETS[targetPreset].lowMidi;
    targetHighMidi = VOICE_PRESETS[targetPreset].highMidi;
  } else if (customLowNote && customHighNote) {
    const low = noteNameToMidi(customLowNote);
    const high = noteNameToMidi(customHighNote);
    if (low !== null && high !== null) {
      if (low <= high) {
        targetLowMidi = low;
        targetHighMidi = high;
      } else {
        targetLowMidi = high;
        targetHighMidi = low;
      }
    }
  }

  const targetMid = (targetLowMidi + targetHighMidi) / 2;

  if (!vocalRange || !vocalRange.is_voiced || !vocalRange.lowest_note || !vocalRange.highest_note) {
    return {
      recommended_semitones: 0,
      projected_key: vocalRange?.estimated_key || 'Original',
      projected_low_note: vocalRange?.lowest_note || '-',
      projected_high_note: vocalRange?.highest_note || '-',
      cost: 0,
      is_in_range: true,
    };
  }

  const songLowMidi = noteNameToMidi(vocalRange.lowest_note);
  const songHighMidi = noteNameToMidi(vocalRange.highest_note);

  if (songLowMidi === null || songHighMidi === null) {
    return {
      recommended_semitones: 0,
      projected_key: vocalRange.estimated_key,
      projected_low_note: vocalRange.lowest_note,
      projected_high_note: vocalRange.highest_note,
      cost: 0,
      is_in_range: true,
    };
  }

  const songMedianMidi = vocalRange.median_note
    ? (noteNameToMidi(vocalRange.median_note) ?? (songLowMidi + songHighMidi) / 2)
    : (songLowMidi + songHighMidi) / 2;

  let bestShift = 0;
  let minCost = Infinity;

  for (let s = minShift; s <= maxShift; s++) {
    const shiftedLow = songLowMidi + s;
    const shiftedHigh = songHighMidi + s;
    const shiftedMedian = songMedianMidi + s;

    const deltaHigh = Math.max(0, shiftedHigh - targetHighMidi);
    const deltaLow = Math.max(0, targetLowMidi - shiftedLow);

    const rangePenalty = 100 * (deltaHigh * deltaHigh) + 80 * (deltaLow * deltaLow);
    const centeringPenalty = 2 * Math.abs(shiftedMedian - targetMid);
    const shiftBias = 0.5 * Math.abs(s);

    const totalCost = rangePenalty + centeringPenalty + shiftBias;

    if (totalCost < minCost) {
      minCost = totalCost;
      bestShift = s;
    } else if (Math.abs(totalCost - minCost) < 1e-6) {
      if (Math.abs(s) < Math.abs(bestShift)) {
        minCost = totalCost;
        bestShift = s;
      }
    }
  }

  const projLowMidi = songLowMidi + bestShift;
  const projHighMidi = songHighMidi + bestShift;
  const isInRange = projLowMidi >= targetLowMidi && projHighMidi <= targetHighMidi;

  return {
    recommended_semitones: bestShift,
    projected_key: transposeKey(vocalRange.estimated_key, bestShift),
    projected_low_note: midiToNoteName(projLowMidi),
    projected_high_note: midiToNoteName(projHighMidi),
    cost: Math.round(minCost * 100) / 100,
    is_in_range: isInRange,
  };
}

export const COMMON_NOTE_OPTIONS: Array<{ note: string; midi: number; label: string }> = [];
for (let m = 36; m <= 84; m++) {
  const name = midiToNoteName(m);
  COMMON_NOTE_OPTIONS.push({
    note: name,
    midi: m,
    label: `${name} (~${Math.round(midiToHz(m))} Hz)`,
  });
}
