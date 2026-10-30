/**
 * Guards the design-token migration: components colour themselves through theme tokens
 * (bg-theme-*, text-theme-*, ...) instead of fixed Tailwind palette classes, so every app
 * theme restyles them. Intentional exceptions are listed explicitly.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeProcess = (globalThis as any).process;

const srcRoot: string = fs.existsSync(path.resolve(nodeProcess.cwd(), 'src/components'))
  ? path.resolve(nodeProcess.cwd(), 'src')
  : path.resolve(nodeProcess.cwd(), 'frontend/src');

const PALETTE_CLASS =
  /\b(?:bg|text|border|from|to|via|ring|ring-offset|shadow|fill|stroke|outline|divide|placeholder|accent|caret|decoration)-(?:slate|cyan|purple|emerald|indigo|fuchsia|pink|amber|rose|sky|teal|violet|zinc|gray|neutral|stone|red|green|blue|yellow|orange|lime)-\d{2,3}\b/g;

/** Preset swatch labels sit on the preset's own light or dark stage colour, not the app theme. */
const ALLOWED: Record<string, string[]> = {
  'components/VisualThemePicker.tsx': ['text-neutral-900'],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name: string) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('design token guard', () => {
  it('styles components with theme tokens instead of fixed palette colour classes', () => {
    const files = [...sourceFiles(path.join(srcRoot, 'components')), path.join(srcRoot, 'App.tsx')];
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(srcRoot, file).split(path.sep).join('/');
      const allowed = ALLOWED[rel] ?? [];
      const source: string = fs.readFileSync(file, 'utf8');
      for (const match of source.match(PALETTE_CLASS) ?? []) {
        if (!allowed.includes(match)) offenders.push(`${rel}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships no legacy palette override layer in index.css', () => {
    const css: string = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf8');
    expect(css).not.toMatch(/\[data-theme\]\s+\.(bg|text|border)-(slate|cyan)-/);
    expect(css).not.toMatch(/\.text-white:not/);
  });
});
