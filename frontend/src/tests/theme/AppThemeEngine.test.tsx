/**
 * Milestone 1 Unit & Integration Test Suite
 *
 * Verifies App Theme Engine core functionality:
 * 1. Token schema & 4-dimension distinctness across all 5 themes
 * 2. Punk Rock / Underground / DIY rubric compliance
 * 3. Default boot & pre-render DOM initialization ('afterglow')
 * 4. Interactive theme switching & CSS custom property sync
 * 5. LocalStorage persistence & error resilience
 * 6. Corrupt / invalid key fallback handling
 * 7. Zero-regression resilient fallback outside <AppThemeProvider>
 * 8. App idempotent self-wrapping verification
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AppThemeProvider, useAppTheme, AppThemeContext } from '../../context/AppThemeContext';
import {
  APP_THEMES,
  APP_THEME_LIST,
  DEFAULT_THEME_ID,
  DEFAULT_APP_THEME_ID,
  applyThemeToDom,
  getAppTheme,
  isAppThemeId,
} from '../../theme/appThemes';
import { AppThemeId } from '../../types';
import App from '../../App';
import { ALL_APP_THEME_IDS } from '../helpers/themeFixtures';

describe('AppThemeEngine (Milestone 1 Core Verification)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
  });

  // =========================================================================
  // Suite 1: Token Schema & 4-Dimension Distinctness
  // =========================================================================
  describe('Suite 1: Token Schema & 4-Dimension Distinctness', () => {
    const themeIds: AppThemeId[] = [...ALL_APP_THEME_IDS];

    it('defines exactly the 5 application themes', () => {
      expect(Object.keys(APP_THEMES).sort()).toEqual([...themeIds].sort());
      themeIds.forEach((id) => {
        expect(APP_THEMES[id].id).toBe(id);
        expect(APP_THEMES[id].name).toBeTruthy();
        expect(APP_THEMES[id].stagePresetId).toBeTruthy();
      });
    });

    it('verifies Dimension 1 (Background & Surface Palettes) distinctness across all theme pairs', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          expect(
            t1.colors.bg.toLowerCase(),
            `Colors.bg collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.colors.bg.toLowerCase());
          expect(
            t1.colors.surface.toLowerCase(),
            `Colors.surface collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.colors.surface.toLowerCase());
        }
      }
    });

    it('verifies Dimension 2 (Typography Pairings) distinctness across all theme pairs', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          expect(
            t1.fonts?.heading,
            `Heading font collision between ${t1.id} and ${t2.id}`
          ).not.toBe(t2.fonts?.heading);
          expect(t1.fonts?.body, `Body font collision between ${t1.id} and ${t2.id}`).not.toBe(
            t2.fonts?.body
          );
        }
      }
    });

    it('verifies Dimension 3 (Border Width & Corner Radius Geometry) distinctness across all theme pairs', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          const hasDifferentGeometry =
            t1.borders?.radius !== t2.borders?.radius ||
            t1.borders?.width !== t2.borders?.width ||
            t1.borders?.style !== t2.borders?.style;
          expect(
            hasDifferentGeometry,
            `Border geometry collision between ${t1.id} and ${t2.id}`
          ).toBe(true);
        }
      }
    });

    it('verifies Dimension 4 (Shadows & Surface Depth) distinctness across all theme pairs', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          expect(t1.shadows.card, `Shadow collision between ${t1.id} and ${t2.id}`).not.toBe(
            t2.shadows.card
          );
        }
      }
    });

    it('maps every application theme to a valid stage preset ID', () => {
      expect(APP_THEMES.afterglow.stagePresetId).toBe('afterglow');
      expect(APP_THEMES.punk_diy.stagePresetId).toBe('punk_diy');
      expect(APP_THEMES.tape_studio_70s.stagePresetId).toBe('tape_70s');
      expect(APP_THEMES.dive_bar_crt.stagePresetId).toBe('crt_ktv');
      expect(APP_THEMES.clean_paper.stagePresetId).toBe('clean_paper');
    });

    it('exposes APP_THEME_LIST array containing all 5 themes', () => {
      expect(APP_THEME_LIST.length).toBe(ALL_APP_THEME_IDS.length);
      expect(APP_THEME_LIST.map((t) => t.id)).toEqual(themeIds);
    });
  });

  // =========================================================================
  // Suite 2: Punk Rock / Underground / DIY Rubric Compliance
  // =========================================================================
  describe('Suite 2: Punk Rock / Underground / DIY Rubric Compliance', () => {
    const punk = APP_THEMES.punk_diy;

    it('complies with zine display & typewriter/monospace typography rubric', () => {
      expect(punk.fonts?.heading).toMatch(/Syne|Impact|Stencil|Arial Black/i);
      expect(punk.fonts?.body).toMatch(/Courier|monospace|ui-monospace/i);
    });

    it('complies with sharp non-pill geometry rubric (0px radius, heavy border)', () => {
      expect(punk.borders?.radius).toMatch(/^(0px|0)$/);
      const widthVal = parseInt(punk.borders?.width || '0', 10);
      expect(widthVal).toBeGreaterThanOrEqual(2);
    });

    it('complies with hard offset shadow rubric (zero blur radius)', () => {
      // Hard offset shadow format: Xpx Ypx 0px [color]
      expect(punk.shadows.card).toMatch(/^\d+px\s+\d+px\s+0px/);
    });

    it('complies with high flyer/zine contrast ratio (>= 7:1)', () => {
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
      const l1 = getLuminance(punk.colors.text);
      const l2 = getLuminance(punk.colors.bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });
  });

  // =========================================================================
  // Suite 3: Default Boot & Pre-Render Initialization
  // =========================================================================
  describe('Suite 3: Default Boot & Pre-Render Initialization', () => {
    const TestConsumer: React.FC = () => {
      const { currentThemeId, themeId, theme } = useAppTheme();
      return (
        <div>
          <span data-testid="theme-id">{currentThemeId}</span>
          <span data-testid="theme-id-alias">{themeId}</span>
          <span data-testid="theme-name">{theme.name}</span>
        </div>
      );
    };

    it('defaults to afterglow on fresh boot with empty localStorage', () => {
      render(
        <AppThemeProvider>
          <TestConsumer />
        </AppThemeProvider>
      );
      expect(screen.getByTestId('theme-id')).toHaveTextContent('afterglow');
      expect(screen.getByTestId('theme-id-alias')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('injects all required CSS custom properties onto document.documentElement', () => {
      render(
        <AppThemeProvider>
          <TestConsumer />
        </AppThemeProvider>
      );
      const style = document.documentElement.style;
      const punk = APP_THEMES[DEFAULT_APP_THEME_ID];

      // Both --app-* aliases and --theme-* primary tokens
      expect(style.getPropertyValue('--app-bg')).toBe(punk.colors.bg);
      expect(style.getPropertyValue('--app-surface')).toBe(punk.colors.surface);
      expect(style.getPropertyValue('--app-border-color')).toBe(punk.colors.border);
      expect(style.getPropertyValue('--app-text')).toBe(punk.colors.text);
      expect(style.getPropertyValue('--app-accent')).toBe(punk.colors.accent);
      expect(style.getPropertyValue('--app-font-heading')).toBe(punk.typography.heading);
      expect(style.getPropertyValue('--app-font-body')).toBe(punk.typography.body);
      expect(style.getPropertyValue('--app-radius')).toBe(punk.geometry.radiusMd);
      expect(style.getPropertyValue('--app-border-width')).toBe(punk.geometry.borderWidth);
      expect(style.getPropertyValue('--app-shadow-card')).toBe(punk.shadows.card);

      expect(style.getPropertyValue('--theme-bg')).toBe(punk.colors.bg);
      expect(style.getPropertyValue('--theme-surface')).toBe(punk.colors.surface);
      expect(style.getPropertyValue('--theme-border')).toBe(punk.colors.border);
      expect(style.getPropertyValue('--theme-text')).toBe(punk.colors.text);
      expect(style.getPropertyValue('--theme-accent')).toBe(punk.colors.accent);
      expect(style.getPropertyValue('--karaoke-font-family')).toBe(punk.typography.karaoke);
    });
  });

  // =========================================================================
  // Suite 4: Interactive Theme Switching & DOM Synchronization
  // =========================================================================
  describe('Suite 4: Interactive Theme Switching & DOM Synchronization', () => {
    const SwitcherComponent: React.FC = () => {
      const { currentThemeId, setTheme, resetToDefault } = useAppTheme();
      return (
        <div>
          <span data-testid="active-theme">{currentThemeId}</span>
          <button onClick={() => setTheme('tape_studio_70s')}>Tape 70s</button>
          <button onClick={() => setTheme('dive_bar_crt')}>Dive Bar</button>
          <button onClick={() => setTheme('clean_paper')}>Clean Paper</button>
          <button onClick={() => setTheme('punk_diy')}>Punk DIY</button>
          <button onClick={resetToDefault}>Reset Default</button>
        </div>
      );
    };

    it('updates context and DOM data-theme attribute on theme switch', async () => {
      render(
        <AppThemeProvider>
          <SwitcherComponent />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByRole('button', { name: 'Tape 70s' }).click();
      });
      expect(screen.getByTestId('active-theme')).toHaveTextContent('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
        APP_THEMES.tape_studio_70s.colors.bg
      );

      act(() => {
        screen.getByRole('button', { name: 'Clean Paper' }).click();
      });
      expect(screen.getByTestId('active-theme')).toHaveTextContent('clean_paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
        APP_THEMES.clean_paper.colors.bg
      );

      act(() => {
        screen.getByRole('button', { name: 'Reset Default' }).click();
      });
      expect(screen.getByTestId('active-theme')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('survives rapid successive theme switching with atomic consistency', () => {
      render(
        <AppThemeProvider>
          <SwitcherComponent />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByRole('button', { name: 'Tape 70s' }).click();
        screen.getByRole('button', { name: 'Dive Bar' }).click();
        screen.getByRole('button', { name: 'Clean Paper' }).click();
        screen.getByRole('button', { name: 'Punk DIY' }).click();
      });

      expect(screen.getByTestId('active-theme')).toHaveTextContent('punk_diy');
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(
        APP_THEMES.punk_diy.colors.bg
      );
    });
  });

  // =========================================================================
  // Suite 5: LocalStorage Persistence & Lifecycle
  // =========================================================================
  describe('Suite 5: LocalStorage Persistence & Lifecycle', () => {
    const PersistenceComponent: React.FC = () => {
      const { setTheme } = useAppTheme();
      return <button onClick={() => setTheme('clean_paper')}>Select Clean Paper</button>;
    };

    it('writes theme selection to localStorage under key "karaoke_app_theme"', () => {
      render(
        <AppThemeProvider>
          <PersistenceComponent />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByRole('button').click();
      });

      expect(localStorage.getItem('karaoke_app_theme')).toBe('clean_paper');
    });

    it('reads pre-seeded theme from localStorage on initial boot', () => {
      localStorage.setItem('karaoke_app_theme', 'dive_bar_crt');

      const Consumer: React.FC = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="booted-theme">{currentThemeId}</span>;
      };

      render(
        <AppThemeProvider>
          <Consumer />
        </AppThemeProvider>
      );

      expect(screen.getByTestId('booted-theme')).toHaveTextContent('dive_bar_crt');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
    });

    it('handles localStorage throwing SecurityError or QuotaExceededError gracefully', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });

      render(
        <AppThemeProvider>
          <PersistenceComponent />
        </AppThemeProvider>
      );

      expect(() => {
        act(() => {
          screen.getByRole('button').click();
        });
      }).not.toThrow();

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      setItemSpy.mockRestore();
    });
  });

  // =========================================================================
  // Suite 6: Invalid & Malformed Storage Key Handling
  // =========================================================================
  describe('Suite 6: Invalid & Malformed Storage Key Handling', () => {
    const Consumer: React.FC = () => {
      const { currentThemeId } = useAppTheme();
      return <span data-testid="theme">{currentThemeId}</span>;
    };

    it('falls back to afterglow when localStorage contains unknown theme key', () => {
      localStorage.setItem('karaoke_app_theme', 'unknown_gradient_cyber_theme');

      render(
        <AppThemeProvider>
          <Consumer />
        </AppThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('falls back to afterglow when localStorage contains empty string or corrupted JSON', () => {
      localStorage.setItem('karaoke_app_theme', '');

      render(
        <AppThemeProvider>
          <Consumer />
        </AppThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('afterglow');
    });

    it('safely handles calling setTheme with invalid key by defaulting to afterglow without crashing', () => {
      const InvalidCaller: React.FC = () => {
        const { setTheme } = useAppTheme();
        return (
          <button onClick={() => setTheme('corrupt_theme_id' as unknown as AppThemeId)}>
            Call Invalid
          </button>
        );
      };

      render(
        <AppThemeProvider>
          <InvalidCaller />
          <Consumer />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByRole('button', { name: 'Call Invalid' }).click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('afterglow');
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('verifies isAppThemeId and getAppTheme edge cases and exports', () => {
      expect(DEFAULT_APP_THEME_ID).toBe('afterglow');
      expect(DEFAULT_THEME_ID).toBe('afterglow');
      expect(AppThemeContext).toBeDefined();

      applyThemeToDom(APP_THEMES.clean_paper);
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');

      expect(isAppThemeId('punk_diy')).toBe(true);
      expect(isAppThemeId('invalid_id')).toBe(false);
      expect(isAppThemeId(null)).toBe(false);
      expect(isAppThemeId(undefined)).toBe(false);

      expect(getAppTheme('clean_paper').id).toBe('clean_paper');
      expect(getAppTheme('unknown_id').id).toBe('afterglow');
      expect(getAppTheme(null).id).toBe('afterglow');
    });
  });

  // =========================================================================
  // Suite 7: Zero-Regression Resilient Fallback (Outside Provider)
  // =========================================================================
  describe('Suite 7: Zero-Regression Resilient Fallback (Outside Provider)', () => {
    const ComponentWithoutProvider: React.FC = () => {
      const { currentThemeId, theme, setTheme, availableThemes } = useAppTheme();
      return (
        <div>
          <span data-testid="fallback-id">{currentThemeId}</span>
          <span data-testid="fallback-name">{theme.name}</span>
          <span data-testid="available-count">{availableThemes.length}</span>
          <button onClick={() => setTheme('clean_paper')}>Call SetTheme</button>
        </div>
      );
    };

    it('does NOT throw when useAppTheme is called outside <AppThemeProvider>', () => {
      expect(() => {
        render(<ComponentWithoutProvider />);
      }).not.toThrow();
    });

    it('returns default afterglow theme properties from resilient fallback', () => {
      render(<ComponentWithoutProvider />);

      expect(screen.getByTestId('fallback-id')).toHaveTextContent('afterglow');
      expect(screen.getByTestId('fallback-name')).toHaveTextContent(APP_THEMES.afterglow.name);
      expect(screen.getByTestId('available-count')).toHaveTextContent(
        String(ALL_APP_THEME_IDS.length)
      );
    });

    it('allows setTheme to be called on fallback without error', () => {
      render(<ComponentWithoutProvider />);

      expect(() => {
        act(() => {
          screen.getByRole('button', { name: 'Call SetTheme' }).click();
        });
      }).not.toThrow();

      // Direct DOM update occurs even in fallback
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
    });
  });

  // =========================================================================
  // Suite 8: Idempotent Self-Wrapping in App.tsx
  // =========================================================================
  describe('Suite 8: Idempotent Self-Wrapping in App.tsx', () => {
    it('renders <App /> directly without crashing and provides theme context', () => {
      const { container } = render(<App />);
      expect(container).toBeDefined();
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });
  });
});
