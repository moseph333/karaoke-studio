import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { mergeLineWithNext, splitLineAfterWord } from '../../utils/lineSplitMerge';
import { tokenizeLyricText } from '../../utils/lyrics';
import type { LyricLine } from '../../types';

function timed(id: number, text: string, start: number, step = 0.4): LyricLine {
  const tokens = tokenizeLyricText(text);
  return {
    id,
    text,
    start_time: start,
    end_time: start + tokens.length * step,
    words: tokens.map((word, i) => ({
      word,
      start_time: start + i * step,
      end_time: start + (i + 1) * step,
    })),
  };
}

const NARRATOR = timed(
  1,
  'On a strange planet in a far away galaxy there were three teenage sharks',
  3.2
);
const NEXT = timed(2, 'That were visited by humans', 9.5);

describe('splitting and merging lines', () => {
  it('splits after a word, keeping every word where it was', () => {
    const split = splitLineAfterWord([NARRATOR, NEXT], 1, 6)!;
    expect(split.map((l) => l.text)).toEqual([
      'On a strange planet in a far',
      'away galaxy there were three teenage sharks',
      'That were visited by humans',
    ]);
    expect(split.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(split[0].end_time).toBe(NARRATOR.words[6].end_time);
    expect(split[1].start_time).toBe(NARRATOR.words[7].start_time);
    expect([...split[0].words, ...split[1].words]).toEqual(NARRATOR.words);
  });

  it('keeps Japanese characters together when splitting', () => {
    const line = { ...timed(1, '幸せなサメ サメ', 1), romaji: 'Shiawase na same, same' };
    const [first, second] = splitLineAfterWord([line], 1, 4)!;
    expect(first.text).toBe('幸せなサメ');
    expect(second.text).toBe('サメ');
    expect(first.romaji).toBeUndefined();
  });

  it('refuses a split after the last word or of a missing line', () => {
    expect(splitLineAfterWord([NEXT], 2, NEXT.words.length - 1)).toBeNull();
    expect(splitLineAfterWord([NEXT], 9, 0)).toBeNull();
  });

  it('merges a line with the next one', () => {
    const [merged] = mergeLineWithNext([NARRATOR, NEXT], 1)!;
    expect(merged.text).toBe(`${NARRATOR.text} ${NEXT.text}`);
    expect(merged.words).toEqual([...NARRATOR.words, ...NEXT.words]);
    expect([merged.start_time, merged.end_time]).toEqual([NARRATOR.start_time, NEXT.end_time]);
    expect(mergeLineWithNext([NARRATOR, NEXT], 2)).toBeNull();
    const cjk = mergeLineWithNext([timed(1, '幸せな', 1), timed(2, 'サメ', 3)], 1)!;
    expect(cjk[0].text).toBe('幸せなサメ');
  });

  it('are offered in the timeline and undo as one edit', async () => {
    const user = userEvent.setup();
    render(
      <LyricTimelineEditor
        lines={[NARRATOR, NEXT]}
        currentTime={0}
        duration={244}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Expand word timings for line 1' }));
    await user.click(screen.getByTestId('split-after-word-1-6'));
    const container = screen.getByTestId('timeline-scroll-container');
    expect(within(container).getByText('On a strange planet in a far')).toBeInTheDocument();
    expect(
      within(container).getByText('away galaxy there were three teenage sharks')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More actions for line 1' }));
    await user.click(await screen.findByTestId('line-1-merge-next'));
    expect(within(container).getByText(NARRATOR.text)).toBeInTheDocument();

    // Undo takes back the merge alone: the split lines return
    await user.click(screen.getAllByRole('button', { name: /^Undo/ })[0]);
    expect(within(container).getByText('On a strange planet in a far')).toBeInTheDocument();
  });
});
