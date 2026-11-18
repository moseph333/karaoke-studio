/**
 * Ctrl/⌘+Z while a dialog is open belongs to the dialog: it must not undo a lyric or chord
 * edit in the studio behind it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLyricHistory } from '../../hooks/useLyricHistory';
import { useChordHistory } from '../../hooks/useChordHistory';
import type { ChordSegment, LyricLine } from '../../types';

const lines: LyricLine[] = [{ id: 1, text: 'one', start_time: 1, end_time: 2, words: [] }];
const chords: ChordSegment[] = [{ chord: 'C', start: 0, end: 2 }];

const pressUndo = () =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    );
  });

function openDialog() {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.appendChild(dialog);
}

afterEach(() => {
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
});

describe('undo shortcuts while a dialog is open', () => {
  it('leaves lyric edits alone, and undoes them once the dialog is closed', () => {
    const onApplySnapshot = vi.fn();
    const { result } = renderHook(() => useLyricHistory({ currentLines: lines, onApplySnapshot }));
    act(() => result.current.pushSnapshot(lines));

    openDialog();
    pressUndo();
    expect(onApplySnapshot).not.toHaveBeenCalled();

    document.querySelector('[role="dialog"]')?.remove();
    pressUndo();
    expect(onApplySnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves chord edits alone, and undoes them once the dialog is closed', () => {
    const onApplySnapshot = vi.fn();
    const { result } = renderHook(() =>
      useChordHistory({
        projectId: 'song1',
        initialChords: chords,
        currentChords: chords,
        onApplySnapshot,
      })
    );
    act(() => result.current.pushSnapshot(chords));

    openDialog();
    pressUndo();
    expect(onApplySnapshot).not.toHaveBeenCalled();

    document.querySelector('[role="dialog"]')?.remove();
    pressUndo();
    expect(onApplySnapshot).toHaveBeenCalledTimes(1);
  });
});
