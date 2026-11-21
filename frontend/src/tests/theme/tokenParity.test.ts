/**
 * The app has one look, defined by the tokens in src/index.css. A few values have to be
 * repeated where the stylesheet cannot reach: the Tailwind token list, the page's
 * theme-color meta tag and the web manifest. This keeps the copies in step, and checks that
 * nothing of the retired app themes is left to switch the look at run time.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile, readIndexHtml } from '../helpers/frontendFiles';
import { channels, readRootTokens } from '../helpers/cssTokens';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const frontendDir: string = fs.existsSync(path.resolve(cwd, 'src/index.css'))
  ? cwd
  : path.resolve(cwd, 'frontend');

const tokens = readRootTokens();
const indexHtml = readIndexHtml();

/** The colour names Tailwind maps to `rgb(var(--theme-<name>-rgb) / <alpha>)`. */
function tailwindColorTokens(): string[] {
  const config = readFrontendFile('tailwind.config.js');
  const list = /THEME_COLOR_TOKENS = \[([\s\S]*?)\]/.exec(config);
  if (!list) throw new Error('THEME_COLOR_TOKENS not found in tailwind.config.js');
  return [...list[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

function filesUnder(dir: string, skip: RegExp): string[] {
  return fs.readdirSync(dir).flatMap((name: string) => {
    const full = path.join(dir, name);
    if (skip.test(full)) return [];
    if (fs.statSync(full).isDirectory()) return filesUnder(full, skip);
    return /\.(ts|tsx|css|html|json|js)$/.test(name) ? [full] : [];
  });
}

describe('design tokens', () => {
  it('defines every Tailwind colour token once, as a hex value and as channels', () => {
    const names = tailwindColorTokens();
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      const hex = tokens[`--theme-${name}`];
      expect(hex, `--theme-${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens[`--theme-${name}-rgb`], `--theme-${name}-rgb`).toBe(channels(hex).join(' '));
    }
  });

  it('has no colour channels that Tailwind does not know', () => {
    const names = new Set(tailwindColorTokens());
    const channelTokens = Object.keys(tokens)
      .filter((token) => token.endsWith('-rgb'))
      .map((token) => token.replace(/^--theme-|-rgb$/g, ''));
    expect(channelTokens.filter((name) => !names.has(name))).toEqual([]);
  });

  it('gives the page, its theme-color tag and the manifest the same background', () => {
    const bg = tokens['--theme-bg'];
    expect(indexHtml).toContain(`<meta name="theme-color" content="${bg}" />`);
    const manifest = JSON.parse(readFrontendFile('public/manifest.json'));
    expect(manifest.theme_color).toBe(bg);
    expect(manifest.background_color).toBe(bg);
  });
});

describe('one look', () => {
  it('styles the page from the stylesheet alone', () => {
    const css = readFrontendFile('src/index.css');
    expect(css).not.toContain('data-theme');
    expect(indexHtml).not.toContain('data-theme');
    // No inline script in the page: nothing chooses a look before the app loads
    expect(indexHtml).not.toMatch(/<script>/);
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
  });

  it('never reads a stored app theme or asks for a recoloured manifest', () => {
    const files = [
      ...filesUnder(path.join(frontendDir, 'src'), /[\\/]tests$/),
      ...filesUnder(path.join(frontendDir, 'public'), /^$/),
      path.join(frontendDir, 'index.html'),
    ];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((file) => {
      const source: string = fs.readFileSync(file, 'utf8');
      return source.includes('karaoke_app_theme') || source.includes('manifest.json?bg=');
    });
    expect(offenders.map((file) => path.relative(frontendDir, file))).toEqual([]);
  });
});
