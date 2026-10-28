/**
 * Executes the real zero-FOUC boot script shipped in index.html.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APP_THEME_LIST, APP_THEME_STORAGE_KEY } from '../theme/appThemes';
import { runIndexHtmlBootScript } from './bootScriptUtils';

describe('index.html zero-FOUC boot script', () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#000000');
    document.head.appendChild(meta);
  });

  afterEach(() => {
    meta.remove();
    vi.restoreAllMocks();
  });

  it('boots the flagship afterglow theme on a clean profile', () => {
    runIndexHtmlBootScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    expect(meta.getAttribute('content')).toBe('#0b0b12');
  });

  it.each(APP_THEME_LIST.map((t) => [t.id, t.colors.bg] as const))(
    'restores saved theme %s and its theme-color',
    (id, bg) => {
      localStorage.setItem(APP_THEME_STORAGE_KEY, id);
      runIndexHtmlBootScript();
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
      expect(meta.getAttribute('content')).toBe(bg);
    }
  );

  it('falls back to afterglow for unknown or prototype values', () => {
    for (const v of ['neon_glitch', 'toString', '__proto__', '', 'null']) {
      localStorage.setItem(APP_THEME_STORAGE_KEY, v);
      runIndexHtmlBootScript();
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    }
  });

  it('falls back to afterglow when storage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => runIndexHtmlBootScript()).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
  });
});
