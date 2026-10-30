import { describe, it, expect } from 'vitest';
import {
  midiToNoteName,
  noteNameToMidi,
  hzToMidi,
  midiToHz,
  transposeKey,
  recommendKeyShift,
  VOICE_PRESETS,
  COMMON_NOTE_OPTIONS,
} from '../../utils/vocalRange';
import { VocalRangeData } from '../../types';

describe('Vocal Range & Pitch Utility Functions', () => {
  describe('midiToNoteName', () => {
    it('converts standard MIDI numbers to SPN note names', () => {
      expect(midiToNoteName(60)).toBe('C4');
      expect(midiToNoteName(69)).toBe('A4');
      expect(midiToNoteName(40)).toBe('E2');
      expect(midiToNoteName(84)).toBe('C6');
      expect(midiToNoteName(61)).toBe('C#4');
      expect(midiToNoteName(70)).toBe('A#4');
    });

    it('rounds fractional MIDI pitches accurately', () => {
      expect(midiToNoteName(60.1)).toBe('C4');
      expect(midiToNoteName(60.6)).toBe('C#4');
    });

    it('returns "-" for invalid or non-numeric inputs', () => {
      expect(midiToNoteName(NaN)).toBe('-');
      expect(midiToNoteName(Infinity)).toBe('-');
    });
  });

  describe('noteNameToMidi', () => {
    it('parses standard notes and accidentals', () => {
      expect(noteNameToMidi('C4')).toBe(60);
      expect(noteNameToMidi('A4')).toBe(69);
      expect(noteNameToMidi('E2')).toBe(40);
      expect(noteNameToMidi('C#3')).toBe(49);
      expect(noteNameToMidi('Db3')).toBe(49);
      expect(noteNameToMidi('Eb4')).toBe(63);
    });

    it('handles whitespace and lowercase inputs', () => {
      expect(noteNameToMidi('  c4  ')).toBe(60);
      expect(noteNameToMidi('c#3')).toBe(49);
    });

    it('returns null for unparseable note names', () => {
      expect(noteNameToMidi('H4')).toBeNull();
      expect(noteNameToMidi('C')).toBeNull();
      expect(noteNameToMidi('')).toBeNull();
      expect(noteNameToMidi('invalid')).toBeNull();
    });
  });

  describe('hzToMidi & midiToHz', () => {
    it('accurately converts concert A 440Hz', () => {
      expect(hzToMidi(440)).toBe(69);
      expect(midiToHz(69)).toBe(440);
    });

    it('converts octave intervals accurately', () => {
      expect(hzToMidi(220)).toBe(57);
      expect(hzToMidi(880)).toBe(81);
    });

    it('handles invalid frequencies without exceptions', () => {
      expect(hzToMidi(0)).toBeNull();
      expect(hzToMidi(-100)).toBeNull();
      expect(hzToMidi(NaN)).toBeNull();
    });
  });

  describe('VOICE_PRESETS', () => {
    it('defines valid non-empty bounds for all standard presets', () => {
      const presets = Object.values(VOICE_PRESETS);
      expect(presets).toHaveLength(6);

      presets.forEach((p) => {
        expect(p.lowMidi).toBeLessThan(p.highMidi);
        expect(midiToNoteName(p.lowMidi)).toBe(p.lowNote);
        expect(midiToNoteName(p.highMidi)).toBe(p.highNote);
      });
    });

    it('strictly conforms to specification boundaries', () => {
      expect(VOICE_PRESETS.Bass.lowNote).toBe('E2');
      expect(VOICE_PRESETS.Bass.highNote).toBe('E4');
      expect(VOICE_PRESETS.Baritone.lowNote).toBe('A2');
      expect(VOICE_PRESETS.Baritone.highNote).toBe('A4');
      expect(VOICE_PRESETS.Tenor.lowNote).toBe('C3');
      expect(VOICE_PRESETS.Tenor.highNote).toBe('C5');
      expect(VOICE_PRESETS.Alto.lowNote).toBe('F3');
      expect(VOICE_PRESETS.Alto.highNote).toBe('F5');
      expect(VOICE_PRESETS['Mezzo-Soprano'].lowNote).toBe('A3');
      expect(VOICE_PRESETS['Mezzo-Soprano'].highNote).toBe('A5');
      expect(VOICE_PRESETS.Soprano.lowNote).toBe('C4');
      expect(VOICE_PRESETS.Soprano.highNote).toBe('C6');
    });
  });

  describe('transposeKey', () => {
    it('transposes keys by integer semitones', () => {
      expect(transposeKey('C# Minor', -2)).toBe('B Minor');
      expect(transposeKey('C# Minor', 2)).toBe('D# Minor');
      expect(transposeKey('G Major', 2)).toBe('A Major');
      expect(transposeKey('C Major', -1)).toBe('B Major');
    });

    it('returns original or Unknown for unparseable keys', () => {
      expect(transposeKey('Unknown', 4)).toBe('Unknown');
    });
  });

  describe('COMMON_NOTE_OPTIONS', () => {
    it('generates note options from C2 to C6', () => {
      expect(COMMON_NOTE_OPTIONS.length).toBe(49);
      expect(COMMON_NOTE_OPTIONS[0].note).toBe('C2');
      expect(COMMON_NOTE_OPTIONS[COMMON_NOTE_OPTIONS.length - 1].note).toBe('C6');
    });
  });

  describe('recommendKeyShift', () => {
    const mockVocalRange: VocalRangeData = {
      lowest_note: 'C#3',
      highest_note: 'E4',
      lowest_hz: 140.6,
      highest_hz: 332.7,
      tessitura_low_note: 'B3',
      tessitura_high_note: 'D#4',
      tessitura_low_hz: 246.9,
      tessitura_high_hz: 311.1,
      median_note: 'C#4',
      median_hz: 279.9,
      estimated_key: 'C# Minor',
      key_confidence: 0.88,
      is_voiced: true,
    };

    it('returns a shift bounded strictly in [-12, +12]', () => {
      const rec = recommendKeyShift({
        vocalRange: mockVocalRange,
        targetPreset: 'Baritone',
      });

      expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
      expect(rec.recommended_semitones).toBeLessThanOrEqual(12);
      expect(rec.projected_key).toBeDefined();
    });

    it('recommends negative shift when song vocal range is too high for Bass', () => {
      const highSong: VocalRangeData = {
        ...mockVocalRange,
        lowest_note: 'G3',
        highest_note: 'G5',
        median_note: 'G4',
      };

      const rec = recommendKeyShift({
        vocalRange: highSong,
        targetPreset: 'Bass',
      });

      // Song peaks at G5 (79), Bass max is E4 (64). Must shift down significantly.
      expect(rec.recommended_semitones).toBeLessThan(0);
      expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
    });

    it('recommends positive shift when song vocal range is too low for Soprano', () => {
      const lowSong: VocalRangeData = {
        ...mockVocalRange,
        lowest_note: 'E2',
        highest_note: 'C4',
        median_note: 'A2',
      };

      const rec = recommendKeyShift({
        vocalRange: lowSong,
        targetPreset: 'Soprano',
      });

      // Song is in Bass range, Soprano needs it transposed up.
      expect(rec.recommended_semitones).toBeGreaterThan(0);
    });

    it('gracefully handles unvoiced or missing vocal range', () => {
      const rec = recommendKeyShift({
        vocalRange: { ...mockVocalRange, is_voiced: false },
        targetPreset: 'Tenor',
      });

      expect(rec.recommended_semitones).toBe(0);
      expect(rec.is_in_range).toBe(true);
    });

    it('supports custom note range bounds', () => {
      const rec = recommendKeyShift({
        vocalRange: mockVocalRange,
        customLowNote: 'C3',
        customHighNote: 'C5',
      });

      expect(rec.recommended_semitones).toBeDefined();
    });
  });
});
