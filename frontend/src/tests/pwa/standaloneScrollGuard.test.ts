/**
 * Touch scrolling in the installed app: overscroll-behavior that stops pull-to-refresh goes
 * on html only. body is a scroll container of its own (overflow-x: hidden on html and body)
 * that never scrolls, so `none` or `contain` on it keeps touch scrolls from chaining to the
 * page and nothing moves on a phone.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile } from '../helpers/frontendFiles';

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

describe('drawing under see-through system bars', () => {
  // iOS home-screen apps draw under the status bar and home indicator today, and Chrome on
  // Android does once its edge-to-edge mode for installed apps is on. Whatever touches the
  // top or bottom edge keeps its content inside the safe area.
  it('keeps the page end, the toasts and the boot shell clear of the bars', () => {
    expect(readFrontendFile('src/App.tsx')).toContain(
      'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]'
    );
    expect(readFrontendFile('src/components/Toast.tsx')).toContain(
      'var(--dock-height,env(safe-area-inset-bottom,0px))'
    );
    const bootBar = /\.boot-bar \{([^}]*)\}/.exec(readFrontendFile('index.html'));
    expect(bootBar?.[1]).toContain('padding: env(safe-area-inset-top, 0px) 16px 0');
  });

  it('opts the page in to the full screen', () => {
    expect(readFrontendFile('index.html')).toContain('viewport-fit=cover');
  });
});
