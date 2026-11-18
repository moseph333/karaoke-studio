/**
 * Lines that arrive from the server while the editor has unsaved edits (a background
 * re-timing finishing, another device saving): the edits stay, and the server's lines
 * become what Discard returns to.
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

const saved = [line(1, 'one', 1), line(2, 'two', 5)];
const retimed = [line(1, 'one', 1.4), line(2, 'two', 5.6)];

const renderEditor = (onSaveLines = vi.fn()) =>
  renderHook(
    ({ lines }: { lines: LyricLine[] }) =>
      useLyricEditorState({ lines, currentTime: 0, duration: 30, onSaveLines }),
    { initialProps: { lines: saved } }
  );

describe('server lines arriving while the editor is dirty', () => {
  it('keeps the edits in progress', () => {
    const { result, rerender } = renderEditor();
    act(() => result.current.nudgeLine(1, 0.2));
    const edited = result.current.editableLines;

    rerender({ lines: retimed });

    expect(result.current.editableLines).toBe(edited);
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it('discards back to the lines the server has now, with nothing left to save', () => {
    const onSaveLines = vi.fn();
    const { result, rerender } = renderEditor(onSaveLines);
    act(() => result.current.nudgeLine(1, 0.2));
    rerender({ lines: retimed });

    act(() => result.current.handleConfirmDiscard());

    expect(result.current.editableLines).toEqual(retimed);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});
