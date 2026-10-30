/**
 * Theme registry parity: the TS theme registry (appThemes.ts) is the source of truth,
 * and index.css, the index.html boot script and the PWA manifest must stay in sync.
 */
import { describe, it, expect } from 'vitest';
import { APP_THEME_LIST, DEFAULT_APP_THEME_ID, getAppTheme } from '../../theme/appThemes';
import { THEMES } from '../../theme/stagePresets';
import { readFrontendFile, readIndexHtml, extractBootScript } from '../helpers/bootScriptUtils';

const normalize = (v: string) => v.replace(/["']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

function parseThemeBlocks(css: string): Record<string, Record<string, string>> {
  const blocks: Record<string, Record<string, string>> = {};
  const re = /\[data-theme='([a-z0-9_]+)'\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const vars: Record<string, string> = {};
    const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(m[2]))) vars[d[1]] = d[2];
    blocks[m[1]] = { ...(blocks[m[1]] || {}), ...vars };
  }
  return blocks;
}

describe('Theme registry parity', () => {
  const css = readFrontendFile('src/index.css');
  const blocks = parseThemeBlocks(css);

  it('index.css defines a block for every registered app theme', () => {
    expect(Object.keys(blocks).sort()).toEqual(APP_THEME_LIST.map((t) => t.id).sort());
  });

  it.each(APP_THEME_LIST.map((t) => [t.id, t] as const))(
    'index.css block for %s matches every css variable in appThemes.ts',
    (id, theme) => {
      const block = blocks[id];
      for (const [name, value] of Object.entries(theme.cssVariables)) {
        expect(block[name], `${id} is missing ${name}`).toBeDefined();
        expect(normalize(block[name]), `${id} ${name} drifted`).toBe(normalize(value));
      }
    }
  );

  it('the default theme block also applies to :root', () => {
    expect(css).toMatch(new RegExp(`:root,\\s*\\[data-theme='${DEFAULT_APP_THEME_ID}'\\]`));
  });

  it('every theme exposes rgb channel variables for each color token', () => {
    for (const theme of APP_THEME_LIST) {
      const channelVars = Object.entries(theme.cssVariables).filter(([k]) => k.endsWith('-rgb'));
      expect(channelVars.length).toBeGreaterThanOrEqual(22);
      for (const [name, value] of channelVars) {
        expect(value, `${theme.id} ${name}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
      expect(theme.cssVariables['--theme-bg-rgb']).toBe(
        [1, 3, 5].map((i) => parseInt(theme.colors.bg.slice(i, i + 2), 16)).join(' ')
      );
    }
  });

  it('index.html boot script lists exactly the registered themes and their backgrounds', () => {
    const script = extractBootScript(readIndexHtml());
    const valid = script.match(/validThemes\s*=\s*\[([^\]]*)\]/);
    expect(valid).not.toBeNull();
    const ids = (valid![1].match(/'([a-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(ids).toEqual(APP_THEME_LIST.map((t) => t.id));
    for (const theme of APP_THEME_LIST) {
      expect(script).toContain(`${theme.id}: '${theme.colors.bg}'`);
    }
    expect(script).toContain(`: '${DEFAULT_APP_THEME_ID}'`);
  });

  it('index.html and manifest default colors match the default theme background', () => {
    const html = readIndexHtml();
    const bg = getAppTheme(DEFAULT_APP_THEME_ID).colors.bg.toLowerCase();
    expect(html.toLowerCase()).toContain(`<meta name="theme-color" content="${bg}" />`);
    expect(html).toContain(`data-theme="${DEFAULT_APP_THEME_ID}"`);
    const manifest = JSON.parse(readFrontendFile('public/manifest.json'));
    expect(manifest.theme_color.toLowerCase()).toBe(bg);
    expect(manifest.background_color.toLowerCase()).toBe(bg);
  });

  it('every app theme maps to an existing stage preset', () => {
    for (const theme of APP_THEME_LIST) {
      expect(
        THEMES.some((p) => p.id === theme.stagePresetId),
        theme.id
      ).toBe(true);
    }
  });

  it('every stage preset defines a solid stage background and tone', () => {
    for (const preset of THEMES) {
      expect(preset.stageBg, preset.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['dark', 'light']).toContain(preset.tone);
    }
  });
});
