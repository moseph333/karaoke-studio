/**
 * Typefaces are served by the app itself, in three stylesheets generated from the @fontsource
 * packages: src/fonts.css (the app's own faces, loaded with the first screen),
 * src/stageFonts.css (the stage looks' other faces, loaded with the stage) and
 * src/stageFonts.ktv.css (the Japanese slices of KTV's face, loaded when that look is on).
 * The page paints a boot shell before its script runs. Guards that every web font the app or
 * a stage look names is declared in the weight and style it is drawn in, that nothing is
 * fetched from another site, and that the shell is in place.
 */
import { describe, it, expect } from 'vitest';
import { STAGE_LOOKS } from '../../theme/stageLooks';
import { STAGE_FACE_IDS, faceMetrics } from '../../theme/stageFontMetrics';
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

const APP_SHEET = 'src/fonts.css';
const STAGE_SHEET = 'src/stageFonts.css';
const KTV_SHEET = 'src/stageFonts.ktv.css';
const SHEETS = [APP_SHEET, STAGE_SHEET, KTV_SHEET];

const indexHtml = read('index.html');

interface FontFaceRule {
  sheet: string;
  family: string;
  style: string;
  /** The weights the file draws: one weight, or a variable font's range. */
  weights: [number, number];
  url: string;
  unicodeRange: string;
  swaps: boolean;
}

/** Every @font-face rule of a stylesheet. */
function fontFaceRules(sheet: string): FontFaceRule[] {
  return [...read(sheet).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const value = (name: string) =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].replace(/\s+/g, ' ').trim() ?? '';
    const weights = value('font-weight').split(' ').map(Number);
    return {
      sheet,
      family: value('font-family').replace(/^['"]|['"]$/g, ''),
      style: value('font-style'),
      weights: [weights[0], weights[weights.length - 1]],
      url: /url\(([^)]+)\)/.exec(body)?.[1] ?? '',
      unicodeRange: value('unicode-range'),
      swaps: value('font-display') === 'swap',
    };
  });
}

const rules = SHEETS.flatMap(fontFaceRules);
const familiesIn = (sheet: string): string[] =>
  [...new Set(rules.filter((rule) => rule.sheet === sheet).map((rule) => rule.family))].sort();

/** Faces every device has (or that only act as fallbacks): never downloaded. */
const SYSTEM_FACES = new Set([
  'Arial Narrow',
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
const appFaces = [
  ...new Set(
    Object.entries(readRootTokens())
      .filter(([token]) => /^--theme-font-/.test(token))
      .flatMap(([, stack]) => families(stack))
      .filter((face) => !SYSTEM_FACES.has(face))
  ),
].sort();

/** The ids of the faces a look draws with (see stage_font_metrics.json). */
function lookFaceIds(look: (typeof STAGE_LOOKS)[number]): string[] {
  const ids = Object.values(look.frames).flatMap((frame) => [
    frame.lyric.face,
    frame.next?.face,
    frame.label.face,
    frame.cue.face,
    frame.title.face,
    frame.artist.face,
  ]);
  return [
    ...new Set(
      [...ids, look.adlib.face, look.romaji.face].filter((id): id is string => Boolean(id))
    ),
  ];
}

const lookFaces = [
  ...new Set(STAGE_LOOKS.flatMap(lookFaceIds).map((id) => faceMetrics(id).css_family)),
].sort();

describe('self-hosted fonts', () => {
  it('declares exactly the web fonts the app and the stage looks name', () => {
    expect(appFaces).toEqual(['JetBrains Mono', 'Sofia Sans', 'Sofia Sans Extra Condensed']);
    expect(lookFaces).toEqual([
      'Atkinson Hyperlegible',
      'Jost',
      'M PLUS Rounded 1c',
      'Newsreader',
      'Sofia Sans',
      'Sofia Sans Extra Condensed',
    ]);
    const declared = [...new Set(rules.map((rule) => rule.family))].sort();
    expect(declared).toEqual([...new Set([...appFaces, ...lookFaces])].sort());
  });

  it.each(STAGE_FACE_IDS.map((id) => [id]))(
    'has a real @font-face for %s in the weight and style it is drawn in',
    (id) => {
      const face = faceMetrics(id);
      const matching = rules.filter(
        (rule) =>
          rule.family === face.css_family &&
          rule.style === face.css_style &&
          rule.weights[0] <= face.css_weight &&
          face.css_weight <= rule.weights[1]
      );
      // Without one the browser fakes the bold or the slant, and the widths the stage
      // measured for the real cut no longer fit
      expect(
        matching.length,
        `${face.css_family} ${face.css_weight} ${face.css_style}`
      ).toBeGreaterThan(0);
      // ...and one of them covers plain Latin text
      expect(matching.some((rule) => /U\+0000-00FF/i.test(rule.unicodeRange))).toBe(true);
    }
  );

  it('keeps the first screen to the faces of the app, and the stage faces with the stage', () => {
    expect(familiesIn(APP_SHEET)).toEqual(appFaces);
    expect(familiesIn(STAGE_SHEET)).toEqual(lookFaces.filter((face) => !appFaces.includes(face)));
    // The numbered Japanese slices of KTV's face (over a hundred rules) are a sheet of their
    // own, and nothing else is in it
    const ktvFamily = faceMetrics(
      STAGE_LOOKS.find((look) => look.id === 'ktv')!.frames['16:9'].lyric.face
    ).css_family;
    expect(familiesIn(KTV_SHEET)).toEqual([ktvFamily]);
    const slice = /\/\* \S*\[\d+\]\S* \*\//g;
    expect(read(APP_SHEET)).not.toMatch(slice);
    expect(read(STAGE_SHEET)).not.toMatch(slice);
    expect(read(KTV_SHEET).match(slice)?.length).toBe(
      rules.filter((rule) => rule.sheet === KTV_SHEET).length
    );
  });

  it('points every face at a woff2 file that is installed, and swaps it in when loaded', () => {
    for (const sheet of SHEETS) {
      expect(
        rules.some((rule) => rule.sheet === sheet),
        sheet
      ).toBe(true);
    }
    for (const rule of rules) {
      expect(rule.url, rule.sheet).toMatch(
        /^\.\.\/node_modules\/@fontsource(-variable)?\/.+\.woff2$/
      );
      expect(fs.existsSync(path.join(frontendDir, 'src', rule.url)), rule.url).toBe(true);
      expect(rule.swaps, rule.url).toBe(true);
    }
    // No rule was missed by the parsing above, and none names a second file
    for (const sheet of SHEETS) {
      const css = read(sheet);
      expect(css.split('@font-face').length - 1, sheet).toBe(
        rules.filter((rule) => rule.sheet === sheet).length
      );
      expect(css.match(/url\(/g)?.length, sheet).toBe(
        rules.filter((rule) => rule.sheet === sheet).length
      );
    }
  });

  it('is loaded by the entry point before the stylesheet, and the stage faces by the stage', () => {
    const main = read('src/main.tsx');
    expect(main.indexOf("import './fonts.css'")).toBeGreaterThan(-1);
    expect(main.indexOf("import './fonts.css'")).toBeLessThan(main.indexOf("import './index.css'"));
    expect(main).not.toContain('stageFonts');

    expect(read('src/components/stage/StageFrame.tsx')).toContain("import '../../stageFonts.css';");
    // On demand: a static import would put the slices in every stage's stylesheet
    const stage = read('src/components/LyricDisplay.tsx');
    expect(stage).toContain("import('../stageFonts.ktv.css')");
    expect(stage).not.toMatch(/^import\s+['"][^'"]*stageFonts\.ktv\.css['"]/m);
  });

  it('fetches nothing from another site while the page loads', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const resources = [...head.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(resources.length).toBeGreaterThan(0);
    for (const url of resources) expect(url).toMatch(/^\//);
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    for (const sheet of SHEETS) expect(read(sheet), sheet).not.toMatch(/https?:|@import/);
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

  it('sets the wordmark in the display face, which starts that font downloading early', () => {
    const bar = indexHtml.slice(
      indexHtml.indexOf('.boot-bar {'),
      indexHtml.indexOf('.boot-page {')
    );
    expect(bar).toContain('var(--theme-font-display');
  });

  it('stands still for viewers who ask for reduced motion', () => {
    expect(indexHtml).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.boot-block\s*\{\s*animation: none/
    );
  });
});
