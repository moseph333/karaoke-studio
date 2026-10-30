import { describe, it, expect } from 'vitest';
import { APP_THEME_LIST } from '../theme/appThemes';
import { badgeTones, buttonVariants } from '../components/ui/variants';

type Rgb = [number, number, number];

// WCAG 2.x relative luminance and contrast ratio
const channels = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
};
const luminance = (rgb: Rgb): number => {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `tone` at `alpha` over `base`, as a Tailwind bg-theme-tone/NN tint draws it. */
const tint = (tone: string, alpha: number, base: string): Rgb =>
  channels(tone).map((c, i) => Math.round(c * alpha + channels(base)[i] * (1 - alpha))) as Rgb;

// Status badges (ui/variants badgeTones): text on a 15% tint of its own colour, on the page
// or a card. The accent badge puts highlight text on a 15% accent tint. Highlight text
// (links, active states) also sits on the same surfaces untinted.
const BADGES = ['success', 'warning', 'danger', 'info'] as const;
const BASES = ['bg', 'surface'] as const;

describe('contrast of badges, highlight text and danger buttons in every app theme', () => {
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

  it.each(APP_THEME_LIST.map((theme) => [theme.name, theme] as const))(
    '%s: badges, highlight text and danger buttons reach 4.5:1',
    (_name, theme) => {
      const colors = theme.colors as unknown as Record<string, string>;
      const failures: string[] = [];
      for (const base of BASES) {
        for (const tone of BADGES) {
          const ratio = contrast(channels(colors[tone]), tint(colors[tone], 0.15, colors[base]));
          if (ratio < 4.5) failures.push(`${tone} badge on ${base}: ${ratio.toFixed(2)}`);
        }
        const accent = contrast(
          channels(colors.highlight),
          tint(colors.accent, 0.15, colors[base])
        );
        if (accent < 4.5) failures.push(`accent badge on ${base}: ${accent.toFixed(2)}`);
        const highlight = contrast(channels(colors.highlight), channels(colors[base]));
        if (highlight < 4.5) failures.push(`highlight on ${base}: ${highlight.toFixed(2)}`);
      }
      // Solid danger buttons (the destructive variant, InlineConfirm) put inverse text on danger
      const destructive = contrast(channels(colors.textInverse), channels(colors.danger));
      if (destructive < 4.5) failures.push(`destructive button: ${destructive.toFixed(2)}`);
      expect(failures).toEqual([]);
    }
  );
});
