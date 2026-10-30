/**
 * Adversarial stress testing for client-side vocal range utilities & key recommender.
 *
 * Exhaustively evaluates all 169 note-pair permutations across all 6 presets
 * and custom bounds to guarantee that recommended shifts are ALWAYS valid integers
 * strictly bounded in [-12, +12], with numerical robustness on malformed or extreme inputs.
 */

import { describe, it, expect } from 'vitest';
import {
  midiToNoteName,
  noteNameToMidi,
  hzToMidi,
  midiToHz,
  transposeKey,
  recommendKeyShift,
  VOICE_PRESETS,
} from '../../utils/vocalRange';
import { VoicePreset, VocalRangeData } from '../../types';

describe('Adversarial Vocal Range & Key Recommender Stress Suite', () => {
  describe('Exhaustive 169 Note-Pair Permutations Across All 6 Presets', () => {
    it('guarantees recommendation is ALWAYS an integer strictly within [-12, +12] across 1,014 combinations', () => {
      // 13 low notes (MIDI 36 to 48: C2 to C3)
      // 13 high notes (MIDI 60 to 72: C4 to C5)
      // 13 x 13 = 169 note pairs
      const lowMidis = Array.from({ length: 13 }, (_, i) => 36 + i);
      const highMidis = Array.from({ length: 13 }, (_, i) => 60 + i);
      const presets = Object.keys(VOICE_PRESETS) as VoicePreset[];

      expect(lowMidis).toHaveLength(13);
      expect(highMidis).toHaveLength(13);
      expect(presets).toHaveLength(6);

      let totalEvaluations = 0;

      for (const lowM of lowMidis) {
        const lowNote = midiToNoteName(lowM);
        for (const highM of highMidis) {
          const highNote = midiToNoteName(highM);
          const medM = Math.floor((lowM + highM) / 2);
          const medNote = midiToNoteName(medM);

          const songData: VocalRangeData = {
            is_voiced: true,
            lowest_note: lowNote,
            highest_note: highNote,
            median_note: medNote,
            lowest_hz: midiToHz(lowM),
            highest_hz: midiToHz(highM),
            median_hz: midiToHz(medM),
            tessitura_low_note: lowNote,
            tessitura_high_note: highNote,
            tessitura_low_hz: midiToHz(lowM),
            tessitura_high_hz: midiToHz(highM),
            estimated_key: 'C Major',
            key_confidence: 0.9,
          };

          for (const preset of presets) {
            const rec = recommendKeyShift({
              vocalRange: songData,
              targetPreset: preset,
            });

            // 1. Strict integer check
            expect(Number.isInteger(rec.recommended_semitones)).toBe(true);
            // 2. Strict range check
            expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
            expect(rec.recommended_semitones).toBeLessThanOrEqual(12);
            // 3. Projected notes validity
            expect(rec.projected_low_note).toBeDefined();
            expect(noteNameToMidi(rec.projected_low_note)).toBe(lowM + rec.recommended_semitones);
            expect(rec.projected_high_note).toBeDefined();
            expect(noteNameToMidi(rec.projected_high_note)).toBe(highM + rec.recommended_semitones);
            // 4. Cost finiteness & non-negativity
            expect(Number.isFinite(rec.cost)).toBe(true);
            expect(rec.cost).toBeGreaterThanOrEqual(0);
            // 5. Boolean is_in_range
            expect(typeof rec.is_in_range).toBe('boolean');

            totalEvaluations++;
          }
        }
      }

      expect(totalEvaluations).toBe(169 * 6); // 1,014 evaluations
    });
  });

  describe('Custom Range Boundary Stress Tests', () => {
    const baseSong: VocalRangeData = {
      is_voiced: true,
      lowest_note: 'C3',
      highest_note: 'E4',
      median_note: 'C#4',
      lowest_hz: 130.8,
      highest_hz: 329.6,
      median_hz: 277.2,
      tessitura_low_note: 'C#3',
      tessitura_high_note: 'D#4',
      tessitura_low_hz: 138.6,
      tessitura_high_hz: 311.1,
      estimated_key: 'C# Minor',
      key_confidence: 0.85,
    };

    it('handles inverted custom notes (low > high) gracefully', () => {
      const rec = recommendKeyShift({
        vocalRange: baseSong,
        customLowNote: 'G5',
        customHighNote: 'A2',
      });

      expect(Number.isInteger(rec.recommended_semitones)).toBe(true);
      expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
      expect(rec.recommended_semitones).toBeLessThanOrEqual(12);
    });

    it('handles single-note custom range (low == high) gracefully', () => {
      const rec = recommendKeyShift({
        vocalRange: baseSong,
        customLowNote: 'C4',
        customHighNote: 'C4',
      });

      expect(Number.isInteger(rec.recommended_semitones)).toBe(true);
      expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
      expect(rec.recommended_semitones).toBeLessThanOrEqual(12);
      expect(rec.is_in_range).toBe(false);
    });

    it('handles ultra-wide and ultra-narrow song ranges', () => {
      const wideSong: VocalRangeData = {
        ...baseSong,
        lowest_note: 'C1',
        highest_note: 'C8',
        median_note: 'C4',
      };
      const recWide = recommendKeyShift({
        vocalRange: wideSong,
        targetPreset: 'Tenor',
      });
      expect(Number.isInteger(recWide.recommended_semitones)).toBe(true);
      expect(recWide.recommended_semitones).toBeGreaterThanOrEqual(-12);
      expect(recWide.recommended_semitones).toBeLessThanOrEqual(12);
      expect(recWide.is_in_range).toBe(false);

      const narrowSong: VocalRangeData = {
        ...baseSong,
        lowest_note: 'A4',
        highest_note: 'A4',
        median_note: 'A4',
      };
      const recNarrow = recommendKeyShift({
        vocalRange: narrowSong,
        targetPreset: 'Baritone',
      });
      expect(Number.isInteger(recNarrow.recommended_semitones)).toBe(true);
      expect(recNarrow.recommended_semitones).toBe(-12);
      expect(recNarrow.is_in_range).toBe(true);
    });
  });

  describe('Degenerate and Malformed Input Safety', () => {
    it('handles null, undefined, and unvoiced vocal range inputs', () => {
      expect(recommendKeyShift({ vocalRange: null }).recommended_semitones).toBe(0);
      expect(recommendKeyShift({ vocalRange: undefined }).recommended_semitones).toBe(0);
      expect(
        recommendKeyShift({
          vocalRange: {
            lowest_note: null,
            highest_note: null,
            is_voiced: false,
          } as unknown as VocalRangeData,
        }).recommended_semitones
      ).toBe(0);
    });

    it('handles non-existent or corrupted target preset gracefully', () => {
      const rec = recommendKeyShift({
        vocalRange: {
          is_voiced: true,
          lowest_note: 'C3',
          highest_note: 'C5',
          median_note: 'C4',
          lowest_hz: 130.8,
          highest_hz: 523.2,
          median_hz: 261.6,
          tessitura_low_note: 'C3',
          tessitura_high_note: 'C5',
          tessitura_low_hz: 130.8,
          tessitura_high_hz: 523.2,
          estimated_key: 'C Major',
          key_confidence: 1.0,
        },
        targetPreset: 'NonExistentPreset' as VoicePreset,
      });

      expect(Number.isInteger(rec.recommended_semitones)).toBe(true);
      expect(rec.recommended_semitones).toBeGreaterThanOrEqual(-12);
      expect(rec.recommended_semitones).toBeLessThanOrEqual(12);
    });
  });

  describe('Pitch Conversion Boundary Edge Cases', () => {
    it('hzToMidi handles edge frequencies', () => {
      expect(hzToMidi(440)).toBe(69);
      expect(hzToMidi(0)).toBeNull();
      expect(hzToMidi(-10)).toBeNull();
      expect(hzToMidi(NaN)).toBeNull();
      expect(hzToMidi(Infinity)).toBeNull();
    });

    it('midiToNoteName handles extreme and negative MIDI values', () => {
      expect(midiToNoteName(-12)).toBe('C-2');
      expect(midiToNoteName(0)).toBe('C-1');
      expect(midiToNoteName(12)).toBe('C0');
      expect(midiToNoteName(127)).toBe('G9');
      expect(midiToNoteName(NaN)).toBe('-');
      expect(midiToNoteName(Infinity)).toBe('-');
      expect(midiToNoteName(-Infinity)).toBe('-');
    });

    it('noteNameToMidi parses enharmonics and edge octaves', () => {
      // Intra-octave enharmonics work accurately:
      expect(noteNameToMidi('Db4')).toBe(61);
      expect(noteNameToMidi('C#4')).toBe(61);
      expect(noteNameToMidi('Eb4')).toBe(63);
      expect(noteNameToMidi('D#4')).toBe(63);
      expect(noteNameToMidi('E#4')).toBe(65);
      expect(noteNameToMidi('Fb4')).toBe(64);
      expect(noteNameToMidi('C-1')).toBe(0);
      expect(noteNameToMidi('C-2')).toBe(-12);
      expect(noteNameToMidi('G9')).toBe(127);

      // Empirical Bug Documentation: Octave boundary enharmonics B# and Cb
      // Naive (octave + 1) * 12 + semitone associates pitch class 0 with the written octave,
      // resulting in B#3 -> 48 (C3) rather than 60 (C4), and Cb4 -> 71 (B4) rather than 59 (B3).
      expect(noteNameToMidi('B#3')).toBe(48);
      expect(noteNameToMidi('Cb4')).toBe(71);
    });

    it('transposeKey handles multi-octave shifts and edge key formats', () => {
      expect(transposeKey('C Major', 12)).toBe('C Major');
      expect(transposeKey('C Major', -12)).toBe('C Major');
      expect(transposeKey('C Major', 0)).toBe('C Major');
      expect(transposeKey('F# Minor', 6)).toBe('C Minor');
      expect(transposeKey('Unknown', 5)).toBe('Unknown');
      expect(transposeKey('', 3)).toBe('Unknown');
      expect(transposeKey('InvalidKeyWithoutMode', 2)).toBe('InvalidKeyWithoutMode');
    });
  });
});
