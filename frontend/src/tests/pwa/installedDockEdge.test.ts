/**
 * In the installed app on a phone, Android paints the strip under the gesture pill in the
 * manifest's colour. The transport dock sits right above that strip, so it is the same solid
 * colour, the page background, and the two read as one surface. Nothing fades between them.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile } from '../helpers/frontendFiles';
import { readRootTokens } from '../helpers/cssTokens';

describe('the phone dock meets the strip under the gesture pill', () => {
  const dock = readFrontendFile('src/components/transport/TransportDock.tsx');
  const css = readFrontendFile('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('is a solid band in the page background, with nothing see-through', () => {
    const root = /'(fixed inset-x-0 bottom-0[^']*)'/.exec(dock);
    expect(root).not.toBeNull();
    const classes = root![1].split(/\s+/);
    expect(classes).toContain('bg-theme-bg');
    expect(classes.filter((c) => /^bg-/.test(c))).toEqual(['bg-theme-bg']);
  });

  it('is the colour the manifest gives Android for that strip', () => {
    const manifest = JSON.parse(readFrontendFile('public/manifest.json'));
    expect(manifest.theme_color.toLowerCase()).toBe(readRootTokens()['--theme-bg'].toLowerCase());
  });

  it('needs no fade, so the stylesheet has no gradient for it', () => {
    expect(css).not.toContain('ks-dock-edge');
    expect(dock).not.toContain('ks-dock-edge');
  });
});
