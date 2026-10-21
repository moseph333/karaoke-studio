/**
 * Harmonic Chord Transposition & Enharmonic Spelling Engine
 *
 * Full-fidelity TypeScript port of backend/services/chord_detector.py.
 * Provides key-aware chromatic transposition across [-12, +12] semitones,
 * circle-of-fifths enharmonic spelling (flat vs. sharp keys), unicode accidental
 * normalization (♯ -> #, ♭ -> b), slash chords (e.g. C/G, Am7/F#), silence
 * token normalization ("N"), and octave/identity preservation.
 */

import { ChordSegment } from '../types';

// Canonical 12-pitch chromatic scales
export const SHARP_SCALE: readonly string[] = [
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
];

export const FLAT_SCALE: readonly string[] = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

// Mapping from recognized note spellings to pitch class integer (0-11)
export const NOTE_TO_PITCH_CLASS: Readonly<Record<string, number>> = {
  // Naturals
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
  // Sharps
  'C#': 1,
  'D#': 3,
  'E#': 5,
  'F#': 6,
  'G#': 8,
  'A#': 10,
  'B#': 0,
  // Flats
  CB: 11,
  DB: 1,
  EB: 3,
  FB: 4,
  GB: 6,
  AB: 8,
  BB: 10,
};

// Flat keys for circle-of-fifths enharmonic preference
export const FLAT_KEYS: ReadonlySet<string> = new Set([
  // Major keys
  'F:major',
  'BB:major',
  'EB:major',
  'AB:major',
  'DB:major',
  'GB:major',
  'CB:major',
  // Minor keys
  'D:minor',
  'G:minor',
  'C:minor',
  'F:minor',
  'BB:minor',
  'EB:minor',
  'AB:minor',
]);

// Sharp keys for circle-of-fifths enharmonic preference
export const SHARP_KEYS: ReadonlySet<string> = new Set([
  // Major keys
  'G:major',
  'D:major',
  'A:major',
  'E:major',
  'B:major',
  'F#:major',
  'C#:major',
  // Minor keys
  'E:minor',
  'B:minor',
  'F#:minor',
  'C#:minor',
  'G#:minor',
  'D#:minor',
  'A#:minor',
]);

export const NO_CHORD_VALUES: ReadonlySet<string> = new Set([
  'N',
  'N.C.',
  'NC',
  'NO-CHORD',
  'NONE',
  '',
]);

const CHORD_REGEX = /^([A-Ga-g][#b♯♭]?)(.*)$/;

export interface ParsedChord {
  root: string;
  quality: string;
  bass?: string;
}

/**
 * Parse a chord symbol into { root, quality, bass }.
 * Returns null if chord is empty, invalid, or silence/no-chord.
 */
export function parseChordSymbol(chord: string | null | undefined): ParsedChord | null {
  if (!chord) return null;
  const trimmed = chord.trim();
  if (NO_CHORD_VALUES.has(trimmed.toUpperCase())) {
    return null;
  }

  let mainPart = trimmed;
  let bassPart: string | undefined;

  // Handle slash chords (e.g. "C/G", "Am7/F#")
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    mainPart = parts[0].trim();
    const rawBass = parts.slice(1).join('/').trim();
    if (rawBass) {
      const bMatch = rawBass.match(CHORD_REGEX);
      if (bMatch) {
        const bLetter = bMatch[1][0].toUpperCase();
        let bAcc = bMatch[1].slice(1);
        if (bAcc === '#' || bAcc === '♯') {
          bAcc = '#';
        } else if (bAcc.toLowerCase() === 'b' || bAcc === '♭') {
          bAcc = 'b';
        }
        bassPart = `${bLetter}${bAcc}`;
      }
    }
  }

  const match = mainPart.match(CHORD_REGEX);
  if (!match) return null;

  const rawRoot = match[1];
  const rawQuality = match[2];
  const letter = rawRoot[0].toUpperCase();
  let accidental = rawRoot.slice(1);
  if (accidental === '#' || accidental === '♯') {
    accidental = '#';
  } else if (accidental.toLowerCase() === 'b' || accidental === '♭') {
    accidental = 'b';
  }
  const normalizedRoot = `${letter}${accidental}`;

  if (!(normalizedRoot.toUpperCase() in NOTE_TO_PITCH_CLASS)) {
    return null;
  }

  return {
    root: normalizedRoot,
    quality: rawQuality,
    bass: bassPart,
  };
}

/**
 * Determine whether to use 'flat' or 'sharp' spelling based on key context and chord accidental.
 */
export function classifyKeySpelling(
  key?: string | null,
  originalChord: string = ''
): 'flat' | 'sharp' {
  if (!key || ['UNKNOWN', 'NONE', ''].includes(key.trim().toUpperCase())) {
    return originalChord.toLowerCase().includes('b') ? 'flat' : 'sharp';
  }

  const cleanKey = key.trim();
  const parts = cleanKey.split(/\s+/);
  let rootStr = '';
  let modeStr = '';

  if (parts.length >= 2) {
    rootStr = parts[0];
    modeStr = parts.slice(1).join(' ').toLowerCase();
  } else {
    const match = cleanKey.match(/^([A-Ga-g][#bB]?)(.*)$/);
    if (match) {
      rootStr = match[1];
      modeStr = match[2].toLowerCase();
    } else {
      rootStr = cleanKey;
      modeStr = '';
    }
  }

  let rootUpper = rootStr[0].toUpperCase();
  if (rootStr.length > 1) {
    const acc = rootStr.slice(1).toLowerCase();
    if (acc === '#' || acc === '♯') {
      rootUpper += '#';
    } else if (acc === 'b' || acc === '♭') {
      rootUpper += 'B';
    }
  }
  if (rootUpper === 'BB' && rootStr.length > 1 && rootStr.slice(1).toUpperCase() === 'B') {
    rootUpper = 'BB';
  }

  const mode =
    modeStr.startsWith('min') || modeStr === 'm' || modeStr === 'minor' ? 'minor' : 'major';

  const keyTuple = `${rootUpper}:${mode}`;

  if (FLAT_KEYS.has(keyTuple)) {
    return 'flat';
  }
  if (SHARP_KEYS.has(keyTuple)) {
    return 'sharp';
  }

  // Neutral keys (C Major, A Minor) fallback: check original chord accidental
  return originalChord.toLowerCase().includes('b') ? 'flat' : 'sharp';
}

/**
 * Transpose a root note string by semitones using the chosen spelling scale.
 */
function transposeRoot(
  root: string,
  semitones: number,
  spelling: 'flat' | 'sharp',
  preserveAccidental: boolean = false
): string {
  const rootKey = root.toUpperCase();
  if (!(rootKey in NOTE_TO_PITCH_CLASS)) {
    return root;
  }

  if (preserveAccidental) {
    const letter = root[0].toUpperCase();
    const acc = root.slice(1);
    return `${letter}${acc}`;
  }

  const pitchClass = NOTE_TO_PITCH_CLASS[rootKey];
  const shiftedPc = (((pitchClass + semitones) % 12) + 12) % 12;
  const scale = spelling === 'flat' ? FLAT_SCALE : SHARP_SCALE;
  return scale[shiftedPc];
}

/**
 * Transpose a single chord symbol by semitones with key-aware enharmonic spelling.
 *
 * @param chord Chord symbol (e.g. "C", "Am", "G7", "Cmaj7", "Dm7", "N", "C/G").
 * @param semitones Integer shift in [-12, +12].
 * @param key Optional key context (e.g. "F Major", "Bb", "B Minor", "G").
 * @param targetKey Optional explicit target key override.
 * @returns Transposed chord symbol string.
 */
export function transposeChord(
  chord: string,
  semitones: number,
  key?: string | null,
  targetKey?: string | null
): string {
  if (!Number.isInteger(semitones) || semitones < -12 || semitones > 12) {
    throw new RangeError(`semitones must be in range [-12, 12], got ${semitones}`);
  }

  // 0 is strict identity
  if (semitones === 0) {
    return chord;
  }

  // Silence / no-chord
  if (!chord || NO_CHORD_VALUES.has(chord.trim().toUpperCase())) {
    return 'N';
  }

  const parsed = parseChordSymbol(chord);
  if (!parsed) {
    return chord;
  }

  const { root, quality, bass } = parsed;
  const effKey = targetKey || key;
  const spelling = classifyKeySpelling(effKey, chord);
  const preserveAccidental = semitones === 12 || semitones === -12;

  const newRoot = transposeRoot(root, semitones, spelling, preserveAccidental);

  if (bass) {
    const newBass = transposeRoot(bass, semitones, spelling, preserveAccidental);
    return `${newRoot}${quality}/${newBass}`;
  }

  return `${newRoot}${quality}`;
}

/**
 * Transpose an entire chord progression non-destructively.
 *
 * @param chords List of chord segments.
 * @param semitones Integer shift in [-12, +12].
 * @param key Optional key context.
 * @param targetKey Optional explicit target key override.
 * @returns New array of chord segments with transposed chord values.
 */
export function transposeChordProgression(
  chords: ChordSegment[],
  semitones: number,
  key?: string | null,
  targetKey?: string | null
): ChordSegment[] {
  if (!Number.isInteger(semitones) || semitones < -12 || semitones > 12) {
    throw new RangeError(`semitones must be in range [-12, 12], got ${semitones}`);
  }

  if (!chords || chords.length === 0) {
    return [];
  }

  if (semitones === 0) {
    return chords.map((seg) => ({ ...seg }));
  }

  const effKey = targetKey || key;
  return chords.map((seg) => {
    const chord =
      typeof seg.chord === 'string' ? transposeChord(seg.chord, semitones, effKey) : seg.chord;
    return {
      ...seg,
      chord,
    };
  });
}

/**
 * Project a musical key signature through semitone transposition using circle of fifths.
 */
export function projectKeySignature(key: string | null | undefined, semitones: number): string {
  if (!key || ['UNKNOWN', 'NONE', ''].includes(key.trim().toUpperCase()) || semitones === 0) {
    return key || 'C Major';
  }
  const clean = key.trim();
  const match = clean.match(/^([A-Ga-g][#bB]?)(.*)$/);
  if (!match) return clean;

  const rootStr = match[1];
  const mode = match[2];
  const rootUpper = rootStr.toUpperCase();
  if (!(rootUpper in NOTE_TO_PITCH_CLASS)) {
    return clean;
  }

  const origPc = NOTE_TO_PITCH_CLASS[rootUpper];
  const newPc = (((origPc + semitones) % 12) + 12) % 12;
  const modeLower = mode.trim().toLowerCase();
  const isMinor = modeLower.startsWith('min') || modeLower.endsWith('m') || modeLower === 'm';

  const preferFlat = isMinor
    ? [2, 7, 0, 5, 10, 3].includes(newPc)
    : [5, 10, 3, 8, 1, 6].includes(newPc);

  const newRoot = preferFlat ? FLAT_SCALE[newPc] : SHARP_SCALE[newPc];
  return `${newRoot}${mode}`.trim();
}
