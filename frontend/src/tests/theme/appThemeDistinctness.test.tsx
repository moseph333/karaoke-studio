/**
 * Empirical Verification & Adversarial Challenge Suite (Challenger M1 Iteration 2)
 *
 * Verifies:
 * 1. Prototype traversal vulnerability resolution:
 *    - isAppThemeId('toString') === false, valueOf, constructor, __proto__, etc.
 *    - getAppTheme('toString') returns default 'afterglow'
 *    - localStorage pre-seeded with 'toString' boots safely without uncaught TypeError
 *    - multi-tab storage event with 'toString'
 *    - setTheme('toString') behavior
 * 2. Complete Object.prototype reflection & traversal immunity (all Object.prototype keys)
 * 3. 4-dimensional distinctness criteria across all 4 themes (Colors, Typography, Geometry, Shadows)
 * 4. Punk Rock / Underground / DIY Rubric compliance
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AppThemeProvider, useAppTheme, getStoredAppTheme } from '../../context/AppThemeContext';
import {
  APP_THEMES,
  APP_THEME_LIST,
  isAppThemeId,
  getAppTheme,
  applyThemeToDom,
  APP_THEME_STORAGE_KEY,
} from '../../theme/appThemes';
import { AppTheme, AppThemeId } from '../../types';
import { ALL_APP_THEME_IDS } from '../helpers/themeFixtures';
import { runIndexHtmlBootScript } from '../helpers/bootScriptUtils';

describe('Challenger M1 Iteration 2 Verification Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Part 1: Prototype Traversal Vulnerability Verification
  // =========================================================================
  describe('Part 1: Prototype Traversal Vulnerability Resolution', () => {
    const requiredProtoKeys = ['toString', 'valueOf', 'constructor', '__proto__'];
    const fullObjectProtoKeys = Object.getOwnPropertyNames(Object.prototype);

    it('rejects required prototype properties in isAppThemeId: toString, valueOf, constructor, __proto__', () => {
      for (const key of requiredProtoKeys) {
        expect(isAppThemeId(key), `isAppThemeId('${key}') must be false`).toBe(false);
      }
    });

    it('rejects all Object.prototype property names in isAppThemeId', () => {
      for (const key of fullObjectProtoKeys) {
        expect(isAppThemeId(key), `isAppThemeId('${key}') on Object.prototype must be false`).toBe(
          false
        );
      }
    });

    it('returns default afterglow theme when getAppTheme is called with prototype properties', () => {
      for (const key of requiredProtoKeys) {
        const theme = getAppTheme(key);
        expect(theme).toBeDefined();
        expect(theme.id).toBe('afterglow');
        expect(theme.colors).toBeDefined();
        expect(theme.cssVariables).toBeDefined();
        expect(typeof theme.colors.bg).toBe('string');
      }
    });

    it('returns default afterglow theme when getAppTheme is called with any Object.prototype property', () => {
      for (const key of fullObjectProtoKeys) {
        const theme = getAppTheme(key);
        expect(theme).toBeDefined();
        expect(theme.id).toBe('afterglow');
      }
    });

    it('getStoredAppTheme returns afterglow when localStorage is pre-seeded with toString', () => {
      localStorage.setItem(APP_THEME_STORAGE_KEY, 'toString');
      expect(getStoredAppTheme()).toBe('afterglow');
    });

    it('boots <AppThemeProvider> safely without uncaught TypeError when localStorage contains toString', () => {
      localStorage.setItem(APP_THEME_STORAGE_KEY, 'toString');

      const Consumer = () => {
        const { currentThemeId, theme } = useAppTheme();
        return (
          <div>
            <span data-testid="current-theme">{currentThemeId}</span>
            <span data-testid="theme-name">{theme.name}</span>
            <span data-testid="theme-bg">{theme.colors.bg}</span>
          </div>
        );
      };

      expect(() => {
        render(
          <AppThemeProvider>
            <Consumer />
          </AppThemeProvider>
        );
      }).not.toThrow();

      expect(screen.getByTestId('current-theme')).toHaveTextContent('afterglow');
      expect(screen.getByTestId('theme-name')).toHaveTextContent(APP_THEMES.afterglow.name);
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES.afterglow.colors.bg
      );
    });

    it('boots safely when localStorage is pre-seeded with valueOf, constructor, or __proto__', () => {
      for (const key of [
        'valueOf',
        'constructor',
        '__proto__',
        'hasOwnProperty',
        'isPrototypeOf',
      ]) {
        localStorage.setItem(APP_THEME_STORAGE_KEY, key);

        const Harness = () => {
          const { currentThemeId } = useAppTheme();
          return <span data-testid={`theme-${key}`}>{currentThemeId}</span>;
        };

        const { unmount } = render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        expect(screen.getByTestId(`theme-${key}`)).toHaveTextContent('afterglow');
        expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
        unmount();
      }
    });

    it('survives multi-tab storage event containing "toString" without throwing or mutating to invalid theme', () => {
      const Listener = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="active-theme">{currentThemeId}</span>;
      };

      render(
        <AppThemeProvider>
          <Listener />
        </AppThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: 'toString',
          })
        );
      });

      expect(screen.getByTestId('active-theme')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('survives calling setTheme("toString") without throwing and remains on afterglow', () => {
      const Mutator = () => {
        const { currentThemeId, setTheme } = useAppTheme();
        return (
          <div>
            <span data-testid="theme-val">{currentThemeId}</span>
            <button onClick={() => setTheme('toString' as unknown as AppThemeId)}>
              Inject toString
            </button>
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <Mutator />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByRole('button', { name: 'Inject toString' }).click();
      });

      expect(screen.getByTestId('theme-val')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('applyThemeToDom handles null/undefined/missing cssVariables without TypeError', () => {
      expect(() => {
        applyThemeToDom(null as unknown as AppTheme);
        applyThemeToDom(undefined as unknown as AppTheme);
        applyThemeToDom({} as unknown as AppTheme);
        applyThemeToDom({ id: 'punk_diy' } as unknown as AppTheme);
        applyThemeToDom({ id: 'toString', cssVariables: undefined } as unknown as AppTheme);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Part 2: 4-Dimensional Distinctness Verification
  // =========================================================================
  describe('Part 2: 4-Dimensional Distinctness Criteria', () => {
    const themeIds: AppThemeId[] = [...ALL_APP_THEME_IDS];

    it('verifies all 5 themes exist in APP_THEMES and APP_THEME_LIST', () => {
      expect(Object.keys(APP_THEMES).sort()).toEqual([...themeIds].sort());
      expect(APP_THEME_LIST.map((t) => t.id)).toEqual(themeIds);
    });

    it('Dimension 1: Colors — all 4 themes have mutually distinct background and surface colors', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];

          expect(
            t1.colors.bg.toLowerCase(),
            `Color bg collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.colors.bg.toLowerCase());

          expect(
            t1.colors.surface.toLowerCase(),
            `Color surface collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.colors.surface.toLowerCase());

          expect(
            t1.colors.text.toLowerCase(),
            `Color text collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.colors.text.toLowerCase());
        }
      }
    });

    it('Dimension 2: Typography — all 4 themes have mutually distinct heading and body font families', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];

          expect(
            t1.typography.heading,
            `Heading font collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.typography.heading);

          expect(t1.typography.body, `Body font collision between ${t1.id} and ${t2.id}`).not.toBe(
            t2.typography.body
          );
        }
      }
    });

    it('Dimension 3: Geometry — all 4 themes have distinct corner radius and border geometry', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];

          const hasDistinctGeometry =
            t1.geometry.radiusMd !== t2.geometry.radiusMd ||
            t1.geometry.radiusPill !== t2.geometry.radiusPill ||
            t1.geometry.borderWidth !== t2.geometry.borderWidth ||
            t1.borders?.radius !== t2.borders?.radius ||
            t1.borders?.width !== t2.borders?.width;

          expect(hasDistinctGeometry, `Geometry collision between ${t1.id} and ${t2.id}`).toBe(
            true
          );
        }
      }
    });

    it('Dimension 4: Shadows & Textures — all 4 themes have distinct shadow treatments', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];

          expect(t1.shadows.md, `Shadow md collision between ${t1.id} and ${t2.id}`).not.toBe(
            t2.shadows.md
          );

          expect(t1.shadows.card, `Shadow card collision between ${t1.id} and ${t2.id}`).not.toBe(
            t2.shadows.card
          );
        }
      }
    });
  });

  // =========================================================================
  // Part 3: Punk Rock / Underground / DIY Rubric Compliance
  // =========================================================================
  describe('Part 3: Punk Rock / Underground / DIY Rubric Compliance', () => {
    const punk = APP_THEMES.punk_diy;

    it('satisfies Punk Rubric: Bold stencil/display heading + typewriter monospace body', () => {
      expect(punk.typography.heading).toMatch(/Impact|Arial Black|sans-serif/i);
      expect(punk.typography.body).toMatch(/Courier Prime|Courier New|monospace/i);
      expect(punk.typography.mono).toMatch(/Courier Prime|monospace/i);
    });

    it('satisfies Punk Rubric: Sharp non-pill geometry (0px corner radius and >= 2px heavy border)', () => {
      expect(punk.geometry.radiusSm).toBe('0px');
      expect(punk.geometry.radiusMd).toBe('0px');
      expect(punk.geometry.radiusLg).toBe('0px');
      expect(punk.geometry.radiusXl).toBe('0px');
      expect(punk.geometry.radiusPill).toBe('0px');
      expect(punk.borders?.radius).toBe('0px');

      const borderWidthNum = parseFloat(punk.geometry.borderWidth);
      expect(borderWidthNum).toBeGreaterThanOrEqual(2);
    });

    it('satisfies Punk Rubric: Hard-edged offset shadows with 0px blur radius', () => {
      // Must match format: Xpx Ypx 0px color
      expect(punk.shadows.sm).toMatch(/^\d+px\s+\d+px\s+0px/);
      expect(punk.shadows.md).toMatch(/^\d+px\s+\d+px\s+0px/);
      expect(punk.shadows.card).toMatch(/^\d+px\s+\d+px\s+0px/);
    });

    it('satisfies Punk Rubric: High contrast flyer/zine color contrast (ratio >= 7:1)', () => {
      function getLuminance(hex: string): number {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16) / 255;
        const g = parseInt(clean.substring(2, 4), 16) / 255;
        const b = parseInt(clean.substring(4, 6), 16) / 255;
        const [rl, gl, bl] = [r, g, b].map((c) =>
          c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
      }

      // Check text (#f5f5f5) vs background (#0d0d0f)
      const textLum = getLuminance(punk.colors.text);
      const bgLum = getLuminance(punk.colors.bg);
      const contrast = (Math.max(textLum, bgLum) + 0.05) / (Math.min(textLum, bgLum) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(7.0);

      // Check accentText (#000000) vs accent (#facc15)
      const accentLum = getLuminance(punk.colors.accent);
      const accentTextLum = getLuminance(punk.colors.accentText);
      const accentContrast =
        (Math.max(accentLum, accentTextLum) + 0.05) / (Math.min(accentLum, accentTextLum) + 0.05);
      expect(accentContrast).toBeGreaterThanOrEqual(7.0);
    });
  });

  // =========================================================================
  // Part 4: Zero-FOUC Blocking Pre-render Script Emulation
  // =========================================================================
  describe('Part 4: Zero-FOUC Script Storage Resilience', () => {
    // Executes the real zero-FOUC script shipped in index.html
    const executeZeroFoucInline = () => runIndexHtmlBootScript();

    it('sets afterglow when localStorage is pre-seeded with toString or other proto properties', () => {
      for (const protoKey of ['toString', 'valueOf', 'constructor', '__proto__']) {
        localStorage.setItem('karaoke_app_theme', protoKey);
        executeZeroFoucInline();
        expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
      }
    });

    it('sets valid themes when correctly saved in localStorage', () => {
      const themes = ['tape_studio_70s', 'dive_bar_crt', 'clean_paper', 'punk_diy', 'afterglow'];
      for (const t of themes) {
        localStorage.setItem('karaoke_app_theme', t);
        executeZeroFoucInline();
        expect(document.documentElement.getAttribute('data-theme')).toBe(t);
      }
    });
  });
});
