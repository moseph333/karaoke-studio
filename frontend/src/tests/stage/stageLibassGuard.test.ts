/**
 * The stage frame is the video's frame, and the video is drawn by libass: flat fills, an
 * outline, one soft shadow, opacity, and straight moves that are functions of the song time.
 * Anything else drawn inside the frame would show on the stage and be missing from the export,
 * so the frame's files may not use it.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const srcRoot: string = fs.existsSync(path.resolve(cwd, 'src/components'))
  ? path.resolve(cwd, 'src')
  : path.resolve(cwd, 'frontend/src');

const read = (file: string): string => fs.readFileSync(path.join(srcRoot, file), 'utf8');

/** Source without its comments, which may name what the code must not use. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** The frame's rules in index.css: from `.ks-frame-fit` up to the range slider's. */
function frameCss(): string {
  const css = read('index.css');
  const start = css.indexOf('.ks-frame-fit {');
  const end = css.indexOf('.ks-range {');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code(css.slice(start, end));
}

const FRAME_FILES = ['components/stage/StageFrame.tsx', 'components/stage/LookSample.tsx'];

/** What libass cannot draw, or cannot draw the same way at every moment. */
const NOT_IN_THE_VIDEO: Record<string, RegExp> = {
  gradient: /gradient\(|\bbg-gradient-/i,
  'backdrop blur': /backdrop-?filter|\bbackdrop-blur/i,
  'blend mode': /mix-?blend|background-?blend/i,
  'CSS transition': /\btransition(?:Property|Duration|TimingFunction|Delay)?\s*:|\btransition-/,
  'CSS animation': /\banimation(?:Name|Duration)?\s*:|@keyframes|\banimate-/,
  easing: /cubic-bezier|\bease(?:-in|-out|-in-out)?\b/,
  // A ring with no offset and no blur (`0 0 0 <width>`) is a shape's outline, which libass draws
  'box or text shadow':
    /box-?shadow(?!:\s*(?:outline \? )?[`'"]0 0 0 )|text-?shadow|\bshadow-(?:sm|md|lg|xl|2xl|\[)/i,
  blur: /\bblur\(|\bblur-(?:sm|md|lg|xl|2xl|3xl|\[)/,
  'synthesised bold or italic': /font-?synthesis\s*:\s*(?!\s|none)/i,
};

describe('the stage frame draws only what the video can', () => {
  for (const file of FRAME_FILES) {
    for (const [name, pattern] of Object.entries(NOT_IN_THE_VIDEO)) {
      it(`${file} has no ${name}`, () => {
        expect(code(read(file)).match(pattern)).toBeNull();
      });
    }

    it(`${file} draws at most one soft shadow`, () => {
      expect((code(read(file)).match(/drop-shadow\(/g) ?? []).length).toBeLessThanOrEqual(1);
    });
  }

  for (const [name, pattern] of Object.entries(NOT_IN_THE_VIDEO)) {
    it(`the frame's styles have no ${name}`, () => {
      expect(frameCss().match(pattern)).toBeNull();
    });
  }

  it('the frame never lets the browser fake a weight or an italic the video would not have', () => {
    expect(frameCss()).toMatch(/\.ks-canvas\s*\{[^}]*font-synthesis:\s*none/);
  });

  it('text in the frame never wraps by itself: rows are broken by the shared rule', () => {
    expect(frameCss()).toMatch(/\.ks-row\s*\{[^}]*white-space:\s*pre;/);
  });

  it('a word is lit by its share sung, not by a share of that share', () => {
    // The sung copy is cut by its clip-path. If its box were narrowed to the same share as
    // well, half a word sung would light a quarter of it, and the stage would trail the video.
    const sung = frameCss().match(/\.ks-word-sung\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(sung).toMatch(/min-width:\s*100%/);
    expect(sung).not.toMatch(/overflow:\s*hidden/);
  });

  it('the guard notices each effect when it is there', () => {
    const samples: Record<string, string> = {
      gradient: 'background: linear-gradient(red, blue)',
      'backdrop blur': 'backdrop-filter: blur(4px)',
      'blend mode': 'mix-blend-mode: screen',
      'CSS transition': 'transition: opacity 0.2s',
      'CSS animation': 'animation: rise 1s',
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      'box or text shadow': 'text-shadow: 0 0 4px #000',
      blur: 'filter: blur(2px)',
      'synthesised bold or italic': 'font-synthesis: weight',
    };
    for (const [name, pattern] of Object.entries(NOT_IN_THE_VIDEO)) {
      expect(samples[name], name).toMatch(pattern);
    }
    expect(code('a /* transition: none */ b // ease-in\nc')).toBe('a  b \nc');
    expect('boxShadow: outline ? `0 0 0 ${w} ${c}` : undefined').not.toMatch(
      NOT_IN_THE_VIDEO['box or text shadow']
    );
    expect('boxShadow: `0 2px 8px #000`').toMatch(NOT_IN_THE_VIDEO['box or text shadow']);
    expect('font-synthesis: none').not.toMatch(NOT_IN_THE_VIDEO['synthesised bold or italic']);
  });
});
