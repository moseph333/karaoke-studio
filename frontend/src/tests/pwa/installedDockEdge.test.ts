/**
 * In the installed app on a phone, Android paints the strip under the gesture pill in the
 * manifest's colour, which is the page background. The transport dock sits right above that
 * strip and fades into the same colour, so the two read as one surface.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile } from '../helpers/frontendFiles';

describe('the phone dock meets the strip under the gesture pill', () => {
  const css = readFrontendFile('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('fades into the page background in the installed app on phones only', () => {
    const rule =
      /@media \(display-mode: standalone\) and \(max-width: 767\.98px\)\s*\{\s*\.ks-dock-edge\s*\{([^}]*)\}/.exec(
        css
      );
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/rgb\(var\(--theme-bg-rgb\)\)\s*100%/);
  });

  it('is the class the transport dock carries', () => {
    expect(readFrontendFile('src/components/transport/TransportDock.tsx')).toContain(
      'ks-dock-edge'
    );
  });
});
