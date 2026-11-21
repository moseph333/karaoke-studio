/**
 * Contrast of the app's palette, read from the tokens in src/index.css. The look is flat:
 * text and status colours sit straight on the page or on a hover surface, never on a tint,
 * so each colour is checked against those surfaces directly.
 */

import { describe, it, expect } from 'vitest';
import { badgeTones, buttonVariants } from '../../components/ui/variants';
import { channels, contrast, readRootTokens } from '../helpers/cssTokens';

const tokens = readRootTokens();
const color = (name: string): string => {
  const value = tokens[`--theme-${name}`];
  expect(value, `--theme-${name}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
};
const ratio = (fg: string, bg: string): number =>
  contrast(channels(color(fg)), channels(color(bg)));

// Where text can sit: the page, dialogs, and the hover and pressed surfaces
const SURFACES = ['bg', 'surface', 'surface-subtle', 'surface-raised'] as const;

describe('contrast of the app palette', () => {
  it('keeps text and lyrics at 7:1', () => {
    for (const surface of SURFACES) {
      expect(ratio('text', surface), surface).toBeGreaterThanOrEqual(7);
    }
    expect(ratio('sung', 'bg')).toBeGreaterThanOrEqual(7);
    expect(ratio('unsung', 'bg')).toBeGreaterThanOrEqual(7);
  });

  it('keeps muted text, the accent and status colours at 4.5:1 on every surface', () => {
    for (const surface of SURFACES) {
      for (const name of ['text-muted', 'accent', 'success', 'warning', 'danger', 'focus']) {
        expect(ratio(name, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the labels of solid buttons at 4.5:1', () => {
    expect(buttonVariants.primary).toContain('bg-theme-accent');
    expect(buttonVariants.primary).toContain('text-theme-accent-text');
    expect(ratio('accent-text', 'accent')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('accent-text', 'accent-hover')).toBeGreaterThanOrEqual(4.5);

    // The destructive button and InlineConfirm put inverse text on danger
    expect(buttonVariants.destructive).toContain('bg-theme-danger');
    expect(buttonVariants.destructive).toContain('text-theme-text-inverse');
    expect(ratio('text-inverse', 'danger')).toBeGreaterThanOrEqual(4.5);

    // An outlined button inverts on hover: inverse text on the text colour
    expect(buttonVariants.secondary).toContain('hover:bg-theme-text');
    expect(ratio('text-inverse', 'text')).toBeGreaterThanOrEqual(4.5);
  });

  it('outlines fields and controls in a colour that stands out from the page', () => {
    expect(ratio('border', 'bg')).toBeGreaterThanOrEqual(3);
  });

  it('draws badges as words in a colour, never on a tint', () => {
    for (const [tone, classes] of Object.entries(badgeTones)) {
      expect(classes, tone).toMatch(/^text-theme-[a-z-]+$/);
    }
  });
});
