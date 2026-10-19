import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTapCursorHistory } from '../hooks/useTapCursorHistory';
import { LyricLine } from '../types';

describe('useTapCursorHistory Hook', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'One two',
      start_time: 1.0,
      end_time: 3.0,
      words: [
        { word: 'One', start_time: 1.0, end_time: 2.0 },
        { word: 'two', start_time: 2.0, end_time: 3.0 },
      ],
    },
    {
      id: 2,
      text: 'Three four',
      start_time: 4.0,
      end_time: 6.0,
      words: [
        { word: 'Three', start_time: 4.0, end_time: 5.0 },
        { word: 'four', start_time: 5.0, end_time: 6.0 },
      ],
    },
  ];

  const setupHook = (initialLines: LyricLine[] = sampleLines) => {
    let currentLines = initialLines;
    const pushSnapshot = vi.fn();
    const setEditableLines = vi.fn((update) => {
      currentLines = typeof update === 'function' ? update(currentLines) : update;
    });
    const setSelectedLineId = vi.fn();
    const toast = { success: vi.fn() };

    const utils = renderHook(() =>
      useTapCursorHistory({
        editableLines: currentLines,
        currentTime: 2.5,
        duration: 20,
        pushSnapshot,
        setEditableLines,
        setSelectedLineId,
        toast,
      })
    );

    return { ...utils, pushSnapshot, setEditableLines, setSelectedLineId, toast };
  };

  it('initializes with default line sync mode and cursor at line 0, word 0', () => {
    const { result } = setupHook();
    expect(result.current.isTapToSyncActive).toBe(false);
    expect(result.current.tapSyncMode).toBe('line');
    expect(result.current.tapTargetIndex).toBe(0);
    expect(result.current.tapTargetWordIndex).toBe(0);
  });

  it('resets tapTargetWordIndex to 0 when toggling tapSyncMode', () => {
    const { result } = setupHook();

    act(() => {
      result.current.setTapTargetWordIndex(1);
      result.current.setTapSyncMode('word');
    });

    expect(result.current.tapSyncMode).toBe('word');
    expect(result.current.tapTargetWordIndex).toBe(0);
  });

  it('records snapshots and restores cursor indices across undo and redo', () => {
    const { result } = setupHook();

    // 1. Activate Tap-to-Sync and advance cursor
    act(() => {
      result.current.setIsTapToSyncActive(true);
      result.current.setTapSyncMode('word');
    });

    // Record snapshot before tapping
    act(() => {
      result.current.recordTapCursorSnapshot();
      result.current.setTapTargetWordIndex(1);
    });

    // Undo should restore word index 0
    let restoredIdx: number | null = null;
    act(() => {
      restoredIdx = result.current.restoreTapCursorSnapshot('undo');
    });
    expect(restoredIdx).toBe(0);
    expect(result.current.tapTargetWordIndex).toBe(0);

    // Redo should restore word index 1
    act(() => {
      restoredIdx = result.current.restoreTapCursorSnapshot('redo');
    });
    expect(restoredIdx).toBe(0);
    expect(result.current.tapTargetWordIndex).toBe(1);
  });

  it('triggers word taps and pushes snapshots to history', () => {
    const { result, pushSnapshot, setEditableLines } = setupHook();

    act(() => {
      result.current.setIsTapToSyncActive(true);
      result.current.setTapSyncMode('word');
    });

    act(() => {
      result.current.handleTriggerTap();
    });

    expect(pushSnapshot).toHaveBeenCalledTimes(1);
    expect(setEditableLines).toHaveBeenCalledTimes(1);
    expect(result.current.tapTargetWordIndex).toBe(1);
  });

  it('exits cleanly and triggers toast when final word is tapped', () => {
    const { result, toast } = setupHook();

    act(() => {
      result.current.setIsTapToSyncActive(true);
      result.current.setTapSyncMode('word');
      result.current.setTapTargetIndex(1);
      result.current.setTapTargetWordIndex(1); // last word of last line
    });

    act(() => {
      result.current.handleTriggerTap();
    });

    expect(result.current.isTapToSyncActive).toBe(false);
    expect(result.current.tapTargetIndex).toBe(0);
    expect(result.current.tapTargetWordIndex).toBe(0);
    expect(toast.success).toHaveBeenCalledWith('Tap sync complete! Review and Save.');
  });

  it('bounds undo stack to 50 snapshots via FIFO eviction', () => {
    const { result } = setupHook();

    // Push 55 snapshots
    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.setTapTargetWordIndex(i);
        result.current.recordTapCursorSnapshot();
      }
    });

    // Undo 50 times should work
    let undoCount = 0;
    act(() => {
      while (result.current.restoreTapCursorSnapshot('undo') !== null) {
        undoCount++;
      }
    });

    expect(undoCount).toBe(50);

    // 51st undo should return null
    expect(result.current.restoreTapCursorSnapshot('undo')).toBeNull();
  });

  it('returns null on empty undo and redo stacks', () => {
    const { result } = setupHook();
    expect(result.current.restoreTapCursorSnapshot('undo')).toBeNull();
    expect(result.current.restoreTapCursorSnapshot('redo')).toBeNull();
    expect(result.current.restoreTapCursorSnapshot(undefined)).toBeNull();
  });

  it('clears undo and redo stacks when clearTapCursorHistory is called', () => {
    const { result } = setupHook();

    act(() => {
      result.current.recordTapCursorSnapshot();
    });

    act(() => {
      result.current.clearTapCursorHistory();
    });

    expect(result.current.restoreTapCursorSnapshot('undo')).toBeNull();
  });

  it('ignores T keydown events when modifiers are pressed or key is repeating', () => {
    const { result, pushSnapshot } = setupHook();

    act(() => {
      result.current.setIsTapToSyncActive(true);
      result.current.setTapSyncMode('word');
    });

    // Ctrl + T
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true })
    );
    expect(pushSnapshot).not.toHaveBeenCalled();

    // Alt + T
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', code: 'KeyT', altKey: true, bubbles: true })
    );
    expect(pushSnapshot).not.toHaveBeenCalled();

    // Meta + T
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, bubbles: true })
    );
    expect(pushSnapshot).not.toHaveBeenCalled();

    // Repeat key
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', code: 'KeyT', repeat: true, bubbles: true })
    );
    expect(pushSnapshot).not.toHaveBeenCalled();

    // Valid 'T' press without modifiers triggers tap
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    });
    expect(pushSnapshot).toHaveBeenCalledTimes(1);
  });
});
