/**
 * The manifest follows the app theme. An installed app's splash screen and the strip under
 * Android's gesture pill are painted from the manifest's colours, so every theme but the
 * default links `/manifest.json?bg=<its background>`: from the boot script on launch and
 * from the theme engine on a switch. The phone dock fades into that colour.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  APP_THEME_LIST,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_ID,
  MANIFEST_URL,
  applyThemeToDom,
  getAppTheme,
  manifestHrefForThemeColor,
} from '../../theme/appThemes';
import {
  readFrontendFile,
  readIndexHtml,
  runIndexHtmlBootScript,
} from '../helpers/bootScriptUtils';

function addHeadTags() {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.setAttribute('href', MANIFEST_URL);
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.append(link, meta);
  return link;
}

const expectedHref = (themeId: string) => {
  const bg = getAppTheme(themeId).colors.bg.toLowerCase();
  return themeId === DEFAULT_APP_THEME_ID ? MANIFEST_URL : `${MANIFEST_URL}?bg=${bg.slice(1)}`;
};

describe('the manifest link follows the app theme', () => {
  let link: HTMLLinkElement;

  beforeEach(() => {
    link = addHeadTags();
  });
  afterEach(() => {
    document.head
      .querySelectorAll('link[rel="manifest"], meta[name="theme-color"]')
      .forEach((el) => {
        el.remove();
      });
  });

  it('keeps the built manifest for the default theme', () => {
    expect(manifestHrefForThemeColor(getAppTheme(DEFAULT_APP_THEME_ID).colors.bg)).toBe(
      MANIFEST_URL
    );
  });

  it('asks for a six-digit lowercase colour and ignores anything else', () => {
    expect(manifestHrefForThemeColor('#F4F4F0')).toBe('/manifest.json?bg=f4f4f0');
    expect(manifestHrefForThemeColor('rgb(1 2 3)')).toBe(MANIFEST_URL);
    expect(manifestHrefForThemeColor('#fff')).toBe(MANIFEST_URL);
  });

  it.each(APP_THEME_LIST.map((theme) => theme.id))('theme engine: %s', (themeId) => {
    applyThemeToDom(getAppTheme(themeId));
    expect(link.getAttribute('href')).toBe(expectedHref(themeId));
  });

  it('returns to the built manifest when the default theme is chosen again', () => {
    applyThemeToDom(getAppTheme('clean_paper'));
    applyThemeToDom(getAppTheme(DEFAULT_APP_THEME_ID));
    expect(link.getAttribute('href')).toBe(MANIFEST_URL);
  });

  it.each(APP_THEME_LIST.map((theme) => theme.id))('boot script: %s', (themeId) => {
    localStorage.setItem(APP_THEME_STORAGE_KEY, themeId);
    runIndexHtmlBootScript();
    expect(link.getAttribute('href')).toBe(expectedHref(themeId));
  });

  it('puts the manifest link above the boot script, which has to find it', () => {
    const html = readIndexHtml();
    expect(html.indexOf('<link rel="manifest"')).toBeGreaterThan(-1);
    expect(html.indexOf('<link rel="manifest"')).toBeLessThan(html.indexOf('<script>'));
  });
});

describe('the phone dock meets the strip under the gesture pill', () => {
  const css = readFrontendFile('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('fades into the theme background in the installed app on phones only', () => {
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
