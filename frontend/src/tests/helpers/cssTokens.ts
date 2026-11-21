/**
 * The design tokens as the stylesheet defines them: every custom property of the `:root`
 * block in src/index.css, plus WCAG contrast helpers for tests that check the palette.
 */

import { readFrontendFile } from './frontendFiles';

/** `--theme-bg` → `#0b0b12`, `--theme-font-body` → `Inter, …`, as written in `:root`. */
export function readRootTokens(): Record<string, string> {
  const css = readFrontendFile('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error(':root block not found in src/index.css');
  const tokens: Record<string, string> = {};
  for (const match of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

export type Rgb = [number, number, number];

export const channels = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
};

// WCAG 2.x relative luminance and contrast ratio
const luminance = (rgb: Rgb): number => {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
};

export const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `tone` at `alpha` over `base`, as a Tailwind `bg-theme-tone/NN` tint draws it. */
export const tint = (tone: string, alpha: number, base: string): Rgb =>
  channels(tone).map((c, i) => Math.round(c * alpha + channels(base)[i] * (1 - alpha))) as Rgb;
