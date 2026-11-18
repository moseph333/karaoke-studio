/**
 * Spelling a transposed chord with no key to go by: flats only when the chord it came from
 * has a flat on its root or bass note. The note B is not a flat (mirrors the backend's
 * test_chord_spelling_of_b_chords.py).
 */
import { describe, it, expect } from 'vitest';
import { classifyKeySpelling, transposeChord } from '../../utils/chords';

describe('spelling of transposed B chords', () => {
  it.each(['B', 'Bm', 'Bm7', 'C/B', 'b'])('spells %s with sharps', (chord) => {
    expect(classifyKeySpelling(null, chord)).toBe('sharp');
    expect(classifyKeySpelling('C Major', chord)).toBe('sharp');
  });

  it.each(['Bb', 'Ebm7', 'C/Bb', 'Abmaj7'])('spells %s with flats', (chord) => {
    expect(classifyKeySpelling(null, chord)).toBe('flat');
    expect(classifyKeySpelling('A Minor', chord)).toBe('flat');
  });

  it('moves B up a tone to C#, and Bb up a tone to C', () => {
    expect(transposeChord('B', 2)).toBe('C#');
    expect(transposeChord('Bm', 2)).toBe('C#m');
    expect(transposeChord('Bb', 3)).toBe('Db');
  });
});
