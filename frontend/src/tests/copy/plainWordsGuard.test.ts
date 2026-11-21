/**
 * Keeps the app's wording plain. Nothing it shows calls a feature "AI" or "Smart", praises
 * itself ("high-fidelity", "intelligent"), or narrates its own machinery ("Engine Active",
 * "Pulse 3s ago", "Synthesizing"). Controls are named for what they do.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cwd: string = (globalThis as any).process.cwd();
const frontendRoot: string = fs.existsSync(path.resolve(cwd, 'src/components'))
  ? cwd
  : path.resolve(cwd, 'frontend');

const BANNED: Record<string, RegExp> = {
  AI: /\bAI\b/g,
  Smart: /\bSmart\b/g,
  'high-fidelity': /\bhigh-fidelity\b/gi,
  intelligent: /\bintelligent(?:ly)?\b/gi,
  synthesizing: /\bsynthesi[sz](?:e|es|ed|ing)\b/gi,
  'engine status': /\bEngine (?:Active|slow)\b|\bEncoder Active\b|\bPulse\b/g,
};

/** Comments are for people reading the code, and may name what was removed. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

interface DirEntry {
  name: string;
  isDirectory(): boolean;
}

function sourceFiles(dir: string): string[] {
  const entries: DirEntry[] = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const shownFiles: string[] = [
  ...sourceFiles(path.join(frontendRoot, 'src')),
  path.join(frontendRoot, 'index.html'),
  path.join(frontendRoot, 'public/manifest.json'),
  path.join(frontendRoot, 'public/offline.html'),
];

describe('plain words', () => {
  it('reads the app, its page shell, its manifest and its offline page', () => {
    expect(shownFiles.length).toBeGreaterThan(150);
    for (const file of shownFiles.slice(-3)) expect(fs.existsSync(file), file).toBe(true);
  });

  it.each(Object.entries(BANNED))('never says %s', (_name, pattern) => {
    const found: string[] = [];
    for (const file of shownFiles) {
      const text = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        found.push(`${path.relative(frontendRoot, file)}:${line} ${match[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('would catch the wording it bans', () => {
    const sample =
      'AI Vocal Separation · Smart Recommender · Intelligent Pause Clustering · Engine Active • Pulse 3s ago · Synthesizing high-fidelity audio';
    for (const [name, pattern] of Object.entries(BANNED)) {
      expect(sample.match(pattern), name).not.toBeNull();
    }
    // Words that only contain a banned one are fine
    for (const pattern of Object.values(BANNED)) {
      expect('Smartphone beatPulse animate-pulse MAIL said'.match(pattern)).toBeNull();
    }
  });
});
