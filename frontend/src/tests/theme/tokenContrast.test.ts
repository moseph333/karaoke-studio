/**
 * Contrast of the app's palette, read from the tokens in src/index.css: text and lyrics on
 * the page, status badges on their tints, and the solid danger button.
 */

import { describe, it, expect } from 'vitest';
import { badgeTones, buttonVariants } from '../../components/ui/variants';
import { channels, contrast, readRootTokens, tint } from '../helpers/cssTokens';

const tokens = readRootTokens();
const color = (name: string): string => {
  const value = tokens[`--theme-${name}`];
  expect(value, `--theme-${name}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
};
const ratio = (fg: string, bg: string): number =>
  contrast(channels(color(fg)), channels(color(bg)));

// Status badges (ui/variants badgeTones): text on a 15% tint of its own colour, on the page
// or a card. The accent badge puts highlight text on a 15% accent tint. Highlight text
// (links, active states) also sits on the same surfaces untinted.
const BADGES = ['success', 'warning', 'danger', 'info'] as const;
const BASES = ['bg', 'surface'] as const;

describe('contrast of the app palette', () => {
  it('keeps text and lyrics at 7:1 on the page', () => {
    expect(ratio('text', 'bg')).toBeGreaterThanOrEqual(7);
    expect(ratio('text', 'surface')).toBeGreaterThanOrEqual(7);
    expect(ratio('sung', 'bg')).toBeGreaterThanOrEqual(7);
    expect(ratio('unsung', 'bg')).toBeGreaterThanOrEqual(7);
  });

  it('keeps muted text, button labels and status colours at 4.5:1', () => {
    expect(ratio('text-muted', 'surface-raised')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('accent-text', 'accent')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('accent-text', 'accent-hover')).toBeGreaterThanOrEqual(4.5);
    for (const status of [...BADGES, 'focus']) {
      expect(ratio(status, 'surface'), status).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('matches the Badge tones in ui/variants', () => {
    for (const tone of BADGES) {
      expect(badgeTones[tone]).toContain(`bg-theme-${tone}/15`);
      expect(badgeTones[tone]).toContain(`text-theme-${tone}`);
    }
    expect(badgeTones.accent).toContain('bg-theme-accent/15');
    expect(badgeTones.accent).toContain('text-theme-highlight');
    expect(buttonVariants.destructive).toContain('bg-theme-danger');
    expect(buttonVariants.destructive).toContain('text-theme-text-inverse');
  });

  it('keeps badges, highlight text and danger buttons at 4.5:1', () => {
    const failures: string[] = [];
    for (const base of BASES) {
      for (const tone of BADGES) {
        const badge = contrast(channels(color(tone)), tint(color(tone), 0.15, color(base)));
        if (badge < 4.5) failures.push(`${tone} badge on ${base}: ${badge.toFixed(2)}`);
      }
      const accent = contrast(
        channels(color('highlight')),
        tint(color('accent'), 0.15, color(base))
      );
      if (accent < 4.5) failures.push(`accent badge on ${base}: ${accent.toFixed(2)}`);
      if (ratio('highlight', base) < 4.5) failures.push(`highlight on ${base}`);
    }
    // Solid danger buttons (the destructive variant, InlineConfirm) put inverse text on danger
    if (ratio('text-inverse', 'danger') < 4.5) failures.push('destructive button');
    expect(failures).toEqual([]);
  });
});
