/**
 * Enter (and Escape, and the arrows) pressed while an input method is composing belong to
 * the input method: they pick or dismiss a candidate and must not submit the field.
 */

import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { loadDeferredScreens } from '../../deferredScreens';
import { ChordBar } from '../../components/ChordBar';
import { CommandPaletteProvider } from '../../components/commandPalette/CommandPaletteProvider';
import { useCommandPalette, useRegisterCommands } from '../../components/commandPalette/context';
import { TimelineLineCard } from '../../components/timeline/TimelineLineCard';
import { isImeKeyEvent } from '../../utils/imeComposition';

/** The keydown Chrome and Firefox send for a key the input method handles. */
const composing = { isComposing: true, keyCode: 229 };
/** Safari's Enter that confirms a composition: sent after it ended, still with code 229. */
const safariConfirm = { isComposing: false, keyCode: 229 };

describe('isImeKeyEvent', () => {
  it('tells composition keys from plain ones', () => {
    expect(isImeKeyEvent(new KeyboardEvent('keydown', { key: 'Enter', ...composing }))).toBe(true);
    expect(isImeKeyEvent(new KeyboardEvent('keydown', { key: 'Enter', ...safariConfirm }))).toBe(
      true
    );
    expect(isImeKeyEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }))).toBe(false);
  });
});

describe('editing a lyric line with an input method', () => {
  const line = {
    id: 3,
    text: 'きみのなまえ',
    start_time: 1,
    end_time: 4,
    words: [{ word: 'きみのなまえ', start_time: 1, end_time: 4 }],
  };

  function renderEditingCard() {
    const onCommitEditing = vi.fn();
    const onCancelEditing = vi.fn();
    render(
      <TimelineLineCard
        line={line}
        idx={0}
        isCurrentlyActive={false}
        isExpanded={false}
        editingLineId={3}
        editingText="きみの"
        activeWordLoc={null}
        editInputRef={{ current: null }}
        onLineClick={vi.fn()}
        onWordClick={vi.fn()}
        onStartEditing={vi.fn()}
        onCommitEditing={onCommitEditing}
        onCancelEditing={onCancelEditing}
        onSetEditingText={vi.fn()}
        onNudgeLine={vi.fn()}
        onInsertLineAbove={vi.fn()}
        onInsertLineBelow={vi.fn()}
        onDeleteLine={vi.fn()}
        onToggleExpand={vi.fn()}
        onNudgeWord={vi.fn()}
        onNudgeWordBoundary={vi.fn()}
        onUpdateWordTiming={vi.fn()}
      />
    );
    return { input: screen.getByDisplayValue('きみの'), onCommitEditing, onCancelEditing };
  }

  it('does not save the line when Enter picks a candidate', () => {
    const { input, onCommitEditing, onCancelEditing } = renderEditingCard();

    fireEvent.keyDown(input, { key: 'Enter', ...composing });
    fireEvent.keyDown(input, { key: 'Enter', ...safariConfirm });
    fireEvent.keyDown(input, { key: 'Escape', ...composing });

    expect(onCommitEditing).not.toHaveBeenCalled();
    expect(onCancelEditing).not.toHaveBeenCalled();
  });

  it('saves the line on a plain Enter', () => {
    const { input, onCommitEditing } = renderEditingCard();

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });

    expect(onCommitEditing).toHaveBeenCalledWith(3, 'きみの');
  });
});

describe('searching the command palette with an input method', () => {
  beforeAll(() => loadDeferredScreens());

  const Registrar: React.FC<{ run: () => void }> = ({ run }) => {
    useRegisterCommands('test', [
      { id: 'play', title: 'Play', group: 'Playback', run },
      { id: 'mute', title: 'Mute', group: 'Playback', run: vi.fn() },
    ]);
    const palette = useCommandPalette();
    return (
      <button type="button" onClick={palette?.open}>
        Open palette
      </button>
    );
  };

  it('does not run the highlighted command when Enter picks a candidate', () => {
    const run = vi.fn();
    render(
      <CommandPaletteProvider>
        <Registrar run={run} />
      </CommandPaletteProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }));
    const search = screen.getByRole('combobox');
    const highlighted = search.getAttribute('aria-activedescendant');

    fireEvent.keyDown(search, { key: 'ArrowDown', ...composing });
    expect(search.getAttribute('aria-activedescendant')).toBe(highlighted);
    fireEvent.keyDown(search, { key: 'Enter', ...composing });
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('editing a chord with an input method', () => {
  it('does not save the chord when Enter picks a candidate', () => {
    const onEditChord = vi.fn();
    render(
      <ChordBar
        chords={[{ chord: 'C', start: 0, end: 4 }]}
        currentTime={1}
        onEditChord={onEditChord}
      />
    );
    fireEvent.click(screen.getByTestId('edit-active-chord-btn'));
    const input = screen.getByTestId('chord-edit-input');
    fireEvent.change(input, { target: { value: 'Am' } });

    fireEvent.keyDown(input, { key: 'Enter', ...composing });
    expect(onEditChord).not.toHaveBeenCalled();
    expect(screen.getByTestId('chord-edit-input')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(onEditChord).toHaveBeenCalledWith(0, 'Am');
  });
});
