import React, { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLyricHistory } from '../../hooks/useLyricHistory';
import { useChordHistory } from '../../hooks/useChordHistory';
import { ChordSegment, LyricLine } from '../../types';
import { registerUndoScope, resolveUndoScope } from '../../utils/undoRouter';

const BASE_LINE: LyricLine = { id: 1, text: 'base', start_time: 0, end_time: 1, words: [] };
const BASE_CHORDS: ChordSegment[] = [{ start: 0, end: 2, chord: 'C' }];

interface HarnessApi {
  editLyric: (text: string) => void;
  editChord: (chord: string) => void;
}

let api: HarnessApi;

const Harness: React.FC<{ chordsEnabled?: boolean }> = ({ chordsEnabled = true }) => {
  const [lines, setLines] = useState<LyricLine[]>([BASE_LINE]);
  const [chords, setChords] = useState<ChordSegment[]>(BASE_CHORDS);
  const lyric = useLyricHistory({ currentLines: lines, onApplySnapshot: setLines });
  const chord = useChordHistory({
    projectId: 'p1',
    initialChords: BASE_CHORDS,
    currentChords: chords,
    enabled: chordsEnabled,
    onApplySnapshot: setChords,
  });
  api = {
    editLyric: (text) => {
      lyric.pushSnapshot(lines);
      setLines([{ ...lines[0], text }]);
    },
    editChord: (name) => {
      chord.pushSnapshot(chords);
      setChords([{ ...chords[0], chord: name }]);
    },
  };
  return (
    <div>
      <span data-testid="lyric">{lines[0].text}</span>
      <span data-testid="chord">{chords[0].chord}</span>
    </div>
  );
};

const undo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
const redo = () => fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
const lyricText = () => screen.getByTestId('lyric').textContent;
const chordText = () => screen.getByTestId('chord').textContent;

describe('keyboard undo routing between lyric and chord histories', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('undoes only the most recently edited history per key press', () => {
    render(<Harness />);
    act(() => api.editLyric('lyric edit'));
    act(() => api.editChord('Am'));

    act(() => undo());
    expect(chordText()).toBe('C');
    expect(lyricText()).toBe('lyric edit');

    act(() => undo());
    expect(lyricText()).toBe('base');
    expect(chordText()).toBe('C');
  });

  it('redoes the most recently undone history first', () => {
    render(<Harness />);
    act(() => api.editLyric('lyric edit'));
    act(() => api.editChord('Am'));
    act(() => undo());
    act(() => undo());

    act(() => redo());
    expect(lyricText()).toBe('lyric edit');
    expect(chordText()).toBe('C');

    act(() => redo());
    expect(chordText()).toBe('Am');
  });

  it('falls back to the other history once the last-edited one is exhausted', () => {
    render(<Harness />);
    act(() => api.editChord('G'));
    act(() => api.editLyric('lyric edit'));

    act(() => undo());
    expect(lyricText()).toBe('base');
    expect(chordText()).toBe('G');

    act(() => undo());
    expect(chordText()).toBe('C');
  });

  it('keeps routing lyric undos when chord editing is disabled', () => {
    render(<Harness chordsEnabled={false} />);
    act(() => api.editLyric('one'));
    act(() => api.editLyric('two'));
    act(() => undo());
    expect(lyricText()).toBe('one');
    act(() => undo());
    expect(lyricText()).toBe('base');
  });

  it('unregisters a history when it unmounts', () => {
    const { unmount } = render(<Harness />);
    act(() => api.editChord('Am'));
    expect(resolveUndoScope('undo')).toBe('chords');
    unmount();
    expect(resolveUndoScope('undo')).toBeNull();
  });

  it('ignores a stale unregister after the scope was registered again', () => {
    const unregisterOld = registerUndoScope('lyrics', {
      canUndo: () => true,
      canRedo: () => false,
    });
    const unregisterNew = registerUndoScope('lyrics', {
      canUndo: () => true,
      canRedo: () => false,
    });
    unregisterOld();
    expect(resolveUndoScope('undo')).toBe('lyrics');
    unregisterNew();
    expect(resolveUndoScope('undo')).toBeNull();
  });
});
