/**
 * Typefaces are served by the app itself (src/fonts.css, generated from the @fontsource
 * packages) and the page paints a boot shell before its script runs. Guards that every web
 * font the app or a stage preset names is declared, that nothing is fetched from another site,
 * and that the shell is in place.
 */
import { describe, it, expect } from 'vitest';
import { THEMES } from '../../theme/stagePresets';
import { readRootTokens } from '../helpers/cssTokens';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const frontendDir: string = fs.existsSync(path.resolve(cwd, 'src/fonts.css'))
  ? cwd
  : path.resolve(cwd, 'frontend');
const read = (rel: string): string => fs.readFileSync(path.join(frontendDir, rel), 'utf8');

const fontsCss = read('src/fonts.css');
const indexHtml = read('index.html');

/** Faces every device has (or that only act as fallbacks): never downloaded. */
const SYSTEM_FACES = new Set([
  'Impact',
  'Arial Black',
  'Arial Narrow',
  'Trebuchet MS',
  'Courier New',
  'Courier',
  'Georgia',
  'Times New Roman',
  'Helvetica Neue',
  'Arial',
  'Segoe UI',
  'SF Pro Text',
  'Roboto',
  'SFMono-Regular',
]);

const families = (stack: string): string[] =>
  stack
    .split(',')
    .map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
    .filter(
      (name) =>
        name && !/^(sans-serif|serif|monospace|system-ui|ui-monospace|-apple-system)$/.test(name)
    );

// The app's own font stacks are the font tokens in the stylesheet
const namedFaces = new Set<string>();
for (const [token, stack] of Object.entries(readRootTokens())) {
  if (/^--(theme-font-|karaoke-font-family$)/.test(token)) {
    families(stack).forEach((f) => namedFaces.add(f));
  }
}
for (const preset of THEMES) families(preset.fontFamily ?? '').forEach((f) => namedFaces.add(f));
const webFaces = [...namedFaces].filter((face) => !SYSTEM_FACES.has(face)).sort();

const declaredFaces = [
  ...new Set([...fontsCss.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1])),
].sort();

describe('self-hosted fonts', () => {
  it('declares exactly the web fonts the app and the stage presets name', () => {
    expect(webFaces).toEqual([
      'Inter',
      'JetBrains Mono',
      'Montserrat',
      'Sofia Sans',
      'Sofia Sans Extra Condensed',
      'Sora',
      'Space Grotesk',
      'VT323',
    ]);
    expect(declaredFaces).toEqual(webFaces);
  });

  it('points every face at a woff2 file that is installed, and swaps it in when loaded', () => {
    const urls = [...fontsCss.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(20);
    for (const url of urls) {
      expect(url).toMatch(/^\.\.\/node_modules\/@fontsource(-variable)?\/.+\.woff2$/);
      expect(fs.existsSync(path.join(frontendDir, 'src', url)), url).toBe(true);
    }
    const blocks = fontsCss.split('@font-face').slice(1);
    for (const block of blocks) expect(block).toContain('font-display: swap');
  });

  it('is loaded by the entry point before the stylesheet', () => {
    const main = read('src/main.tsx');
    expect(main.indexOf("import './fonts.css'")).toBeGreaterThan(-1);
    expect(main.indexOf("import './fonts.css'")).toBeLessThan(main.indexOf("import './index.css'"));
  });

  it('fetches nothing from another site while the page loads', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const resources = [...head.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(resources.length).toBeGreaterThan(0);
    for (const url of resources) expect(url).toMatch(/^\//);
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});

describe('boot shell', () => {
  const root = indexHtml.slice(
    indexHtml.indexOf('<div id="root">'),
    indexHtml.indexOf('<noscript>')
  );

  it('paints the brand and a page outline from the HTML alone, hidden from assistive tech', () => {
    expect(root).toContain('aria-hidden="true"');
    expect(root).toContain('Karaoke Studio');
    expect(root).toContain('boot-block');
    // No script inside: React replaces the shell when it mounts
    expect(root).not.toContain('<script');
  });

  it('sets the brand in the heading face, which starts that font downloading early', () => {
    const bar = indexHtml.slice(
      indexHtml.indexOf('.boot-bar {'),
      indexHtml.indexOf('.boot-mark {')
    );
    expect(bar).toContain('var(--theme-font-heading');
  });

  it('stands still for viewers who ask for reduced motion', () => {
    expect(indexHtml).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.boot-block\s*\{\s*animation: none/
    );
  });
});
