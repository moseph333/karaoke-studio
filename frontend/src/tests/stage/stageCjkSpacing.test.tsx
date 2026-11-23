import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { tokenizeLyricText } from '../../utils/lyrics';
import type { LyricLine } from '../../types';

function timed(text: string, start = 10): LyricLine {
  const tokens = tokenizeLyricText(text);
  return {
    id: 1,
    text,
    start_time: start,
    end_time: start + tokens.length * 0.3,
    words: tokens.map((word, i) => ({
      word,
      start_time: start + i * 0.3,
      end_time: start + (i + 1) * 0.3,
    })),
  };
}

/** Whether the word's button draws a space after the word. */
const drawsSpace = (word: HTMLElement) => (word.firstElementChild?.textContent ?? '').endsWith(' ');
const spaced = (name: RegExp) => drawsSpace(screen.getByRole('button', { name }));

describe('the stage spaces words as the line is written', () => {
  it('keeps Japanese characters together and the source spaces between groups', () => {
    render(
      <LyricDisplay
        lines={[timed('幸せなサメ サメ (Shiawase na same, same)')]}
        currentTime={10.1}
      />
    );
    expect(spaced(/word 幸 /)).toBe(false);
    expect(spaced(/word せ /)).toBe(false);
    // The fifth character ends the first group, which the source follows with a space
    const fifth = screen.getAllByRole('button', { name: /word メ / })[0];
    expect(drawsSpace(fifth)).toBe(true);
    expect(spaced(/word \(Shiawase /)).toBe(true);
  });

  it('spaces Latin words, but not after the last one', () => {
    render(<LyricDisplay lines={[timed('Lasers from the dark')]} currentTime={10.1} />);
    expect(spaced(/word Lasers /)).toBe(true);
    expect(spaced(/word dark /)).toBe(false);
  });
});

describe('a Japanese line with its romanization', () => {
  it('shows the romanization under the line', () => {
    const line = { ...timed('我々和かつ'), romaji: 'Wareware wa katsu' };
    render(<LyricDisplay lines={[line]} currentTime={10.1} />);
    const romaji = screen.getByTestId('stage-romaji');
    expect(romaji).toHaveTextContent('Wareware wa katsu');
    expect(romaji).toHaveAttribute('data-line', '0');
  });

  it('shows nothing extra for other lines', () => {
    render(<LyricDisplay lines={[timed('Lasers from the dark')]} currentTime={10.1} />);
    expect(screen.queryByTestId('stage-romaji')).not.toBeInTheDocument();
  });
});
