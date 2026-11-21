/**
 * The home headline is sung once, like a karaoke line: each word fills with the lit colour
 * in turn. Assistive tech reads the plain sentence, and the line does not sing again when
 * the home screen comes back.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SungHeadline } from '../../components/track-search/SungHeadline';

const litWords = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-sung-word]'));

describe('sung headline', () => {
  it('sings each word in turn on the first arrival, then stays lit without replaying', () => {
    const first = render(<SungHeadline />);

    // The heading reads as one plain sentence; the lit copies are for the eye only
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      'Turn any song into karaoke'
    );
    const words = litWords(first.container);
    expect(words.map((word) => word.textContent)).toEqual([
      'Turn',
      'any',
      'song',
      'into',
      'karaoke',
    ]);
    for (const word of words) expect(word).toHaveAttribute('aria-hidden', 'true');

    // Each word starts when the one before it ends, and only where motion is welcome
    const starts = words.map((word) => parseInt(word.style.animationDelay, 10));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(words.length);
    for (const word of words) expect(word.className).toContain('motion-safe:animate-word-sweep');

    // Coming back to the home screen shows the line already lit
    first.unmount();
    const second = render(<SungHeadline compact />);
    for (const word of litWords(second.container)) {
      expect(word.className).not.toContain('animate-word-sweep');
      expect(word.style.animationDelay).toBe('');
    }
  });

  it('keeps the heading focusable for the screen change announcement', () => {
    render(<SungHeadline />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveAttribute('data-view-heading');
  });
});
