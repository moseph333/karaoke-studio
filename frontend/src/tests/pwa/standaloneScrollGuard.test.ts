/**
 * Touch scrolling in the installed app: overscroll-behavior that stops pull-to-refresh goes
 * on html only. body is a scroll container of its own (overflow-x: hidden on html and body)
 * that never scrolls, so `none` or `contain` on it keeps touch scrolls from chaining to the
 * page and nothing moves on a phone.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile } from '../helpers/bootScriptUtils';

const css = readFrontendFile('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Selector lists of every rule that declares overscroll-behavior(-y) none or contain. */
function blockingOverscrollSelectors(source: string): string[] {
  const selectors: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(source))) {
    if (/overscroll-behavior(?:-y)?\s*:\s*(?:none|contain)/.test(match[2])) {
      selectors.push(match[1].trim());
    }
  }
  return selectors;
}

const targetsBody = (selectorList: string) =>
  selectorList.split(',').some((selector) => /(^|[\s>+~])body\b/.test(selector.trim()));

describe('installed-app scrolling', () => {
  it('stops pull-to-refresh on html in standalone mode', () => {
    const standalone = css.slice(css.indexOf('@media (display-mode: standalone)'));
    expect(standalone).toMatch(/html\s*\{[^}]*overscroll-behavior-y\s*:\s*none/);
  });

  it('never blocks overscroll on body, which would stop touch scrolling', () => {
    const offending = blockingOverscrollSelectors(css).filter(targetsBody);
    expect(offending).toEqual([]);
  });

  it('recognises the selector shape that broke scrolling', () => {
    const broken = 'html,\n    body {\n      overscroll-behavior-y: none;\n    }';
    expect(blockingOverscrollSelectors(broken).filter(targetsBody)).toHaveLength(1);
  });
});
