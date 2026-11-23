import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import adlibCases from '@shared/adlib_cases.json';
import { LyricDisplay } from '../../components/LyricDisplay';
import { adlibFlags } from '../../utils/lyrics';
import type { LyricLine } from '../../types';

function line(id: number, text: string, start: number): LyricLine {
  const words = text.split(' ');
  return {
    id,
    text,
    start_time: start,
    end_time: start + words.length * 0.5,
    words: words.map((word, i) => ({
      word,
      start_time: start + i * 0.5,
      end_time: start + (i + 1) * 0.5,
    })),
  };
}

describe('words sung in parentheses', () => {
  it('are found the same way as on the server', () => {
    for (const c of adlibCases) {
      expect(adlibFlags(c.words)).toEqual(c.adlib);
    }
  });

  it('are styled as backing vocals on the stage, the rest of the line is not', () => {
    render(
      <LyricDisplay
        lines={[line(1, 'Interjection over introspection, (hmm?)', 10)]}
        currentTime={10.2}
      />
    );
    const hmm = screen.getByRole('button', { name: /word \(hmm\?\)/ });
    const over = screen.getByRole('button', { name: /word over/ });
    expect(hmm).toHaveAttribute('data-adlib', 'true');
    expect(hmm).toHaveStyle({ fontSize: '0.8em', opacity: '0.75' });
    expect(over).not.toHaveAttribute('data-adlib');
    expect(over.style.fontSize).toBe('');
    expect(over.style.opacity).toBe('');
  });

  it('style a whole backing line, even one without word timing', () => {
    const untimed: LyricLine = {
      id: 2,
      text: "(It's the laser sharks)",
      start_time: 20,
      end_time: 22,
      words: [],
    };
    render(<LyricDisplay lines={[untimed]} currentTime={20.5} />);
    // Without word timing every word still seeks to the start of the line
    const words = within(screen.getByTestId('active-lyrics-line')).getAllByRole('button');
    expect(words.map((word) => word.getAttribute('aria-label'))).toEqual([
      "Jump playback to word (It's at 20.00 seconds",
      'Jump playback to word the at 20.00 seconds',
      'Jump playback to word laser at 20.00 seconds',
      'Jump playback to word sharks) at 20.00 seconds',
    ]);
    for (const word of words) {
      expect(word).toHaveAttribute('data-adlib', 'true');
      expect(word).toHaveStyle({ fontSize: '0.8em', opacity: '0.75' });
    }
  });
});
