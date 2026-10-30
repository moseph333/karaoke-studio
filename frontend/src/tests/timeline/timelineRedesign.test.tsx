import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { useStableHandlers } from '../../hooks/useStableHandlers';
import { LyricLine } from '../../types';

const lines: LyricLine[] = [
  {
    id: 1,
    text: 'First line here',
    start_time: 1,
    end_time: 3,
    words: [
      { word: 'First', start_time: 1, end_time: 1.6 },
      { word: 'line', start_time: 1.6, end_time: 2.2 },
      { word: 'here', start_time: 2.2, end_time: 3 },
    ],
  },
  {
    id: 2,
    text: 'Second line',
    start_time: 8,
    end_time: 10,
    words: [
      { word: 'Second', start_time: 8, end_time: 9 },
      { word: 'line', start_time: 9, end_time: 10 },
    ],
  },
  {
    id: 3,
    text: 'Third line',
    start_time: 14,
    end_time: 16,
    words: [
      { word: 'Third', start_time: 14, end_time: 15 },
      { word: 'line', start_time: 15, end_time: 16 },
    ],
  },
];

const renderEditor = (props: Partial<React.ComponentProps<typeof LyricTimelineEditor>> = {}) => {
  const onSaveLines = vi.fn().mockResolvedValue(undefined);
  const onSeek = vi.fn();
  const utils = render(
    <LyricTimelineEditor
      lines={lines}
      currentTime={1.2}
      duration={60}
      onSeek={onSeek}
      onSaveLines={onSaveLines}
      {...props}
    />
  );
  return { ...utils, onSaveLines, onSeek };
};

const saveAndGetLines = async (
  user: ReturnType<typeof userEvent.setup>,
  onSaveLines: ReturnType<typeof vi.fn>
): Promise<LyricLine[]> => {
  await user.click(screen.getByTestId('save-lyrics-btn'));
  expect(onSaveLines).toHaveBeenCalledTimes(1);
  return onSaveLines.mock.calls[0][0] as LyricLine[];
};

describe('Timeline redesign', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('calm rows', () => {
    it('shows word chips only for the active line and the selected line', async () => {
      const user = userEvent.setup();
      renderEditor();

      expect(screen.getByTestId('timeline-words-line-1')).toBeInTheDocument();
      expect(screen.queryByTestId('timeline-words-line-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-words-line-3')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /select line: Third line/i }));
      expect(screen.getByTestId('timeline-words-line-3')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-line-3')).not.toHaveAttribute('data-active-line');
    });

    it('marks the active row and keeps its secondary controls at full strength', () => {
      renderEditor();
      const active = screen.getByTestId('timeline-line-1');
      const idle = screen.getByTestId('timeline-line-2');
      expect(active).toHaveAttribute('data-active-line', 'true');

      const activeDelete = within(active).getByRole('button', { name: 'Delete line 1' });
      const idleDelete = within(idle).getByRole('button', { name: 'Delete line 2' });
      // Idle rows fade their icon tools only on hover-capable screens until hovered or focused
      const fadedGroup = idleDelete.closest('[class*="opacity-70"]');
      expect(fadedGroup?.className).toContain('[@media(hover:hover)]:opacity-70');
      expect(fadedGroup?.className).toContain('group-focus-within/line:opacity-100');
      expect(activeDelete.closest('[class*="opacity-70"]')).toBeNull();
      // Buttons with text (the fine nudges) never fade
      const fineNudge = within(idle).getByRole('button', { name: 'Nudge line 2 0.05s later' });
      expect(fineNudge.closest('[class*="opacity-"]')).toBeNull();
    });

    it('labels each row with its duet part using an icon chip', () => {
      renderEditor({ lines: [{ ...lines[0], singer: 'singer2' }, lines[1]] });
      const chip = screen.getByTestId('toggle-singer-1');
      expect(chip).toHaveAttribute('data-singer', 'singer2');
      expect(chip).toHaveTextContent('S2');
      expect(chip).toHaveAccessibleName(
        'Singer: Singer 2 / Partner. Click to cycle to Both / Duet'
      );
    });
  });

  describe('row More menu', () => {
    it('assigns a duet part directly and the change is undoable', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'More actions for line 2' }));
      const menu = screen.getByRole('menu', { name: 'Line 2 actions' });
      expect(within(menu).getByText('Assign singer')).toBeInTheDocument();

      const options = within(menu).getAllByRole('menuitemradio');
      expect(options.map((o) => o.textContent)).toEqual([
        'Singer 1 / Lead',
        'Singer 2 / Partner',
        'Both / Duet',
      ]);
      expect(options[0]).toHaveAttribute('aria-checked', 'true');
      expect(options[2]).toHaveAttribute('aria-checked', 'false');

      await user.click(options[2]);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.getByTestId('toggle-singer-2')).toHaveAttribute('data-singer', 'both');
      expect(screen.getByRole('button', { name: 'More actions for line 2' })).toHaveFocus();

      await user.click(screen.getByTestId('undo-lyrics-btn'));
      expect(screen.getByTestId('toggle-singer-2')).toHaveAttribute('data-singer', 'singer1');
    });

    it('offers insert and delete for narrow cards where the inline buttons are hidden', async () => {
      const user = userEvent.setup();
      renderEditor();
      // Inline structure buttons collapse below a 480px card width
      const inlineGroup = screen.getByTestId('delete-line-2').closest('[class*="@[480px]:flex"]');
      expect(inlineGroup?.className).toContain('hidden');

      await user.click(screen.getByRole('button', { name: 'More actions for line 2' }));
      const menu = screen.getByRole('menu', { name: 'Line 2 actions' });
      expect(within(menu).getByText('Line')).toHaveAttribute('role', 'presentation');
      await user.click(within(menu).getByRole('menuitem', { name: 'Insert line below' }));
      expect(screen.getAllByTestId(/^timeline-line-\d+$/)).toHaveLength(4);
      // The new line opens in edit mode; finish editing before the next action
      await user.keyboard('{Escape}');

      await user.click(screen.getByRole('button', { name: 'More actions for line 1' }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete line' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('choosing the current part changes nothing', async () => {
      const user = userEvent.setup();
      renderEditor();
      await user.click(screen.getByRole('button', { name: 'More actions for line 1' }));
      await user.click(screen.getByRole('menuitemradio', { name: 'Singer 1 / Lead' }));
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });
  });

  describe('review filter', () => {
    const flagged: LyricLine[] = [lines[0], { ...lines[1], words: [] }, lines[2]];

    it('flags lines with timing problems and filters to them', async () => {
      const user = userEvent.setup();
      renderEditor({ lines: flagged });

      const marker = screen.getByTestId('line-review-2');
      expect(marker).toHaveAccessibleName('Needs review: No word timings');
      expect(screen.queryByTestId('line-review-1')).not.toBeInTheDocument();

      const filter = screen.getByRole('button', { name: 'Needs review (1)' });
      expect(filter).toHaveAttribute('aria-pressed', 'false');
      await user.click(filter);
      expect(filter).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('timeline-line-2')).toBeInTheDocument();
      expect(screen.queryByTestId('timeline-line-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-line-3')).not.toBeInTheDocument();
      // Appending lines only makes sense in the full list
      expect(screen.queryByRole('button', { name: 'Add new lyric line' })).not.toBeInTheDocument();

      await user.click(filter);
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
    });

    it('shows an all-clear state once the flagged lines are fixed', async () => {
      const user = userEvent.setup();
      renderEditor({ lines: flagged });
      await user.click(screen.getByRole('button', { name: 'Needs review (1)' }));

      // Re-typing the text regenerates word timings, which resolves the issue
      await user.click(screen.getByTestId('edit-line-text-2'));
      const input = screen.getByRole('textbox', { name: 'Edit text for line 2' });
      await user.clear(input);
      await user.type(input, 'Second line again{Enter}');

      expect(screen.getByText('No lines need review.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Show all lines' }));
      expect(screen.getByTestId('timeline-line-1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Needs review/ })).not.toBeInTheDocument();
    });

    it('hides the filter when no line needs review', () => {
      renderEditor();
      expect(screen.queryByTestId('timeline-review-filter')).not.toBeInTheDocument();
    });
  });

  describe('live playback clock', () => {
    it('stamps tap-sync taps with the live clock instead of the last timeupdate', async () => {
      const user = userEvent.setup();
      const { onSaveLines } = renderEditor({ currentTime: 0, getCurrentTime: () => 4.37 });

      await user.click(screen.getByTestId('tap-to-sync-btn'));
      await user.click(screen.getByTestId('tap-now-btn'));

      const saved = await saveAndGetLines(user, onSaveLines);
      expect(saved[0].start_time).toBe(4.37);
    });

    it('falls back to currentTime when no live clock is provided', async () => {
      const user = userEvent.setup();
      const { onSaveLines } = renderEditor({ currentTime: 2.5 });
      await user.click(screen.getByTestId('tap-to-sync-btn'));
      await user.click(screen.getByTestId('tap-now-btn'));
      const saved = await saveAndGetLines(user, onSaveLines);
      expect(saved[0].start_time).toBe(2.5);
    });

    it('snaps word boundaries to the live playhead', async () => {
      const user = userEvent.setup();
      const { onSaveLines } = renderEditor({ currentTime: 1.2, getCurrentTime: () => 1.33 });

      await user.click(screen.getByRole('button', { name: 'Expand word timings for line 1' }));
      await user.click(
        screen.getByRole('button', { name: 'Snap start of word First to playhead' })
      );

      const saved = await saveAndGetLines(user, onSaveLines);
      expect(saved[0].words[0].start_time).toBe(1.33);
    });
  });

  describe('toolbar', () => {
    it('keeps the resume pill out of the header and resumes auto-scroll on click', () => {
      renderEditor({ isPlaying: true });
      const container = screen.getByTestId('timeline-scroll-container');
      act(() => {
        fireEvent.wheel(container);
        container.scrollTop = 25;
        fireEvent.scroll(container);
      });
      const pill = screen.getByRole('button', { name: /Auto-scroll paused/ });
      expect(pill).toHaveClass('absolute');
      fireEvent.click(pill);
      expect(screen.queryByRole('button', { name: /Auto-scroll paused/ })).not.toBeInTheDocument();
    });

    describe('layout-driven scroll events', () => {
      const setup = () => {
        renderEditor({ isPlaying: true });
        const container = screen.getByTestId('timeline-scroll-container');
        const setSize = (clientHeight: number) => {
          Object.defineProperty(container, 'clientHeight', {
            value: clientHeight,
            configurable: true,
          });
          Object.defineProperty(container, 'scrollHeight', { value: 900, configurable: true });
        };
        setSize(300);
        // A first manual scroll records the list size; resume from it
        act(() => {
          container.scrollTop = 200;
          fireEvent.scroll(container);
        });
        fireEvent.click(screen.getByRole('button', { name: /Auto-scroll paused/ }));
        return { container, setSize };
      };

      it('does not pause auto-scroll when the browser re-clamps the list after a resize', () => {
        const { container, setSize } = setup();
        // The viewport grows (window resize / fonts loading) and the browser moves scrollTop
        setSize(420);
        act(() => {
          container.scrollTop = 120;
          fireEvent.scroll(container);
        });
        expect(
          screen.queryByRole('button', { name: /Auto-scroll paused/ })
        ).not.toBeInTheDocument();
        expect(container.className).toContain('[overflow-anchor:none]');
      });

      it('still pauses when the user scrolls while the list resizes', () => {
        const { container, setSize } = setup();
        setSize(420);
        act(() => {
          fireEvent.wheel(container);
          container.scrollTop = 0;
          fireEvent.scroll(container);
        });
        expect(screen.getByRole('button', { name: /Auto-scroll paused/ })).toBeInTheDocument();
      });
    });

    it('marks tap sync as a pressed toggle while active', async () => {
      const user = userEvent.setup();
      renderEditor();
      const tap = screen.getByTestId('tap-to-sync-btn');
      expect(tap).toHaveAttribute('aria-pressed', 'false');
      await user.click(tap);
      expect(tap).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the line count and a compact Save while edits are pending', async () => {
      const user = userEvent.setup();
      renderEditor();
      expect(screen.getByText('3 lines')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Nudge line 2 0.05s later' }));
      expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();
      expect(screen.getByTestId('save-lyrics-btn')).toHaveTextContent(/^Save/);
    });
  });
});

describe('useStableHandlers', () => {
  it('keeps handler identities stable while calling the latest implementation', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useStableHandlers({ onEvent: fn }), {
      initialProps: { fn: first },
    });
    const initial = result.current.onEvent;
    rerender({ fn: second });
    expect(result.current.onEvent).toBe(initial);
    result.current.onEvent('x');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });
});
