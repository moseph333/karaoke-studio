import { describe, it, expect } from 'vitest';

// Read like designTokenGuard: the test tsconfig has no Node types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const srcRoot: string = fs.existsSync(path.resolve(cwd, 'src/index.css'))
  ? path.resolve(cwd, 'src')
  : path.resolve(cwd, 'frontend/src');

// Windows contrast themes replace background colours with the system palette; states shown
// only by a tint would vanish. Guard the rules that keep them visible.
const css: string = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf8');
const block = css.slice(css.indexOf('@media (forced-colors: active)'));

describe('forced colors layer', () => {
  it('exists', () => {
    expect(css).toContain('@media (forced-colors: active)');
  });

  it.each([
    ["[role='tab'][aria-selected='true']", 'Highlight'],
    ["[role='option'][aria-selected='true']", 'Highlight'],
    ["[aria-pressed='true']:not([data-swatch])", 'Highlight'],
    ["[role='switch'][aria-checked='true']", 'Highlight'],
    ["[role='progressbar'] > div", 'Highlight'],
    ["[data-testid='waveform-bar'][data-played='true']", 'Highlight'],
    ["[data-testid='waveform-playhead']", 'CanvasText'],
    ['[data-dot]', 'CanvasText'],
  ])('marks %s with %s', (selector, color) => {
    const at = block.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    const rule = block.slice(at, block.indexOf('}', at));
    expect(rule).toContain(color);
  });

  it('lets the stage preview and theme swatches keep their real colours', () => {
    const at = block.indexOf('[data-swatch] {');
    expect(at).toBeGreaterThan(-1);
    expect(block.slice(block.lastIndexOf('[data-testid', at), block.indexOf('}', at))).toContain(
      'forced-color-adjust: none'
    );
  });
});
