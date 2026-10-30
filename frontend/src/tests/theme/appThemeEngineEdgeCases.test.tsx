/**
 * Milestone 1 Empirical Stress Test Suite (Challenger 1)
 *
 * Rigorous adversarial stress testing of the App Theme Engine:
 * 1. Prototype Property & Malicious Storage Key Injection (toString, valueOf, constructor, etc.)
 * 2. Corrupted, Empty, and Arbitrary Storage Values
 * 3. Multi-Tab Storage Event Synchronization Edge Cases
 * 4. Rapid Concurrent / Successive Theme Switching & Atomic DOM Consistency
 * 5. Hostile & Throwing LocalStorage Environments (SecurityError, QuotaExceededError, property traps)
 * 6. Resilient Fallback Execution Outside Provider & Direct DOM Manipulation
 * 7. Zero-FOUC Inline Pre-render Script Emulation under Hostile Storage States
 */

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  AppThemeProvider,
  useAppTheme,
  getStoredAppTheme,
  setStoredAppTheme,
} from '../../context/AppThemeContext';
import {
  APP_THEMES,
  DEFAULT_APP_THEME_ID,
  APP_THEME_LIST,
  isAppThemeId,
  getAppTheme,
  APP_THEME_STORAGE_KEY,
} from '../../theme/appThemes';
import { AppThemeId } from '../../types';
import { runIndexHtmlBootScript } from '../helpers/bootScriptUtils';

describe('AppThemeEngine Stress Testing (Milestone 1 Challenger 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Stress Suite 1: Prototype Property & Malicious Storage Key Injection
  // =========================================================================
  describe('Stress Suite 1: Prototype Property & Malicious Storage Key Injection', () => {
    const protoKeys = [
      'toString',
      'valueOf',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
    ];

    it('rejects prototype property names in isAppThemeId type guard', () => {
      for (const key of protoKeys) {
        expect(
          isAppThemeId(key),
          `isAppThemeId("${key}") returned true! Prototype property was treated as valid theme ID.`
        ).toBe(false);
      }
    });

    it('safely falls back to default theme when getAppTheme is called with prototype properties', () => {
      for (const key of protoKeys) {
        const theme = getAppTheme(key);
        expect(theme).toBeDefined();
        expect(theme.id).toBe(DEFAULT_APP_THEME_ID);
        expect(theme.colors).toBeDefined();
        expect(theme.cssVariables).toBeDefined();
      }
    });

    it('safely falls back to default theme when localStorage is pre-seeded with prototype property names', () => {
      for (const key of protoKeys) {
        localStorage.setItem(APP_THEME_STORAGE_KEY, key);
        expect(getStoredAppTheme()).toBe(DEFAULT_APP_THEME_ID);
      }
    });

    it('renders <AppThemeProvider> without throwing when localStorage contains "toString"', () => {
      localStorage.setItem(APP_THEME_STORAGE_KEY, 'toString');

      const TestComponent = () => {
        const { currentThemeId, theme } = useAppTheme();
        return (
          <div>
            <span data-testid="theme-id">{currentThemeId}</span>
            <span data-testid="theme-name">{theme.name}</span>
          </div>
        );
      };

      expect(() => {
        render(
          <AppThemeProvider>
            <TestComponent />
          </AppThemeProvider>
        );
      }).not.toThrow();

      expect(screen.getByTestId('theme-id')).toHaveTextContent(DEFAULT_APP_THEME_ID);
      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
    });

    it('survives multi-tab storage event containing "toString" or prototype property values', () => {
      const TestConsumer = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="current-theme">{currentThemeId}</span>;
      };

      render(
        <AppThemeProvider>
          <TestConsumer />
        </AppThemeProvider>
      );

      for (const key of protoKeys) {
        expect(() => {
          act(() => {
            window.dispatchEvent(
              new StorageEvent('storage', {
                key: APP_THEME_STORAGE_KEY,
                newValue: key,
              })
            );
          });
        }).not.toThrow();

        // Must remain on valid theme, never corrupt to prototype property
        expect(screen.getByTestId('current-theme')).toHaveTextContent(DEFAULT_APP_THEME_ID);
        expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
      }
    });

    it('survives calling setTheme with prototype property names without DOM or React crash', () => {
      const Mutator = () => {
        const { currentThemeId, setTheme } = useAppTheme();
        return (
          <div>
            <span data-testid="theme-display">{currentThemeId}</span>
            <button onClick={() => setTheme('toString' as unknown as AppThemeId)}>
              Set Prototype
            </button>
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <Mutator />
        </AppThemeProvider>
      );

      expect(() => {
        act(() => {
          screen.getByRole('button', { name: 'Set Prototype' }).click();
        });
      }).not.toThrow();

      expect(screen.getByTestId('theme-display')).toHaveTextContent(DEFAULT_APP_THEME_ID);
      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
    });
  });

  // =========================================================================
  // Stress Suite 2: Corrupted, Empty, and Arbitrary Storage Values
  // =========================================================================
  describe('Stress Suite 2: Corrupted, Empty, and Arbitrary Storage Values', () => {
    const maliciousValues = [
      '',
      '   ',
      '<script>alert("xss")</script>',
      '"><img src=x onerror=alert(1)>',
      '{"id":"punk_diy"}',
      '{"__proto__":{"polluted":true}}',
      '[object Object]',
      'undefined',
      'null',
      'NaN',
      'PUNK_DIY',
      'punk_diy ',
      ' punk_diy',
      'punk_diy\n',
      'classic_ktv', // valid stage preset, but NOT app theme id
      'tape_70s', // valid stage preset, but NOT app theme id
      'modern_gold', // legacy preset
      'cyber_cyan', // legacy preset
      'neon_pink', // legacy preset
      'SELECT * FROM themes',
      '..%2F..%2Fetc%2Fpasswd',
      'data:text/html;base64,PHNjcmlwdD4=',
      'rgba(0,0,0,1)',
      '#ffffff',
    ];

    it('ensures getStoredAppTheme sanitizes all malicious and malformed storage values', () => {
      for (const val of maliciousValues) {
        localStorage.setItem(APP_THEME_STORAGE_KEY, val);
        const resolved = getStoredAppTheme();
        expect(
          resolved,
          `Failed to sanitize stored value: "${val}", resolved to "${resolved}"`
        ).toBe(DEFAULT_APP_THEME_ID);
      }
    });

    it('boots cleanly and applies default theme for all malicious storage values', () => {
      const Consumer = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="active-id">{currentThemeId}</span>;
      };

      for (const val of maliciousValues.slice(0, 10)) {
        localStorage.setItem(APP_THEME_STORAGE_KEY, val);
        const { unmount } = render(
          <AppThemeProvider>
            <Consumer />
          </AppThemeProvider>
        );

        expect(screen.getByTestId('active-id')).toHaveTextContent(DEFAULT_APP_THEME_ID);
        expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
        unmount();
      }
    });

    it('safely handles non-string or odd inputs passed into isAppThemeId and getAppTheme', () => {
      const oddInputs = [
        null,
        undefined,
        0,
        123,
        true,
        false,
        {},
        [],
        () => {},
        Symbol('theme'),
        BigInt(42),
      ];

      for (const input of oddInputs) {
        expect(isAppThemeId(input)).toBe(false);
        const theme = getAppTheme(input as unknown as AppThemeId);
        expect(theme.id).toBe(DEFAULT_APP_THEME_ID);
      }
    });
  });

  // =========================================================================
  // Stress Suite 3: Multi-Tab Storage Event Synchronization Edge Cases
  // =========================================================================
  describe('Stress Suite 3: Multi-Tab Storage Event Synchronization Edge Cases', () => {
    const MultiTabHarness = () => {
      const { currentThemeId, theme } = useAppTheme();
      return (
        <div>
          <span data-testid="tab-theme-id">{currentThemeId}</span>
          <span data-testid="tab-theme-bg">{theme.colors.bg}</span>
        </div>
      );
    };

    it('synchronizes all valid themes across browser tabs via storage events', () => {
      render(
        <AppThemeProvider>
          <MultiTabHarness />
        </AppThemeProvider>
      );

      const targets: AppThemeId[] = [
        'tape_studio_70s',
        'dive_bar_crt',
        'clean_paper',
        'punk_diy',
        'afterglow',
      ];

      for (const target of targets) {
        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: target,
            })
          );
        });

        expect(screen.getByTestId('tab-theme-id')).toHaveTextContent(target);
        expect(screen.getByTestId('tab-theme-bg')).toHaveTextContent(APP_THEMES[target].colors.bg);
        expect(document.documentElement.getAttribute('data-theme')).toBe(target);
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
          APP_THEMES[target].colors.bg
        );
      }
    });

    it('ignores storage events for irrelevant keys and preserves current active theme', () => {
      render(
        <AppThemeProvider initialThemeId="tape_studio_70s">
          <MultiTabHarness />
        </AppThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'unrelated_key',
            newValue: 'clean_paper',
          })
        );
      });

      expect(screen.getByTestId('tab-theme-id')).toHaveTextContent('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
    });

    it('handles storage events with null or empty newValue without errors', () => {
      render(
        <AppThemeProvider initialThemeId="dive_bar_crt">
          <MultiTabHarness />
        </AppThemeProvider>
      );

      expect(() => {
        act(() => {
          // Emulate another tab calling localStorage.clear()
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: null,
            })
          );
          // Emulate another tab writing empty string
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: '',
            })
          );
        });
      }).not.toThrow();

      // State remains safe and resilient
      expect(screen.getByTestId('tab-theme-id')).toHaveTextContent('dive_bar_crt');
    });

    it('unregisters storage listener on unmount to prevent memory leaks', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <AppThemeProvider>
          <MultiTabHarness />
        </AppThemeProvider>
      );

      unmount();
      expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));
    });
  });

  // =========================================================================
  // Stress Suite 4: Rapid Successive & Concurrent Theme Switching (Atomic Consistency)
  // =========================================================================
  describe('Stress Suite 4: Rapid Successive & Concurrent Theme Switching', () => {
    const RapidSwitchHarness = () => {
      const { currentThemeId, setTheme, resetToDefault } = useAppTheme();
      return (
        <div>
          <span data-testid="rapid-active">{currentThemeId}</span>
          <button data-testid="btn-punk" onClick={() => setTheme('punk_diy')}>
            Punk
          </button>
          <button data-testid="btn-tape" onClick={() => setTheme('tape_studio_70s')}>
            Tape
          </button>
          <button data-testid="btn-crt" onClick={() => setTheme('dive_bar_crt')}>
            CRT
          </button>
          <button data-testid="btn-paper" onClick={() => setTheme('clean_paper')}>
            Paper
          </button>
          <button data-testid="btn-reset" onClick={resetToDefault}>
            Reset
          </button>
        </div>
      );
    };

    it('maintains 100% atomic consistency across 120 rapid successive theme changes', () => {
      render(
        <AppThemeProvider>
          <RapidSwitchHarness />
        </AppThemeProvider>
      );

      const buttons = [
        screen.getByTestId('btn-punk'),
        screen.getByTestId('btn-tape'),
        screen.getByTestId('btn-crt'),
        screen.getByTestId('btn-paper'),
      ];
      // Execute 120 rapid switches in an act block
      act(() => {
        for (let i = 0; i < 120; i++) {
          const idx = i % buttons.length;
          buttons[idx].click();
        }
      });

      // The 120th switch (index 119) is index 3: clean_paper
      const expectedThemeId = 'clean_paper';
      const expectedTheme = APP_THEMES[expectedThemeId];

      expect(screen.getByTestId('rapid-active')).toHaveTextContent(expectedThemeId);
      expect(document.documentElement.getAttribute('data-theme')).toBe(expectedThemeId);

      // Verify complete atomic consistency of all primary --theme-* custom properties
      const rootStyle = document.documentElement.style;
      expect(rootStyle.getPropertyValue('--theme-bg')).toBe(expectedTheme.colors.bg);
      expect(rootStyle.getPropertyValue('--theme-surface')).toBe(expectedTheme.colors.surface);
      expect(rootStyle.getPropertyValue('--theme-border')).toBe(expectedTheme.colors.border);
      expect(rootStyle.getPropertyValue('--theme-text')).toBe(expectedTheme.colors.text);
      expect(rootStyle.getPropertyValue('--theme-accent')).toBe(expectedTheme.colors.accent);
      expect(rootStyle.getPropertyValue('--theme-font-heading')).toBe(
        expectedTheme.typography.heading
      );
      expect(rootStyle.getPropertyValue('--theme-font-body')).toBe(expectedTheme.typography.body);
      expect(rootStyle.getPropertyValue('--theme-radius-md')).toBe(expectedTheme.geometry.radiusMd);
      expect(rootStyle.getPropertyValue('--theme-shadow-md')).toBe(expectedTheme.shadows.md);
      expect(rootStyle.getPropertyValue('--karaoke-font-family')).toBe(
        expectedTheme.typography.karaoke
      );

      // Verify localStorage is in sync
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe(expectedThemeId);
    });

    it('interleaves valid and invalid setTheme calls without state corruption', () => {
      render(
        <AppThemeProvider>
          <RapidSwitchHarness />
        </AppThemeProvider>
      );

      const ConsumerWithSetter = () => {
        const { setTheme } = useAppTheme();
        return (
          <div>
            <button
              data-testid="btn-interleave"
              onClick={() => {
                setTheme('tape_studio_70s');
                setTheme('corrupt_theme_1' as unknown as AppThemeId);
                setTheme('dive_bar_crt');
                setTheme('' as unknown as AppThemeId);
                setTheme('clean_paper');
                setTheme(null as unknown as AppThemeId);
              }}
            >
              Interleave
            </button>
          </div>
        );
      };

      const { unmount } = render(
        <AppThemeProvider>
          <ConsumerWithSetter />
          <RapidSwitchHarness />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByTestId('btn-interleave').click();
      });

      // Passing null falls back safely to default theme (afterglow) without crashing
      const current = document.documentElement.getAttribute('data-theme');
      expect([DEFAULT_APP_THEME_ID, 'punk_diy', 'clean_paper']).toContain(current);
      unmount();
    });

    it('synchronizes multiple independent subscriber components simultaneously', () => {
      const SubscriberA = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="sub-a">{currentThemeId}</span>;
      };
      const SubscriberB = () => {
        const { theme } = useAppTheme();
        return <span data-testid="sub-b">{theme.id}</span>;
      };
      const Trigger = () => {
        const { setTheme } = useAppTheme();
        return (
          <button data-testid="trigger-btn" onClick={() => setTheme('dive_bar_crt')}>
            Trigger CRT
          </button>
        );
      };

      render(
        <AppThemeProvider>
          <SubscriberA />
          <SubscriberB />
          <Trigger />
        </AppThemeProvider>
      );

      act(() => {
        screen.getByTestId('trigger-btn').click();
      });

      expect(screen.getByTestId('sub-a')).toHaveTextContent('dive_bar_crt');
      expect(screen.getByTestId('sub-b')).toHaveTextContent('dive_bar_crt');
    });
  });

  // =========================================================================
  // Stress Suite 5: Hostile & Throwing LocalStorage Environments
  // =========================================================================
  describe('Stress Suite 5: Hostile & Throwing LocalStorage Environments', () => {
    it('handles localStorage.getItem throwing SecurityError during boot', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      });

      const Consumer = () => {
        const { currentThemeId } = useAppTheme();
        return <span data-testid="security-theme">{currentThemeId}</span>;
      };

      expect(() => {
        render(
          <AppThemeProvider>
            <Consumer />
          </AppThemeProvider>
        );
      }).not.toThrow();

      expect(screen.getByTestId('security-theme')).toHaveTextContent(DEFAULT_APP_THEME_ID);
      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
    });

    it('handles localStorage.setItem throwing QuotaExceededError when switching theme', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });

      const Switcher = () => {
        const { currentThemeId, setTheme } = useAppTheme();
        return (
          <div>
            <span data-testid="quota-theme">{currentThemeId}</span>
            <button onClick={() => setTheme('tape_studio_70s')}>Switch Tape</button>
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <Switcher />
        </AppThemeProvider>
      );

      expect(() => {
        act(() => {
          screen.getByRole('button', { name: 'Switch Tape' }).click();
        });
      }).not.toThrow();

      // UI state and DOM update successfully even if persistent storage threw
      expect(screen.getByTestId('quota-theme')).toHaveTextContent('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES.tape_studio_70s.colors.bg
      );
    });

    it('survives completely missing or undefined window.localStorage property', () => {
      const originalStorage = window.localStorage;
      // Emulate environment where localStorage property access throws
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('Storage disabled by corporate sandbox policy');
        },
      });

      expect(() => {
        const themeId = getStoredAppTheme();
        expect(themeId).toBe(DEFAULT_APP_THEME_ID);
      }).not.toThrow();

      expect(() => {
        setStoredAppTheme('clean_paper');
      }).not.toThrow();

      // Restore original localStorage descriptor
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: originalStorage,
      });
    });
  });

  // =========================================================================
  // Stress Suite 6: Resilient Fallback Execution Outside Provider
  // =========================================================================
  describe('Stress Suite 6: Resilient Fallback Execution Outside Provider', () => {
    const ComponentOutside = () => {
      const {
        themeId,
        currentThemeId,
        theme,
        availableThemes,
        setTheme,
        setThemeId,
        resetToDefault,
      } = useAppTheme();

      const [localClickCount, setLocalClickCount] = useState(0);

      return (
        <div>
          <span data-testid="outside-id">{themeId}</span>
          <span data-testid="outside-current-id">{currentThemeId}</span>
          <span data-testid="outside-theme-name">{theme.name}</span>
          <span data-testid="outside-count">{availableThemes.length}</span>
          <span data-testid="click-counter">{localClickCount}</span>
          <button
            data-testid="outside-btn-set"
            onClick={() => {
              setTheme('dive_bar_crt');
              setLocalClickCount((c) => c + 1);
            }}
          >
            Set Theme
          </button>
          <button
            data-testid="outside-btn-set-id"
            onClick={() => {
              setThemeId('clean_paper');
              setLocalClickCount((c) => c + 1);
            }}
          >
            Set ThemeId
          </button>
          <button
            data-testid="outside-btn-reset"
            onClick={() => {
              resetToDefault();
              setLocalClickCount((c) => c + 1);
            }}
          >
            Reset
          </button>
        </div>
      );
    };

    it('does NOT throw and returns complete AppThemeContextValue contract outside provider', () => {
      render(<ComponentOutside />);

      expect(screen.getByTestId('outside-id')).toHaveTextContent(DEFAULT_APP_THEME_ID);
      expect(screen.getByTestId('outside-current-id')).toHaveTextContent(DEFAULT_APP_THEME_ID);
      expect(screen.getByTestId('outside-theme-name')).toHaveTextContent(
        APP_THEMES[DEFAULT_APP_THEME_ID].name
      );
      expect(screen.getByTestId('outside-count')).toHaveTextContent(String(APP_THEME_LIST.length));
    });

    it('allows mutating DOM attributes and variables via setTheme outside provider without crashing', () => {
      render(<ComponentOutside />);

      act(() => {
        screen.getByTestId('outside-btn-set').click();
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES.dive_bar_crt.colors.bg
      );

      act(() => {
        screen.getByTestId('outside-btn-set-id').click();
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES.clean_paper.colors.bg
      );

      act(() => {
        screen.getByTestId('outside-btn-reset').click();
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES[DEFAULT_APP_THEME_ID].colors.bg
      );
    });

    it('survives rapid component re-renders outside provider while preserving fallback references', () => {
      render(<ComponentOutside />);

      act(() => {
        for (let i = 0; i < 20; i++) {
          screen.getByTestId('outside-btn-reset').click();
        }
      });

      expect(screen.getByTestId('click-counter')).toHaveTextContent('20');
      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
    });
  });

  // =========================================================================
  // Stress Suite 7: Zero-FOUC Inline Pre-render Script Emulation
  // =========================================================================
  describe('Stress Suite 7: Zero-FOUC Inline Pre-render Script Emulation', () => {
    // Executes the synchronous pre-render IIFE shipped in frontend/index.html
    const runPreRenderScript = () => runIndexHtmlBootScript();

    it('sets data-theme="afterglow" on fresh boot with empty localStorage', () => {
      document.documentElement.removeAttribute('data-theme');
      runPreRenderScript();
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });

    it('sets pre-seeded valid theme without delay or error', () => {
      const themes = ['tape_studio_70s', 'dive_bar_crt', 'clean_paper', 'punk_diy'];
      for (const t of themes) {
        localStorage.setItem('karaoke_app_theme', t);
        runPreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe(t);
      }
    });

    it('defaults to afterglow when localStorage holds corrupted or prototype values', () => {
      const hostileValues = ['toString', 'valueOf', 'constructor', '<script>', '', 'invalid'];
      for (const val of hostileValues) {
        localStorage.setItem('karaoke_app_theme', val);
        runPreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
      }
    });

    it('defaults to afterglow when localStorage throws SecurityError in pre-render script', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Access denied');
      });
      runPreRenderScript();
      expect(document.documentElement.getAttribute('data-theme')).toBe('afterglow');
    });
  });
});
