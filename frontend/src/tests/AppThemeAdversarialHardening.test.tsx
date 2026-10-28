/**
 * AppThemeAdversarialHardening.test.tsx — Milestone 5 Tier 5 Adversarial Coverage Hardening
 *
 * White-box adversarial test suite covering untested code paths, edge cases, and boundary values
 * across the application theme system and stage preset export pipeline:
 *
 * 1. appThemes.ts: Boundary color formats, malformed theme configs, CSS custom property builders,
 *    type guard edge cases, and defensive storage error handling.
 * 2. AppThemeContext.tsx: Concurrent theme changes, multi-tab storage event payloads (null, empty,
 *    invalid, mismatched keys), unmount listener cleanups, and provider fallback resilience.
 * 3. useVisualTheme.ts: Custom color preservation during rapid consecutive switches, exhaustive
 *    cssToAssColor boundary conversions, resetThemeDefaults edge cases, and root DOM synchronization.
 * 4. LyricDisplay.tsx: Stage font resolution fallback chains, undefined/null presets, extreme font
 *    size scales with clamps, boundary lyric fixtures, and duet role normalization.
 * 5. Backend & Export Alignment: ExportSubtitleSection URL construction, ExportModal video render
 *    payloads, aspect ratios (16:9 vs 9:16), outline/shadow widths, and ass_generator parity.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';

// Domain Types
import { AppThemeId, AppTheme, VisualTheme, LyricLine, ProjectState } from '../types';

// Theme Engine & Registry
import {
  APP_THEMES,
  APP_THEME_LIST,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_ID,
  applyThemeToDom,
  getAppTheme,
  getStoredAppTheme,
  setStoredAppTheme,
  isAppThemeId,
  buildThemeCssVariables,
  PUNK_DIY_THEME,
  CLEAN_PAPER_THEME,
} from '../theme/appThemes';

// Context & Hooks
import { AppThemeProvider, useAppTheme } from '../context/AppThemeContext';
import { useVisualTheme, cssToAssColor } from '../hooks/useVisualTheme';

// Components
import { THEMES } from '../components/VisualThemePicker';
import { LyricDisplay } from '../components/LyricDisplay';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';

// API Module
import * as apiModule from '../api';

// ============================================================================
// Test Fixtures
// ============================================================================

const sampleLyricLines: LyricLine[] = [
  {
    id: 1,
    start_time: 1.0,
    end_time: 4.5,
    text: 'Raw underground punk rock anthem',
    singer: 'singer1',
    words: [
      { word: 'Raw', start_time: 1.0, end_time: 1.6 },
      { word: 'underground', start_time: 1.7, end_time: 2.8 },
      { word: 'punk', start_time: 2.9, end_time: 3.4 },
      { word: 'rock', start_time: 3.5, end_time: 3.9 },
      { word: 'anthem', start_time: 4.0, end_time: 4.5 },
    ],
  },
  {
    id: 2,
    start_time: 5.5,
    end_time: 9.0,
    text: 'Second line screaming in duet unison',
    singer: 'singer2',
    words: [
      { word: 'Second', start_time: 5.5, end_time: 6.2 },
      { word: 'line', start_time: 6.3, end_time: 7.0 },
      { word: 'screaming', start_time: 7.1, end_time: 8.0 },
      { word: 'in', start_time: 8.1, end_time: 8.4 },
      { word: 'duet', start_time: 8.5, end_time: 8.8 },
      { word: 'unison', start_time: 8.8, end_time: 9.0 },
    ],
  },
  {
    id: 3,
    start_time: 10.0,
    end_time: 13.0,
    text: 'Both singers together in harmony',
    singer: 'both',
    words: [
      { word: 'Both', start_time: 10.0, end_time: 10.8 },
      { word: 'singers', start_time: 10.9, end_time: 11.6 },
      { word: 'together', start_time: 11.7, end_time: 12.3 },
      { word: 'in', start_time: 12.4, end_time: 12.6 },
      { word: 'harmony', start_time: 12.7, end_time: 13.0 },
    ],
  },
];

const mockProjectState: ProjectState = {
  id: 'proj_adversarial_m5',
  title: 'Adversarial Anthem',
  artist: 'The Challengers',
  duration: 180,
  status: 'ready',
  progress: 100,
  lines: sampleLyricLines,
  semitones: 0,
  guide_volume: 0,
  created_by: 'TestRunner',
};

describe('Milestone 5 Tier 5 Adversarial Coverage Hardening', () => {
  let mockApiFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
    document.documentElement.removeAttribute('data-sync-mode');
    document.documentElement.style.cssText = '';
    vi.restoreAllMocks();

    mockApiFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/export/ass') || url.includes('/export/lrc')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'Content-Type': 'text/x-ssa; charset=utf-8',
            'Content-Disposition': 'attachment; filename="test.ass"',
          }),
          blob: () =>
            Promise.resolve(new Blob(['[Script Info]\nTitle: Test'], { type: 'text/x-ssa' })),
        });
      }
      if (url.includes('/render')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ task_id: 'task_render_adv_123', status: 'queued' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });
    vi.spyOn(apiModule, 'apiFetch').mockImplementation(mockApiFetch);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // =========================================================================
  // Target 1: appThemes.ts White-Box Hardening
  // =========================================================================
  describe('Target 1: appThemes.ts White-Box Hardening', () => {
    describe('1.1 Boundary Color Formats & Token Variations', () => {
      it('buildThemeCssVariables handles extreme color boundary values (pure black #000000 and pure white #ffffff)', () => {
        const customColors = {
          ...PUNK_DIY_THEME.colors,
          bg: '#000000',
          surface: '#050505',
          text: '#ffffff',
          accent: '#ffffff',
          border: '#000000',
        };
        const vars = buildThemeCssVariables(
          customColors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );

        expect(vars['--theme-bg']).toBe('#000000');
        expect(vars['--theme-text']).toBe('#ffffff');
        expect(vars['--app-bg']).toBe('#000000');
        expect(vars['--app-text']).toBe('#ffffff');
      });

      it('buildThemeCssVariables preserves 3-digit shorthand hex colors without distortion', () => {
        const shorthandColors = {
          ...PUNK_DIY_THEME.colors,
          accent: '#fc0',
          sung: '#0f0',
        };
        const vars = buildThemeCssVariables(
          shorthandColors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );

        expect(vars['--theme-accent']).toBe('#fc0');
        expect(vars['--theme-sung']).toBe('#0f0');
        expect(vars['--app-accent']).toBe('#fc0');
      });

      it('buildThemeCssVariables supports functional CSS colors (rgb, hsl, var)', () => {
        const functionalColors = {
          ...PUNK_DIY_THEME.colors,
          accent: 'rgb(250, 204, 21)',
          secondary: 'hsl(0, 84%, 60%)',
          highlight: 'var(--custom-highlight-color)',
        };
        const vars = buildThemeCssVariables(
          functionalColors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );

        expect(vars['--theme-accent']).toBe('rgb(250, 204, 21)');
        expect(vars['--theme-secondary']).toBe('hsl(0, 84%, 60%)');
        expect(vars['--theme-highlight']).toBe('var(--custom-highlight-color)');
      });

      it('buildThemeCssVariables safely handles uppercase and lowercase color tokens identically', () => {
        const upperColors = { ...PUNK_DIY_THEME.colors, accent: '#FACC15', text: '#F5F5F5' };
        const lowerColors = { ...PUNK_DIY_THEME.colors, accent: '#facc15', text: '#f5f5f5' };

        const upperVars = buildThemeCssVariables(
          upperColors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );
        const lowerVars = buildThemeCssVariables(
          lowerColors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );

        expect(upperVars['--theme-accent'].toLowerCase()).toBe(
          lowerVars['--theme-accent'].toLowerCase()
        );
        expect(upperVars['--theme-text'].toLowerCase()).toBe(
          lowerVars['--theme-text'].toLowerCase()
        );
      });
    });

    describe('1.2 Malformed Theme Configurations & Variable Builders', () => {
      it('buildThemeCssVariables falls back to shadows.md when shadows.card is undefined or empty', () => {
        const shadowsWithoutCard = {
          sm: '1px 1px 0px #000',
          md: '3px 3px 0px #000',
          lg: '5px 5px 0px #000',
          glow: '2px 2px 0px #f00',
          card: '',
        };
        const vars = buildThemeCssVariables(
          PUNK_DIY_THEME.colors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          shadowsWithoutCard
        );

        expect(vars['--app-shadow-card']).toBe(shadowsWithoutCard.md);
      });

      it('buildThemeCssVariables populates both semantic (--theme-*) and backward-compatible alias (--app-*) tokens', () => {
        const vars = buildThemeCssVariables(
          PUNK_DIY_THEME.colors,
          PUNK_DIY_THEME.typography,
          PUNK_DIY_THEME.geometry,
          PUNK_DIY_THEME.shadows
        );

        // Verification of semantic tokens
        expect(vars['--theme-bg']).toBe(PUNK_DIY_THEME.colors.bg);
        expect(vars['--theme-surface']).toBe(PUNK_DIY_THEME.colors.surface);
        expect(vars['--theme-border']).toBe(PUNK_DIY_THEME.colors.border);
        expect(vars['--theme-text']).toBe(PUNK_DIY_THEME.colors.text);
        expect(vars['--theme-accent']).toBe(PUNK_DIY_THEME.colors.accent);
        expect(vars['--theme-sung']).toBe(PUNK_DIY_THEME.colors.sung);
        expect(vars['--theme-unsung']).toBe(PUNK_DIY_THEME.colors.unsung);
        expect(vars['--karaoke-font-family']).toBe(PUNK_DIY_THEME.typography.karaoke);

        // Verification of alias tokens
        expect(vars['--app-bg']).toBe(PUNK_DIY_THEME.colors.bg);
        expect(vars['--app-surface']).toBe(PUNK_DIY_THEME.colors.surface);
        expect(vars['--app-border-color']).toBe(PUNK_DIY_THEME.colors.border);
        expect(vars['--app-text']).toBe(PUNK_DIY_THEME.colors.text);
        expect(vars['--app-accent']).toBe(PUNK_DIY_THEME.colors.accent);
        expect(vars['--app-radius']).toBe(PUNK_DIY_THEME.geometry.radiusMd);
      });

      it('applyThemeToDom handles null, undefined, or empty objects gracefully without throwing', () => {
        expect(() => applyThemeToDom(null as unknown as AppTheme)).not.toThrow();
        expect(() => applyThemeToDom(undefined as unknown as AppTheme)).not.toThrow();
        expect(() => applyThemeToDom({} as unknown as AppTheme)).not.toThrow();
      });

      it('applyThemeToDom defaults data-theme to punk_diy if theme.id is missing or undefined', () => {
        const partialTheme = {
          cssVariables: {
            '--theme-bg': '#121212',
          },
        } as unknown as AppTheme;

        applyThemeToDom(partialTheme);
        expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#121212');
      });

      it('applyThemeToDom returns early without touching DOM if theme.cssVariables is undefined', () => {
        document.documentElement.setAttribute('data-theme', 'original_state');
        const themeWithoutVars = { id: 'punk_diy' } as unknown as AppTheme;

        applyThemeToDom(themeWithoutVars);
        expect(document.documentElement.getAttribute('data-theme')).toBe('original_state');
      });

      it('applyThemeToDom safely handles theme with empty cssVariables dictionary', () => {
        const emptyVarsTheme = {
          id: 'clean_paper',
          cssVariables: {},
        } as unknown as AppTheme;

        expect(() => applyThemeToDom(emptyVarsTheme)).not.toThrow();
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      });
    });

    describe('1.3 Type Guard isAppThemeId & Registry Resilience', () => {
      it('rejects non-string types with complete type guard safety', () => {
        const nonStrings = [
          null,
          undefined,
          0,
          1,
          -1,
          NaN,
          Infinity,
          true,
          false,
          {},
          [],
          ['punk_diy'],
          { id: 'punk_diy' },
          Symbol('punk_diy'),
          () => 'punk_diy',
        ];

        for (const val of nonStrings) {
          expect(isAppThemeId(val)).toBe(false);
        }
      });

      it('rejects whitespace-padded, mixed-case, and partial string matches', () => {
        const invalidStrings = [
          '',
          '   ',
          '\t',
          '\n',
          ' punk_diy',
          'punk_diy ',
          ' punk_diy ',
          'PUNK_DIY',
          'Punk_Diy',
          'punk',
          'diy',
          'tape_studio',
          'clean',
          'dive_bar',
        ];

        for (const str of invalidStrings) {
          expect(isAppThemeId(str)).toBe(false);
        }
      });

      it('rejects prototype pollution property names and constructor traps', () => {
        const protoTraps = [
          'toString',
          'valueOf',
          'constructor',
          '__proto__',
          'hasOwnProperty',
          'isPrototypeOf',
          'propertyIsEnumerable',
          'toLocaleString',
        ];

        for (const trap of protoTraps) {
          expect(isAppThemeId(trap)).toBe(false);
        }
      });

      it('rejects legacy and stage-only preset IDs in application theme guard', () => {
        const stageOnlyOrLegacy = [
          'modern_gold',
          'cyber_cyan',
          'neon_pink',
          'classic_ktv',
          'tape_70s', // stage preset ID, not app theme ID
          'crt_ktv', // stage preset ID, not app theme ID
        ];

        for (const id of stageOnlyOrLegacy) {
          expect(isAppThemeId(id)).toBe(false);
        }
      });

      it('accepts exactly the four canonical application theme IDs', () => {
        const canonical: AppThemeId[] = [
          'punk_diy',
          'tape_studio_70s',
          'dive_bar_crt',
          'clean_paper',
        ];

        for (const id of canonical) {
          expect(isAppThemeId(id)).toBe(true);
        }
      });

      it('getAppTheme returns canonical theme object for valid IDs and falls back to punk_diy for invalid', () => {
        expect(getAppTheme('punk_diy').id).toBe('punk_diy');
        expect(getAppTheme('tape_studio_70s').id).toBe('tape_studio_70s');
        expect(getAppTheme('dive_bar_crt').id).toBe('dive_bar_crt');
        expect(getAppTheme('clean_paper').id).toBe('clean_paper');

        // Adversarial fallbacks
        expect(getAppTheme(null).id).toBe(DEFAULT_APP_THEME_ID);
        expect(getAppTheme(undefined).id).toBe(DEFAULT_APP_THEME_ID);
        expect(getAppTheme('').id).toBe(DEFAULT_APP_THEME_ID);
        expect(getAppTheme('unknown_theme_123').id).toBe(DEFAULT_APP_THEME_ID);
        expect(getAppTheme('__proto__').id).toBe(DEFAULT_APP_THEME_ID);
        expect(getAppTheme('toString').id).toBe(DEFAULT_APP_THEME_ID);
      });

      it('APP_THEMES supports Symbol.iterator yielding all 5 themes in canonical order', () => {
        const iterated = Array.from(APP_THEMES);
        expect(iterated).toHaveLength(5);
        expect(iterated.map((t) => t.id)).toEqual([
          'afterglow',
          'punk_diy',
          'tape_studio_70s',
          'dive_bar_crt',
          'clean_paper',
        ]);
        expect(iterated).toEqual(APP_THEME_LIST);
      });
    });

    describe('1.4 Defensive Storage Helpers Error Resilience', () => {
      it('getStoredAppTheme falls back to punk_diy on corrupt, JSON, or non-theme values', () => {
        const badStorageValues = [
          'null',
          'undefined',
          '{}',
          '[]',
          '{"theme":"punk_diy"}',
          '[object Object]',
          '0',
          'false',
          'NaN',
          'tape_70s',
          'classic_ktv',
          'modern_gold',
        ];

        for (const val of badStorageValues) {
          localStorage.setItem(APP_THEME_STORAGE_KEY, val);
          expect(getStoredAppTheme()).toBe(DEFAULT_APP_THEME_ID);
        }
      });

      it('getStoredAppTheme catches SecurityError/DOMException and safely falls back', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
          throw new DOMException('Access denied', 'SecurityError');
        });

        expect(getStoredAppTheme()).toBe(DEFAULT_APP_THEME_ID);
      });

      it('setStoredAppTheme catches QuotaExceededError and does not throw', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        });

        expect(() => setStoredAppTheme('clean_paper')).not.toThrow();
      });
    });
  });

  // =========================================================================
  // Target 2: AppThemeContext.tsx White-Box Hardening
  // =========================================================================
  describe('Target 2: AppThemeContext.tsx White-Box Hardening', () => {
    describe('2.1 Concurrent & Rapid Sequential Theme Switching', () => {
      it('rapid consecutive synchronous setThemeId calls converge cleanly to the final theme', () => {
        const Harness: React.FC = () => {
          const { themeId, setThemeId } = useAppTheme();
          return (
            <div>
              <span data-testid="active-theme">{themeId}</span>
              <button
                type="button"
                data-testid="switch-rapid-btn"
                onClick={() => {
                  setThemeId('tape_studio_70s');
                  setThemeId('dive_bar_crt');
                  setThemeId('clean_paper');
                }}
              >
                Rapid Switch
              </button>
            </div>
          );
        };

        render(
          <AppThemeProvider initialThemeId="punk_diy">
            <Harness />
          </AppThemeProvider>
        );

        expect(screen.getByTestId('active-theme')).toHaveTextContent('punk_diy');
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');

        act(() => {
          fireEvent.click(screen.getByTestId('switch-rapid-btn'));
        });

        expect(screen.getByTestId('active-theme')).toHaveTextContent('clean_paper');
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('clean_paper');
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
          CLEAN_PAPER_THEME.colors.bg
        );
      });

      it('cyclical theme switching 20 times in a tight loop preserves DOM and storage consistency', () => {
        const themeSequence: AppThemeId[] = [
          'punk_diy',
          'tape_studio_70s',
          'dive_bar_crt',
          'clean_paper',
        ];

        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        for (let cycle = 0; cycle < 5; cycle++) {
          for (const targetTheme of themeSequence) {
            act(() => {
              result.current.setThemeId(targetTheme);
            });
            expect(result.current.themeId).toBe(targetTheme);
            expect(document.documentElement.getAttribute('data-theme')).toBe(targetTheme);
            expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe(targetTheme);
            expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
              APP_THEMES[targetTheme].colors.bg
            );
          }
        }
      });

      it('calling setTheme with invalid string safely defaults to afterglow', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="clean_paper">{children}</AppThemeProvider>
          ),
        });

        expect(result.current.themeId).toBe('clean_paper');

        act(() => {
          // Cast invalid string to test defensive handling
          result.current.setThemeId('malformed_theme_id' as AppThemeId);
        });

        expect(result.current.themeId).toBe('afterglow');
        expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('afterglow');
      });
    });

    describe('2.2 Multi-Tab Storage Event Synchronization Edge Cases', () => {
      it('valid storage event updates state reactively and synchronizes DOM', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
          ),
        });

        expect(result.current.themeId).toBe('punk_diy');

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: 'tape_studio_70s',
            })
          );
        });

        expect(result.current.themeId).toBe('tape_studio_70s');
        expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      });

      it('storage event with newValue null (e.g. storage cleared in another tab) does not corrupt state', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="clean_paper">{children}</AppThemeProvider>
          ),
        });

        expect(result.current.themeId).toBe('clean_paper');

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: null,
            })
          );
        });

        // Must remain clean_paper without crashing or becoming null/undefined
        expect(result.current.themeId).toBe('clean_paper');
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      });

      it('storage event with newValue empty string is safely ignored', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="dive_bar_crt">{children}</AppThemeProvider>
          ),
        });

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: '',
            })
          );
        });

        expect(result.current.themeId).toBe('dive_bar_crt');
      });

      it('storage event with invalid or corrupted theme string is safely ignored', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
          ),
        });

        const maliciousPayloads = [
          'null',
          'undefined',
          '{}',
          '[object Object]',
          'toString',
          '__proto__',
          'tape_70s', // stage preset, not app theme
          'invalid_theme_xyz',
        ];

        for (const payload of maliciousPayloads) {
          act(() => {
            window.dispatchEvent(
              new StorageEvent('storage', {
                key: APP_THEME_STORAGE_KEY,
                newValue: payload,
              })
            );
          });
          expect(result.current.themeId).toBe('punk_diy');
        }
      });

      it('storage event with unrelated key (e.g. volume or session) does not trigger theme change', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
          ),
        });

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: 'karaoke_volume',
              newValue: 'clean_paper',
            })
          );
        });

        expect(result.current.themeId).toBe('punk_diy');
      });
    });

    describe('2.3 Component Unmount & Listener Cleanup', () => {
      it('removes storage event listener upon unmount without error or warning', () => {
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount } = render(
          <AppThemeProvider initialThemeId="punk_diy">
            <div>Provider Content</div>
          </AppThemeProvider>
        );

        unmount();

        expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));

        // Dispatching storage event after unmount must not throw
        expect(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: 'tape_studio_70s',
            })
          );
        }).not.toThrow();
      });
    });

    describe('2.4 Provider Fallback Outside AppThemeProvider', () => {
      it('useAppTheme outside provider returns resilient fallback without throwing', () => {
        const { result } = renderHook(() => useAppTheme());

        expect(result.current.themeId).toBe(DEFAULT_APP_THEME_ID);
        expect(result.current.currentThemeId).toBe(DEFAULT_APP_THEME_ID);
        expect(result.current.theme.id).toBe(DEFAULT_APP_THEME_ID);
        expect(result.current.availableThemes).toEqual(APP_THEME_LIST);

        // Mutating actions outside provider should apply to DOM without throwing
        expect(() => {
          act(() => {
            result.current.setThemeId('clean_paper');
          });
        }).not.toThrow();
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');

        expect(() => {
          act(() => {
            result.current.resetToDefault();
          });
        }).not.toThrow();
        expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
      });
    });
  });

  // =========================================================================
  // Target 3: useVisualTheme.ts White-Box Hardening
  // =========================================================================
  describe('Target 3: useVisualTheme.ts White-Box Hardening', () => {
    describe('3.1 Custom Color Preservation During Rapid Consecutive Switches', () => {
      it('strictly preserves customSungColor and customUnsungColor across rapid consecutive app theme switches', () => {
        let setAppThemeExternal: ((id: AppThemeId) => void) | undefined;

        const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
          const { setThemeId } = useAppTheme();
          setAppThemeExternal = setThemeId;
          return <>{children}</>;
        };

        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">
              <TestWrapper>{children}</TestWrapper>
            </AppThemeProvider>
          ),
        });

        // Set custom colors
        act(() => {
          result.current.setCustomSungColor('#ff00aa');
          result.current.setCustomUnsungColor('#00ffaa');
        });

        expect(result.current.customSungColor).toBe('#ff00aa');
        expect(result.current.customUnsungColor).toBe('#00ffaa');
        expect(result.current.activeSungColor).toBe('#ff00aa');
        expect(result.current.activeUnsungColor).toBe('#00ffaa');

        // Cycle through all application themes
        const themesToVisit: AppThemeId[] = [
          'tape_studio_70s',
          'dive_bar_crt',
          'clean_paper',
          'punk_diy',
        ];

        for (const targetAppTheme of themesToVisit) {
          act(() => {
            setAppThemeExternal!(targetAppTheme);
          });

          // Custom colors MUST remain intact
          expect(result.current.customSungColor).toBe('#ff00aa');
          expect(result.current.customUnsungColor).toBe('#00ffaa');
          expect(result.current.activeSungColor).toBe('#ff00aa');
          expect(result.current.activeUnsungColor).toBe('#00ffaa');

          // Effective theme primary_color and secondary_color must reflect ASS BGR converted colors
          expect(result.current.effectiveTheme.primary_color).toBe('&H00AA00FF');
          expect(result.current.effectiveTheme.secondary_color).toBe('&H00AAFF00');
        }
      });

      it('preserves customSungColor when customUnsungColor is null (and vice-versa)', () => {
        let setAppThemeExternal: ((id: AppThemeId) => void) | undefined;

        const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
          const { setThemeId } = useAppTheme();
          setAppThemeExternal = setThemeId;
          return <>{children}</>;
        };

        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">
              <TestWrapper>{children}</TestWrapper>
            </AppThemeProvider>
          ),
        });

        // Override only sung color
        act(() => {
          result.current.setCustomSungColor('#00ffff');
        });

        expect(result.current.customSungColor).toBe('#00ffff');
        expect(result.current.customUnsungColor).toBeNull();
        expect(result.current.activeSungColor).toBe('#00ffff');
        expect(result.current.activeUnsungColor).toBe(result.current.selectedTheme.previewUnsung);

        // Switch to tape_studio_70s
        act(() => {
          setAppThemeExternal!('tape_studio_70s');
        });

        expect(result.current.customSungColor).toBe('#00ffff');
        expect(result.current.customUnsungColor).toBeNull();
        expect(result.current.activeSungColor).toBe('#00ffff');
        // Unsung color falls back to new theme preset's previewUnsung
        expect(result.current.activeUnsungColor).toBe(result.current.selectedTheme.previewUnsung);
      });
    });

    describe('3.2 cssToAssColor Exhaustive Boundary Conversions', () => {
      it('converts 3-digit shorthand hex with accurate channel duplication (#fc0 -> &H0000CCFF)', () => {
        expect(cssToAssColor('#fc0')).toBe('&H0000CCFF'); // r=FF, g=CC, b=00 -> BGR 00CCFF
        expect(cssToAssColor('#fff')).toBe('&H00FFFFFF');
        expect(cssToAssColor('#000')).toBe('&H00000000');
        expect(cssToAssColor('#123')).toBe('&H00332211');
        expect(cssToAssColor('#abc')).toBe('&H00CCBBAA');
      });

      it('converts 6-digit hex with RGB to BGR byte reversal (#facc15 -> &H0015CCFA)', () => {
        expect(cssToAssColor('#facc15')).toBe('&H0015CCFA');
        expect(cssToAssColor('#0d0d0f')).toBe('&H000F0D0D');
        expect(cssToAssColor('#1a1410')).toBe('&H0010141A');
        expect(cssToAssColor('#f43f5e')).toBe('&H005E3FF4');
        expect(cssToAssColor('#00ffff')).toBe('&H00FFFF00');
      });

      it('converts hex colors without leading hash symbol seamlessly', () => {
        expect(cssToAssColor('facc15')).toBe('&H0015CCFA');
        expect(cssToAssColor('fc0')).toBe('&H0000CCFF');
        expect(cssToAssColor('000000')).toBe('&H00000000');
        expect(cssToAssColor('ffffff')).toBe('&H00FFFFFF');
      });

      it('normalizes pre-formatted &H and lowercase &h ASS strings to uppercase', () => {
        expect(cssToAssColor('&H0015CCFA')).toBe('&H0015CCFA');
        expect(cssToAssColor('&h0015ccfa')).toBe('&H0015CCFA');
        expect(cssToAssColor('&H00ffffff')).toBe('&H00FFFFFF');
      });

      it('trims leading and trailing whitespace before conversion', () => {
        expect(cssToAssColor('  #facc15  ')).toBe('&H0015CCFA');
        expect(cssToAssColor('\t#fc0\n')).toBe('&H0000CCFF');
        expect(cssToAssColor('  &H0015CCFA  ')).toBe('&H0015CCFA');
      });

      it('safely falls back to defaultAss on boundary, malformed, or non-hex inputs', () => {
        const malformedInputs = [
          '',
          '   ',
          '#',
          '##',
          '#1',
          '#12',
          '#1234',
          '#12345',
          '#1234567',
          '#12345678', // 8-digit hex with alpha
          '#gggggg',
          '#xyz123',
          'rgb(250, 204, 21)',
          'hsl(48, 96%, 53%)',
          'transparent',
          'currentcolor',
          'invalid_color_string',
        ];

        for (const input of malformedInputs) {
          expect(cssToAssColor(input)).toBe('&H0000D7FF');
        }
      });

      it('respects custom defaultAss argument when input is invalid', () => {
        const customFallback = '&H00DDEEFF';
        expect(cssToAssColor('', customFallback)).toBe(customFallback);
        expect(cssToAssColor('#invalid', customFallback)).toBe(customFallback);
        expect(cssToAssColor('not-a-color', customFallback)).toBe(customFallback);
      });
    });

    describe('3.3 resetThemeDefaults Edge Cases & State Convergence', () => {
      it('resetThemeDefaults resets custom colors, font scale, and sync mode without resetting selected preset', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="tape_studio_70s">{children}</AppThemeProvider>
          ),
        });

        // Set non-default values
        act(() => {
          result.current.setCustomSungColor('#123456');
          result.current.setCustomUnsungColor('#654321');
          result.current.setFontSizeScale(1.8);
          result.current.setSyncMode('line');
        });

        expect(result.current.customSungColor).toBe('#123456');
        expect(result.current.customUnsungColor).toBe('#654321');
        expect(result.current.fontSizeScale).toBe(1.8);
        expect(result.current.syncMode).toBe('line');

        // Reset
        act(() => {
          result.current.resetThemeDefaults();
        });

        expect(result.current.customSungColor).toBeNull();
        expect(result.current.customUnsungColor).toBeNull();
        expect(result.current.fontSizeScale).toBe(1.0);
        expect(result.current.syncMode).toBe('word');

        // Selected stage preset must remain tape_70s
        expect(result.current.selectedTheme.id).toBe('tape_70s');
        expect(result.current.activeSungColor).toBe(result.current.selectedTheme.previewSung);
        expect(result.current.activeUnsungColor).toBe(result.current.selectedTheme.previewUnsung);
      });

      it('repeated idempotent calls to resetThemeDefaults produce no adverse mutations', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
          ),
        });

        for (let i = 0; i < 3; i++) {
          act(() => {
            result.current.resetThemeDefaults();
          });
          expect(result.current.customSungColor).toBeNull();
          expect(result.current.customUnsungColor).toBeNull();
          expect(result.current.fontSizeScale).toBe(1.0);
          expect(result.current.syncMode).toBe('word');
        }
      });
    });

    describe('3.4 Root DOM Variable & Attribute Synchronization', () => {
      it('synchronizes all stage variables and dataset attributes to document.documentElement', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => (
            <AppThemeProvider initialThemeId="clean_paper">{children}</AppThemeProvider>
          ),
        });

        expect(document.documentElement.getAttribute('data-stage-preset')).toBe('clean_paper');
        expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');
        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1');

        act(() => {
          result.current.setFontSizeScale(1.5);
          result.current.setSyncMode('line');
          result.current.setCustomSungColor('#ff1122');
        });

        expect(document.documentElement.getAttribute('data-sync-mode')).toBe('line');
        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1.5');
        expect(document.documentElement.style.getPropertyValue('--karaoke-sung-color')).toBe(
          '#ff1122'
        );
      });
    });
  });

  // =========================================================================
  // Target 4: LyricDisplay.tsx White-Box Hardening
  // =========================================================================
  describe('Target 4: LyricDisplay.tsx White-Box Hardening', () => {
    describe('4.1 Stage Font Resolution Fallback Hierarchy', () => {
      it('Case A: explicit fontFamily prop takes highest priority over preset font and CSS variable', () => {
        const punkPreset = THEMES.find((t) => t.id === 'punk_diy')!;
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={punkPreset}
            fontFamily="VT323, monospace"
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily).toBe('VT323, monospace');
      });

      it('Case B: undefined fontFamily prop falls back to selectedTheme.fontFamily', () => {
        const tapePreset = THEMES.find((t) => t.id === 'tape_70s')!;
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={tapePreset}
            fontFamily={undefined}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily.replace(/"/g, "'")).toBe(
          tapePreset.fontFamily!.replace(/"/g, "'")
        );
      });

      it('Case C: undefined fontFamily prop and undefined selectedTheme falls back to var(--karaoke-font-family, sans-serif)', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={undefined}
            fontFamily={undefined}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily).toBe('var(--karaoke-font-family, sans-serif)');
      });

      it('Case D: empty string fontFamily prop falls back to selectedTheme.fontFamily', () => {
        const crtPreset = THEMES.find((t) => t.id === 'crt_ktv')!;
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={crtPreset}
            fontFamily=""
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily.replace(/"/g, "'")).toBe(
          crtPreset.fontFamily!.replace(/"/g, "'")
        );
      });

      it('Case E: empty string selectedTheme.fontFamily and undefined fontFamily prop falls back to CSS variable', () => {
        const customEmptyFontTheme: VisualTheme = {
          ...THEMES[0],
          fontFamily: '',
        };

        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={customEmptyFontTheme}
            fontFamily={undefined}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily).toBe('var(--karaoke-font-family, sans-serif)');
      });

      it('applies stage font family consistently to upcoming line and instrumental gap countdown', () => {
        const punkPreset = THEMES.find((t) => t.id === 'punk_diy')!;
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            selectedTheme={punkPreset}
          />
        );

        const upcomingLine = screen.getByTestId('upcoming-lyrics-line');
        expect(upcomingLine.style.fontFamily.replace(/"/g, "'")).toBe(
          punkPreset.fontFamily!.replace(/"/g, "'")
        );
      });
    });

    describe('4.2 Extreme Font Size Scales & Clamping', () => {
      it('clamps upcoming next-line font scale to minimum 0.7em at micro scale (0.1x)', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            fontSizeScale={0.1}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        const upcomingLine = screen.getByTestId('upcoming-lyrics-line');

        expect(activeLine.style.fontSize).toBe('0.1em');
        // Math.max(0.7, 0.1 * 0.75) = 0.7em
        expect(upcomingLine.style.fontSize).toBe('0.7em');
      });

      it('clamps upcoming next-line font scale to minimum 0.7em at zero scale (0.0x)', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            fontSizeScale={0}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        const upcomingLine = screen.getByTestId('upcoming-lyrics-line');

        expect(activeLine.style.fontSize).toBe('0em');
        expect(upcomingLine.style.fontSize).toBe('0.7em');
      });

      it('scales upcoming next-line proportionally at macro scale (3.5x)', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            isPlaying={true}
            fontSizeScale={3.5}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        const upcomingLine = screen.getByTestId('upcoming-lyrics-line');

        expect(activeLine.style.fontSize).toBe('3.5em');
        // Math.max(0.7, 3.5 * 0.75) = 2.625em
        expect(upcomingLine.style.fontSize).toBe('2.625em');
      });
    });

    describe('4.3 Boundary Lyric Fixtures & Duet Singer Normalization', () => {
      it('renders empty lyric lines list without crashing or throwing errors', () => {
        render(<LyricDisplay lines={[]} currentTime={0} isPlaying={false} />);

        expect(screen.getByTestId('lyric-display-stage')).toBeInTheDocument();
      });

      it('renders line-level fallback text when line has empty words array', () => {
        const lineWithoutWords: LyricLine[] = [
          {
            id: 1,
            start_time: 1.0,
            end_time: 4.0,
            text: 'Line with no sub-word breakdown',
            words: [],
          },
        ];

        render(
          <LyricDisplay
            lines={lineWithoutWords}
            currentTime={2.0}
            isPlaying={true}
            themeSungColor="#facc15"
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine).toHaveTextContent('Line with no sub-word breakdown');
      });

      it('normalizes duet singer roles defensively (partner, unison, duet, all, and unknown strings)', () => {
        const variedSingers: LyricLine[] = [
          {
            id: 1,
            start_time: 1.0,
            end_time: 2.0,
            text: 'Partner line',
            words: [],
            singer: 'partner' as unknown as LyricLine['singer'],
          },
          {
            id: 2,
            start_time: 3.0,
            end_time: 4.0,
            text: 'Unison line',
            words: [],
            singer: 'unison' as unknown as LyricLine['singer'],
          },
          {
            id: 3,
            start_time: 5.0,
            end_time: 6.0,
            text: 'Unknown role',
            words: [],
            singer: 'guest_singer' as unknown as LyricLine['singer'],
          },
        ];

        const { rerender } = render(
          <LyricDisplay
            lines={variedSingers}
            currentTime={1.5}
            isPlaying={true}
            singer2SungColor="#ec4899"
          />
        );

        // 'partner' normalizes to 'singer2'
        expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'singer2');

        // 'unison' normalizes to 'both'
        rerender(
          <LyricDisplay
            lines={variedSingers}
            currentTime={3.5}
            isPlaying={true}
            bothSungColor="#10b981"
          />
        );
        expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'both');

        // 'guest_singer' safely falls back to 'singer1'
        rerender(<LyricDisplay lines={variedSingers} currentTime={5.5} isPlaying={true} />);
        expect(screen.getByTestId('active-singer-badge')).toHaveAttribute('data-singer', 'singer1');
      });

      it('keyboard shortcut F toggles Fullscreen stage mode and ignores input field keystrokes', () => {
        render(
          <div>
            <input data-testid="test-input" type="text" />
            <LyricDisplay lines={sampleLyricLines} currentTime={2.0} isPlaying={false} />
          </div>
        );

        const stage = screen.getByTestId('lyric-display-stage');
        expect(stage.getAttribute('data-fullscreen')).toBe('false');

        // Keystroke inside input must NOT toggle fullscreen
        const input = screen.getByTestId('test-input');
        input.focus();
        fireEvent.keyDown(input, { key: 'f' });
        expect(stage.getAttribute('data-fullscreen')).toBe('false');

        // Global keystroke on window toggles fullscreen
        fireEvent.keyDown(window, { key: 'f' });
        expect(stage.getAttribute('data-fullscreen')).toBe('true');

        // Escape exits fullscreen
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(stage.getAttribute('data-fullscreen')).toBe('false');
      });
    });
  });

  // =========================================================================
  // Target 5: Backend & Export Pipeline Alignment Hardening
  // =========================================================================
  describe('Target 5: Backend & Export Pipeline Alignment Hardening', () => {
    describe('5.1 ExportSubtitleSection URL Construction with Boundary Values', () => {
      it('encodes shorthand 3-digit hex custom colors into ASS export request URL', async () => {
        render(
          <AppThemeProvider initialThemeId="punk_diy">
            <ExportSubtitleSection
              project={mockProjectState}
              selectedTheme={THEMES.find((t) => t.id === 'punk_diy')!}
              primaryColor="#fc0"
              secondaryColor="#00f"
              fontSizeScale={1.25}
              syncMode="word"
            />
          </AppThemeProvider>
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('theme_id=punk_diy'));
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('primary_color=%23fc0'));
        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('secondary_color=%2300f')
        );
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('font_size_scale=1.25'));
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('sync_mode=word'));
      });

      it('passes line sync_mode parameter in ASS export request URL', async () => {
        render(
          <AppThemeProvider initialThemeId="clean_paper">
            <ExportSubtitleSection
              project={mockProjectState}
              selectedTheme={THEMES.find((t) => t.id === 'clean_paper')!}
              syncMode="line"
            />
          </AppThemeProvider>
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('theme_id=clean_paper'));
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('sync_mode=line'));
      });

      it('preserves extreme font_size_scale precision in export request URL', async () => {
        render(
          <AppThemeProvider initialThemeId="tape_studio_70s">
            <ExportSubtitleSection
              project={mockProjectState}
              selectedTheme={THEMES.find((t) => t.id === 'tape_70s')!}
              fontSizeScale={2.5}
              syncMode="word"
            />
          </AppThemeProvider>
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('font_size_scale=2.5'));
      });

      it('passes 9:16 vertical shorts aspect ratio in export request URL', async () => {
        render(
          <AppThemeProvider initialThemeId="dive_bar_crt">
            <ExportSubtitleSection
              project={mockProjectState}
              selectedTheme={THEMES.find((t) => t.id === 'crt_ktv')!}
              aspectRatio="9:16"
            />
          </AppThemeProvider>
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('aspect_ratio=9%3A16'));
      });
    });

    describe('5.2 Video Render Payload Construction via ExportModal', () => {
      it('passes style_config with matching theme_id, custom colors, and sync_mode in render POST payload', async () => {
        render(
          <AppThemeProvider initialThemeId="dive_bar_crt">
            <ExportModal
              isOpen={true}
              onClose={vi.fn()}
              project={mockProjectState}
              selectedTheme={THEMES.find((t) => t.id === 'crt_ktv')!}
              primaryColor="#00ffee"
              secondaryColor="#eeff00"
              fontSizeScale={1.5}
              syncMode="line"
            />
          </AppThemeProvider>
        );

        // Click Start Video Render button
        const renderBtn = screen.getByRole('button', { name: /start video render/i });
        await act(async () => {
          fireEvent.click(renderBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"theme_id":"crt_ktv"'),
          })
        );
        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"primary_color":"#00ffee"'),
          })
        );
        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"secondary_color":"#eeff00"'),
          })
        );
        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"font_size_scale":1.5'),
          })
        );
        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"sync_mode":"line"'),
          })
        );
      });
    });

    describe('5.3 Parity Verification with Backend ass_generator VISUAL_THEMES', () => {
      it('verifies all 8 presets in THEMES strictly adhere to backend ass_generator color and typography contracts', () => {
        const expectedThemes: Record<string, { font: string; sung: string; unsung: string }> = {
          punk_diy: {
            font: "'Impact', 'Arial Black', sans-serif",
            sung: '#facc15',
            unsung: '#f5f5f5',
          },
          tape_70s: { font: "'Georgia', serif", sung: '#f59e0b', unsung: '#fef3c7' },
          crt_ktv: { font: "'VT323', monospace", sung: '#22c55e', unsung: '#86efac' },
          clean_paper: {
            font: "'Space Grotesk', 'Helvetica Neue', sans-serif",
            sung: '#dc2626',
            unsung: '#111111',
          },
          modern_gold: { font: 'Montserrat, sans-serif', sung: '#fbbf24', unsung: '#ffffff' },
          cyber_cyan: { font: 'Montserrat, sans-serif', sung: '#06b6d4', unsung: '#ffffff' },
          neon_pink: { font: 'Montserrat, sans-serif', sung: '#ec4899', unsung: '#ffffff' },
          classic_ktv: { font: 'Montserrat, sans-serif', sung: '#facc15', unsung: '#ffffff' },
        };

        for (const [id, expected] of Object.entries(expectedThemes)) {
          const theme = THEMES.find((t) => t.id === id);
          expect(theme).toBeDefined();
          expect(theme?.previewSung.toLowerCase()).toBe(expected.sung.toLowerCase());
          expect(theme?.previewUnsung.toLowerCase()).toBe(expected.unsung.toLowerCase());
          if (expected.font) {
            expect(theme?.fontFamily).toBe(expected.font);
          }
        }
      });
    });
  });
});
