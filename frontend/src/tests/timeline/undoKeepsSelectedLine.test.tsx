/**
 * Undo and redo leave the selected (expanded) line alone unless the step being restored
 * was a tap-to-sync one, where the selection follows the tap cursor back.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLyricEditorState } from '../../hooks/useLyricEditorState';
import type { LyricLine } from '../../types';

const line = (id: number, text: string, start: number): LyricLine => ({
  id,
  text,
  start_time: start,
  end_time: start + 2,
  words: [{ word: text, start_time: start, end_time: start + 2 }],
});

const lines = [line(1, 'one', 1), line(2, 'two', 5), line(3, 'three', 9)];

const renderEditor = () =>
  renderHook(() =>
    useLyricEditorState({ lines, getCurrentTime: () => 6, duration: 30, onSaveLines: vi.fn() })
  );

describe('undo and the selected line', () => {
  it('keeps the line being edited selected through undo and redo', () => {
    const { result } = renderEditor();
    act(() => result.current.setSelectedLineId(3));
    act(() => result.current.nudgeLine(3, 0.2));

    act(() => result.current.handleUndo());
    expect(result.current.editableLines[2].start_time).toBe(9);
    expect(result.current.selectedLineId).toBe(3);

    act(() => result.current.handleRedo());
    expect(result.current.editableLines[2].start_time).toBe(9.2);
    expect(result.current.selectedLineId).toBe(3);
  });

  it('moves the selection back with the tap cursor when a tap is undone', () => {
    const { result } = renderEditor();
    act(() => result.current.setIsTapToSyncActive(true));
    act(() => result.current.setTapTargetIndex(1));
    act(() => result.current.handleTriggerTap());
    expect(result.current.tapTargetIndex).toBe(2);

    act(() => result.current.handleUndo());

    expect(result.current.tapTargetIndex).toBe(1);
    expect(result.current.selectedLineId).toBe(2);
  });
});
