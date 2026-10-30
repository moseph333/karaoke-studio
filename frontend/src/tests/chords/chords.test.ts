import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import {
  parseChordSymbol,
  classifyKeySpelling,
  transposeChord,
  transposeChordProgression,
  projectKeySignature,
} from '../../utils/chords';
import { ChordSegment } from '../../types';
import { ChordBar } from '../../components/ChordBar';
import { useChordHistory } from '../../hooks/useChordHistory';

describe('chords.ts: Harmonic Chord Parser & Transposition Engine', () => {
  describe('parseChordSymbol', () => {
    it('parses major and minor chords', () => {
      expect(parseChordSymbol('C')).toEqual({ root: 'C', quality: '', bass: undefined });
      expect(parseChordSymbol('Am')).toEqual({ root: 'A', quality: 'm', bass: undefined });
      expect(parseChordSymbol('F#m')).toEqual({ root: 'F#', quality: 'm', bass: undefined });
      expect(parseChordSymbol('Bb')).toEqual({ root: 'Bb', quality: '', bass: undefined });
    });

    it('parses 7, maj7, m7 chords', () => {
      expect(parseChordSymbol('G7')).toEqual({ root: 'G', quality: '7', bass: undefined });
      expect(parseChordSymbol('Cmaj7')).toEqual({ root: 'C', quality: 'maj7', bass: undefined });
      expect(parseChordSymbol('Dm7')).toEqual({ root: 'D', quality: 'm7', bass: undefined });
    });

    it('parses slash chords and normalizes unicode accidentals', () => {
      expect(parseChordSymbol('C/G')).toEqual({ root: 'C', quality: '', bass: 'G' });
      expect(parseChordSymbol('Am7/F#')).toEqual({ root: 'A', quality: 'm7', bass: 'F#' });
      expect(parseChordSymbol('D/F♯')).toEqual({ root: 'D', quality: '', bass: 'F#' });
      expect(parseChordSymbol('Eb/B♭')).toEqual({ root: 'Eb', quality: '', bass: 'Bb' });
    });

    it('returns null for empty, silence, or no-chord values', () => {
      expect(parseChordSymbol('')).toBeNull();
      expect(parseChordSymbol('N')).toBeNull();
      expect(parseChordSymbol('N.C.')).toBeNull();
      expect(parseChordSymbol('NC')).toBeNull();
      expect(parseChordSymbol('NO-CHORD')).toBeNull();
      expect(parseChordSymbol('NONE')).toBeNull();
      expect(parseChordSymbol('InvalidChord')).toBeNull();
    });
  });

  describe('classifyKeySpelling', () => {
    it('correctly classifies flat keys', () => {
      expect(classifyKeySpelling('F Major')).toBe('flat');
      expect(classifyKeySpelling('Bb Major')).toBe('flat');
      expect(classifyKeySpelling('Eb')).toBe('flat');
      expect(classifyKeySpelling('D Minor')).toBe('flat');
      expect(classifyKeySpelling('G Minor')).toBe('flat');
      expect(classifyKeySpelling('C Minor')).toBe('flat');
    });

    it('correctly classifies sharp keys', () => {
      expect(classifyKeySpelling('G Major')).toBe('sharp');
      expect(classifyKeySpelling('D Major')).toBe('sharp');
      expect(classifyKeySpelling('A Major')).toBe('sharp');
      expect(classifyKeySpelling('E')).toBe('sharp');
      expect(classifyKeySpelling('B Major')).toBe('sharp');
      expect(classifyKeySpelling('E Minor')).toBe('sharp');
      expect(classifyKeySpelling('B Minor')).toBe('sharp');
    });

    it('handles modal keys correctly (Mixolydian / Dorian)', () => {
      // G Mixolydian evaluates mode as major -> G Major in SHARP_KEYS -> 'sharp'
      expect(classifyKeySpelling('G Mixolydian')).toBe('sharp');
      // F Mixolydian evaluates mode as major -> F Major in FLAT_KEYS -> 'flat'
      expect(classifyKeySpelling('F Mixolydian')).toBe('flat');
      // Bb Mixolydian evaluates mode as major -> Bb Major in FLAT_KEYS -> 'flat'
      expect(classifyKeySpelling('Bb Mixolydian')).toBe('flat');
      // D Mixolydian evaluates mode as major -> D Major in SHARP_KEYS -> 'sharp'
      expect(classifyKeySpelling('D Mixolydian')).toBe('sharp');
      // D Dorian evaluates mode as major -> D Major in SHARP_KEYS -> 'sharp'
      expect(classifyKeySpelling('D Dorian')).toBe('sharp');
    });

    it('handles neutral or unknown keys with chord accidental fallback', () => {
      expect(classifyKeySpelling('C Major', 'Bb')).toBe('flat');
      expect(classifyKeySpelling('C Major', 'G')).toBe('sharp');
      expect(classifyKeySpelling(null, 'Eb')).toBe('flat');
      expect(classifyKeySpelling('Unknown', 'F#')).toBe('sharp');
    });
  });

  describe('transposeChord', () => {
    it('preserves strict identity at 0 semitones', () => {
      expect(transposeChord('C', 0)).toBe('C');
      expect(transposeChord('Am7', 0)).toBe('Am7');
      expect(transposeChord('G7/B', 0)).toBe('G7/B');
      expect(transposeChord('N', 0)).toBe('N');
    });

    it('preserves spelling accidental at +/- 12 semitones', () => {
      expect(transposeChord('C#', 12)).toBe('C#');
      expect(transposeChord('Db', 12)).toBe('Db');
      expect(transposeChord('F#m', -12)).toBe('F#m');
      expect(transposeChord('Ebmaj7', -12)).toBe('Ebmaj7');
    });

    it('transposes accurately with key-aware enharmonic spelling', () => {
      // C in F Major (flat key) + 2 semitones = D
      expect(transposeChord('C', 2, 'F Major')).toBe('D');
      // C in F Major (flat key) - 2 semitones = Bb
      expect(transposeChord('C', -2, 'F Major')).toBe('Bb');
      // C in G Major (sharp key) - 2 semitones = A# / Bb (sharp key prefers A#)
      expect(transposeChord('C', -2, 'G Major')).toBe('A#');
      // C in G Major + 6 semitones (tritone) = F#
      expect(transposeChord('C', 6, 'G Major')).toBe('F#');
      // C in F Major + 6 semitones = Gb
      expect(transposeChord('C', 6, 'F Major')).toBe('Gb');
    });

    it('transposes slash chords accurately', () => {
      expect(transposeChord('C/G', 2)).toBe('D/A');
      expect(transposeChord('Am7/F#', -2, 'G Major')).toBe('Gm7/E');
    });

    it('returns N for silence/no-chord inputs', () => {
      expect(transposeChord('N', 2)).toBe('N');
      expect(transposeChord('', 2)).toBe('N');
      expect(transposeChord('N.C.', 2)).toBe('N');
    });

    it('throws RangeError for semitones outside [-12, 12]', () => {
      expect(() => transposeChord('C', 13)).toThrow(RangeError);
      expect(() => transposeChord('C', -13)).toThrow(RangeError);
      expect(() => transposeChord('C', 1.5 as unknown as number)).toThrow(RangeError);
    });
  });

  describe('transposeChordProgression', () => {
    const mockProg: ChordSegment[] = [
      { id: '1', start: 0, end: 2, chord: 'C' },
      { id: '2', start: 2, end: 4, chord: 'Am' },
      { id: '3', start: 4, end: 6, chord: 'F' },
      { id: '4', start: 6, end: 8, chord: 'G7' },
    ];

    it('transposes entire progression non-destructively', () => {
      const transposed = transposeChordProgression(mockProg, 2);
      expect(transposed).toHaveLength(4);
      expect(transposed[0].chord).toBe('D');
      expect(transposed[1].chord).toBe('Bm');
      expect(transposed[2].chord).toBe('G');
      expect(transposed[3].chord).toBe('A7');

      // Original progression remains untouched
      expect(mockProg[0].chord).toBe('C');
    });

    it('handles empty progression', () => {
      expect(transposeChordProgression([], 2)).toEqual([]);
    });

    it('throws RangeError for invalid semitones', () => {
      expect(() => transposeChordProgression(mockProg, 15)).toThrow(RangeError);
    });
  });

  describe('projectKeySignature', () => {
    it('projects major and minor keys through transposition', () => {
      expect(projectKeySignature('C Major', 2)).toBe('D Major');
      expect(projectKeySignature('A Minor', 2)).toBe('B Minor');
      expect(projectKeySignature('C Major', 0)).toBe('C Major');
      expect(projectKeySignature('Unknown', 2)).toBe('Unknown');
    });
  });

  describe('ChordBar Component', () => {
    const testChords: ChordSegment[] = [
      { id: '1', start: 0.0, end: 2.0, chord: 'C' },
      { id: '2', start: 2.0, end: 4.0, chord: 'Am' },
      { id: '3', start: 4.0, end: 6.0, chord: 'F' },
      { id: '4', start: 6.0, end: 8.0, chord: 'G7' },
    ];

    it('renders chord bar and active badge with transposition', () => {
      render(React.createElement(ChordBar, { chords: testChords, currentTime: 1.0, semitones: 2 }));
      const bar = screen.getByTestId('chord-bar');
      expect(bar).toBeInTheDocument();
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('D');
    });

    it('renders placeholder when no chord is active', () => {
      render(React.createElement(ChordBar, { chords: testChords, currentTime: -1 }));
      expect(screen.getByTestId('active-chord-badge')).toHaveTextContent('—');
    });

    it('supports onSeek when clicking upcoming cue', () => {
      const onSeek = vi.fn();
      render(React.createElement(ChordBar, { chords: testChords, currentTime: 1.0, onSeek }));
      const upcoming = screen.getAllByTestId('upcoming-chord-cue');
      expect(upcoming.length).toBeGreaterThan(0);
      fireEvent.click(upcoming[0]);
      expect(onSeek).toHaveBeenCalledWith(2.0);
    });

    it('supports inline editing when onEditChord is provided', () => {
      const onEdit = vi.fn();
      render(
        React.createElement(ChordBar, { chords: testChords, currentTime: 1.0, onEditChord: onEdit })
      );
      const editBtn = screen.getByTestId('edit-active-chord-btn');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('chord-edit-input');
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'Cmaj7' } });

      const saveBtn = screen.getByTestId('save-chord-edit-btn');
      fireEvent.click(saveBtn);
      expect(onEdit).toHaveBeenCalledWith(0, 'Cmaj7');
    });

    it('hides component when visible is false', () => {
      render(
        React.createElement(ChordBar, {
          chords: testChords,
          currentTime: 1.0,
          visible: false,
        })
      );
      expect(screen.queryByTestId('chord-bar')).not.toBeInTheDocument();
    });
  });

  describe('useChordHistory Hook', () => {
    const baseChords: ChordSegment[] = [
      { id: '1', start: 0, end: 2, chord: 'C' },
      { id: '2', start: 2, end: 4, chord: 'Am' },
    ];

    it('manages 50-step bounded undo and redo stacks', () => {
      const { result } = renderHook(() =>
        useChordHistory({
          initialChords: baseChords,
          currentChords: baseChords,
          maxHistory: 3,
        })
      );

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);

      // Push 4 snapshots to verify bounding to maxHistory=3
      act(() => {
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C1' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C2' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C3' }]);
        result.current.pushSnapshot([{ id: '1', start: 0, end: 2, chord: 'C4' }]);
      });

      expect(result.current.undoStack).toHaveLength(3);
      expect(result.current.canUndo).toBe(true);

      // Undo
      act(() => {
        const prev = result.current.undo([{ id: '1', start: 0, end: 2, chord: 'C4' }]);
        expect(prev?.[0].chord).toBe('C4');
      });
      expect(result.current.canRedo).toBe(true);

      // Redo
      act(() => {
        const next = result.current.redo([{ id: '1', start: 0, end: 2, chord: 'C3' }]);
        expect(next?.[0].chord).toBe('C4');
      });
    });

    it('tracks isDirty correctly', () => {
      const modified: ChordSegment[] = [
        { id: '1', start: 0, end: 2, chord: 'Cmaj7' },
        { id: '2', start: 2, end: 4, chord: 'Am' },
      ];

      const { result, rerender } = renderHook(
        ({ current }) =>
          useChordHistory({
            initialChords: baseChords,
            currentChords: current,
          }),
        { initialProps: { current: baseChords } }
      );

      expect(result.current.isDirty).toBe(false);

      rerender({ current: modified });
      expect(result.current.isDirty).toBe(true);
    });

    it('validates intervals and rejects invalid or overlapping intervals on save', async () => {
      const invalidInterval: ChordSegment[] = [
        { id: '1', start: 2.0, end: 1.0, chord: 'C' }, // start > end!
      ];

      const overlappingIntervals: ChordSegment[] = [
        { id: '1', start: 0.0, end: 3.0, chord: 'C' },
        { id: '2', start: 2.0, end: 4.0, chord: 'G' }, // overlaps!
      ];

      const { result } = renderHook(() =>
        useChordHistory({
          projectId: 'p1',
          initialChords: baseChords,
        })
      );

      await expect(result.current.saveChords(invalidInterval)).rejects.toThrow(
        /start must be strictly less than end/
      );

      await expect(result.current.saveChords(overlappingIntervals)).rejects.toThrow(
        /Overlapping chords/
      );
    });
  });
});
