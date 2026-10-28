import { describe, it, expect } from 'vitest';
import {
  AFTERGLOW_THEME,
  APP_THEMES,
  hexToRgbChannels,
  buildThemeCssVariables,
} from '../theme/appThemes';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('Afterglow flagship theme tokens', () => {
  const c = AFTERGLOW_THEME.colors;

  it('is registered as afterglow with a matching stage preset', () => {
    expect(APP_THEMES.afterglow).toBe(AFTERGLOW_THEME);
    expect(AFTERGLOW_THEME.stagePresetId).toBe('afterglow');
    expect(AFTERGLOW_THEME.name).toBe('Afterglow');
  });

  it('meets WCAG AA contrast for text, muted text and accent buttons', () => {
    expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.textMuted, c.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentText, c.accentHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.highlight, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the sung lyric color highly legible on the stage', () => {
    expect(contrast(c.sung, c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.unsung, c.bg)).toBeGreaterThanOrEqual(7);
  });

  it('defines semantic status tokens that read on surfaces', () => {
    for (const key of ['success', 'warning', 'danger', 'info', 'focus'] as const) {
      expect(c[key], key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(c[key]!, c.surface), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('exposes brand gradient, stage gradient and glass alpha effects', () => {
    const vars = AFTERGLOW_THEME.cssVariables;
    expect(vars['--theme-gradient-accent']).toContain('linear-gradient');
    expect(vars['--theme-gradient-stage']).toContain('radial-gradient');
    expect(parseFloat(vars['--theme-glass-alpha'])).toBeGreaterThan(0);
    expect(parseFloat(vars['--theme-glass-alpha'])).toBeLessThanOrEqual(1);
  });

  it('emits Tailwind-ready rgb channel variables', () => {
    expect(AFTERGLOW_THEME.cssVariables['--theme-accent-rgb']).toBe('124 58 237');
    expect(AFTERGLOW_THEME.cssVariables['--theme-bg-rgb']).toBe('11 11 18');
  });
});

describe('hexToRgbChannels', () => {
  it('parses 3, 4, 6 and 8 digit hex as well as rgb() strings', () => {
    expect(hexToRgbChannels('#fff')).toBe('255 255 255');
    expect(hexToRgbChannels('#fc0a')).toBe('255 204 0');
    expect(hexToRgbChannels('#7c3aed')).toBe('124 58 237');
    expect(hexToRgbChannels('#7c3aedff')).toBe('124 58 237');
    expect(hexToRgbChannels('rgb(250, 204, 21)')).toBe('250 204 21');
    expect(hexToRgbChannels('rgba(1 2 3 / 0.5)')).toBe('1 2 3');
  });

  it('returns null for unparseable colors and the builder falls back safely', () => {
    expect(hexToRgbChannels('var(--x)')).toBeNull();
    expect(hexToRgbChannels('hsl(0, 84%, 60%)')).toBeNull();
    expect(hexToRgbChannels('')).toBeNull();
    const vars = buildThemeCssVariables(
      { ...AFTERGLOW_THEME.colors, highlight: 'var(--custom)' },
      AFTERGLOW_THEME.typography,
      AFTERGLOW_THEME.geometry,
      AFTERGLOW_THEME.shadows
    );
    expect(vars['--theme-highlight']).toBe('var(--custom)');
    expect(vars['--theme-highlight-rgb']).toBe('0 0 0');
  });
});
