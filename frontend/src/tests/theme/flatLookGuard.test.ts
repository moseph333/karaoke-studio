/**
 * Keeps the look flat. The app's own chrome has no gradient, glow, blur, shadow, rounded
 * corner or tinted fill, and no sparkle icon standing for "AI". The stage is the exception:
 * it is the video, and its components may blur and shadow what they draw.
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

/** Names the look dropped. Nothing may use them, the stage included. */
const REMOVED: Record<string, RegExp> = {
  token: /(?<![\w-])(?:[a-z-]+:)*[a-z-]*-theme-(?:secondary|highlight|info)(?![\w-])/g,
  cssVariable:
    /--theme-(?:secondary|highlight|info)(?:-rgb)?\b|--theme-(?:gradient-accent|gradient-stage|glass-alpha|shadow-glow)\b/g,
  utility:
    /(?<![\w-])(?:bg-gradient-(?:accent|stage)|shadow-theme-[a-z]+|rounded(?:-[trbl])?-theme-[a-z]+|ks-(?:glass|text-gradient|aurora|stage-backdrop)|animate-aurora-drift)(?![\w-])/g,
  gradientVariant: /\b(?:variant|tone)\s*[=:]\s*\{?["']gradient["']/g,
};

/** Effects the app's chrome does without. The stage may use them. */
const EFFECTS: Record<string, RegExp> = {
  gradient:
    /(?<![\w-])(?:[a-z-]+:)*bg-(?:gradient-to-[a-z]{1,2}|\[(?:linear|radial|conic)-gradient[^\]]*\])/g,
  blur: /(?<![\w-])(?:[a-z-]+:)*(?:backdrop-blur(?:-[a-z0-9]+|-\[[^\]]+\])?|blur-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\]))(?![\w-])/g,
  // An inset one-pixel line (shadow-[inset_0_-1px_0_…]) is a hairline, not a shadow
  shadow:
    /(?<![\w-])(?:[a-z-]+:)*(?:shadow-(?:sm|md|lg|xl|2xl|inner)|shadow-\[(?!inset_0_-1px_0_)[^\]]*\]|drop-shadow(?:-[a-z0-9]+|-\[[^\]]+\])?|\[text-shadow:[^\]]*\])(?![\w-])/g,
  radius:
    /(?<![\w-])(?:[a-z-]+:)*rounded(?:-(?:[trblse]|tl|tr|bl|br))?(?:-(?:sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?(?![\w-])/g,
  tintedFill:
    /(?<![\w-])(?:[a-z-]+:)*bg-theme-(?:accent|success|warning|danger|sung)\/(?:\d+|\[[\d.]+\])(?![\w-])/g,
};

const SPARKLE_ICON = /^(?:Lucide)?(?:Sparkles?|Stars|Wand|Wand2|WandSparkles)(?:Icon)?$/;

/** The stage and what is drawn on top of the video. */
const isStage = (file: string): boolean =>
  file.startsWith('components/stage/') ||
  file === 'components/LyricDisplay.tsx' ||
  file === 'components/ChordBar.tsx';

/** Effects kept on purpose outside the stage folder. */
const ALLOWED_EFFECTS: Record<string, string[]> = {
  // The `overlay` icon button is only used on top of the stage video
  'components/ui/variants.ts': ['backdrop-blur-md'],
  // A spinner is the one round thing
  'components/track-search/LocalAudioUploader.tsx': ['rounded-full'],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name: string) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function findings(file: string, source: string): string[] {
  const found: string[] = [];
  for (const [kind, pattern] of Object.entries(REMOVED)) {
    for (const match of source.match(pattern) ?? []) found.push(`${kind}: ${match}`);
  }
  if (!isStage(file)) {
    const allowed = ALLOWED_EFFECTS[file] ?? [];
    for (const [kind, pattern] of Object.entries(EFFECTS)) {
      for (const match of source.match(pattern) ?? []) {
        if (!allowed.includes(match)) found.push(`${kind}: ${match}`);
      }
    }
  }
  for (const statement of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const specifier of statement[1].split(',')) {
      const name = specifier.trim().split(/\s+as\s+/)[0];
      if (SPARKLE_ICON.test(name)) found.push(`sparkle icon: ${name}`);
    }
  }
  return found;
}

const scanned: Record<string, string[]> = {};
for (const full of [
  ...sourceFiles(path.join(srcRoot, 'components')),
  ...sourceFiles(path.join(srcRoot, 'hooks')),
  path.join(srcRoot, 'App.tsx'),
]) {
  const file = path.relative(srcRoot, full).split(path.sep).join('/');
  scanned[file] = findings(file, fs.readFileSync(full, 'utf8'));
}

describe('flat look guard', () => {
  it('scans the components, the hooks and the app shell', () => {
    expect(Object.keys(scanned).length).toBeGreaterThan(120);
  });

  it('finds no gradient, glow, blur, shadow, radius, tint or sparkle', () => {
    const offenders = Object.entries(scanned)
      .filter(([, found]) => found.length > 0)
      .map(([file, found]) => `${file}: ${[...new Set(found)].join(', ')}`);
    expect(offenders).toEqual([]);
  });
});
