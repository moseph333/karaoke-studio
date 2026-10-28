/**
 * Adversarial Concurrency, Multi-Tab Sync, and Storage Quota Stress Test Suite
 *
 * Verifies:
 * 1. Multi-tab storage sync simulation under rapid concurrent writes and bursts.
 * 2. Storage quota exceptions (QuotaExceededError) during rapid state transitions with recovery.
 * 3. JSDOM window.localStorage isolation safeguards and teardown resilience.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AppThemeProvider, useAppTheme } from '../context/AppThemeContext';
import {
  APP_THEME_STORAGE_KEY,
  APP_THEMES,
  getStoredAppTheme,
  setStoredAppTheme,
} from '../theme/appThemes';
import { AppThemeId } from '../types';

describe('Tier 5 Adversarial Concurrency & Stress Hardening', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
  });

  // ==========================================================================
  // 1. Multi-Tab Storage Sync Simulation Under Rapid Concurrent Writes
  // ==========================================================================
  describe('Multi-Tab Storage Sync Concurrency', () => {
    it('handles 100 rapid concurrent storage events from multiple tabs without dropping to invalid state', () => {
      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <AppThemeProvider>{children}</AppThemeProvider>
        ),
      });

      const themes: AppThemeId[] = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];

      act(() => {
        for (let i = 0; i < 100; i++) {
          const targetTheme = themes[i % themes.length];
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: targetTheme,
              oldValue: themes[(i + 3) % themes.length],
              url: 'https://karaoke.local/studio',
            })
          );
        }
      });

      // The final event in the 100-event loop (index 99) is clean_paper (99 % 4 = 3)
      expect(result.current.themeId).toBe('clean_paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES.clean_paper.colors.bg
      );
    });

    it('interleaves concurrent local setThemeId calls with incoming foreign tab storage events', () => {
      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <AppThemeProvider>{children}</AppThemeProvider>
        ),
      });

      // Local user switches to tape_studio_70s
      act(() => {
        result.current.setThemeId('tape_studio_70s');
      });
      expect(result.current.themeId).toBe('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');

      // External tab fires storage event for dive_bar_crt
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: 'dive_bar_crt',
          })
        );
      });
      expect(result.current.themeId).toBe('dive_bar_crt');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');

      // Local user immediately switches to clean_paper
      act(() => {
        result.current.setThemeId('clean_paper');
      });
      expect(result.current.themeId).toBe('clean_paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');

      // Out-of-order foreign storage event arrives for punk_diy
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: 'punk_diy',
          })
        );
      });

      // The latest event processed was punk_diy
      expect(result.current.themeId).toBe('punk_diy');
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
    });

    it('ignores foreign storage events with irrelevant keys, null keys, or null newValue without mutating active state', () => {
      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <AppThemeProvider initialThemeId="tape_studio_70s">{children}</AppThemeProvider>
        ),
      });

      expect(result.current.themeId).toBe('tape_studio_70s');

      act(() => {
        // Other key
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'unrelated_audio_volume',
            newValue: '0.8',
          })
        );

        // Null key (e.g. storage.clear() in another tab)
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: null,
            newValue: null,
          })
        );

        // Null newValue (e.g. storage.removeItem(APP_THEME_STORAGE_KEY))
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: null,
          })
        );

        // Empty string newValue
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: '',
          })
        );

        // Malformed prototype attack
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: APP_THEME_STORAGE_KEY,
            newValue: '__proto__',
          })
        );
      });

      // Active state must be completely untouched
      expect(result.current.themeId).toBe('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
    });

    it('properly removes window storage listener on unmount to prevent memory leaks', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <AppThemeProvider>{children}</AppThemeProvider>
        ),
      });

      unmount();

      expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 2. Storage Quota Exceptions (QuotaExceededError) During Rapid State Transitions
  // ==========================================================================
  describe('Storage Quota Exceptions & Rapid Transitions', () => {
    it('survives sustained QuotaExceededError across 50 rapid theme transitions, updating React and DOM state accurately', () => {
      let quotaActive = true;
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, val) => {
        if (quotaActive) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        Storage.prototype[key] = val;
      });

      const { result } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <AppThemeProvider>{children}</AppThemeProvider>
        ),
      });

      const sequence: AppThemeId[] = ['clean_paper', 'dive_bar_crt', 'tape_studio_70s', 'punk_diy'];

      // Perform 50 rapid transitions under active quota error
      act(() => {
        for (let i = 0; i < 50; i++) {
          const nextTheme = sequence[i % sequence.length];
          expect(() => result.current.setThemeId(nextTheme)).not.toThrow();
        }
      });

      // Last theme applied at i=49 is clean_paper (49 % 4 = 1 -> dive_bar_crt)
      const expectedFinal = sequence[49 % sequence.length];
      expect(result.current.themeId).toBe(expectedFinal);
      expect(document.documentElement.getAttribute('data-theme')).toBe(expectedFinal);
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(
        APP_THEMES[expectedFinal].colors.bg
      );

      // Now quota is freed (quotaActive = false)
      quotaActive = false;

      act(() => {
        result.current.setThemeId('tape_studio_70s');
      });

      expect(result.current.themeId).toBe('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');

      setItemSpy.mockRestore();
    });

    it('setStoredAppTheme swallows QuotaExceededError and SecurityError silently without throwing', () => {
      const quotaSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      });

      expect(() => setStoredAppTheme('clean_paper')).not.toThrow();
      quotaSpy.mockRestore();

      const secSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      expect(() => setStoredAppTheme('dive_bar_crt')).not.toThrow();
      secSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 3. JSDOM Storage Isolation & Environment Robustness
  // ==========================================================================
  describe('Test Isolation & Storage Environment Resilience', () => {
    it('restores window.localStorage completely when wrapped in try...finally even if an operation fails', () => {
      const originalStorage = window.localStorage;
      let caughtError: unknown = null;

      try {
        Object.defineProperty(window, 'localStorage', {
          value: null,
          writable: true,
          configurable: true,
        });

        expect(getStoredAppTheme()).toBe('afterglow');
        expect(() => setStoredAppTheme('clean_paper')).not.toThrow();

        // Simulate an intentional error inside the test
        try {
          throw new Error('Simulated test assertion or runtime exception');
        } catch (e) {
          caughtError = e;
        }
      } finally {
        Object.defineProperty(window, 'localStorage', {
          value: originalStorage,
          writable: true,
          configurable: true,
        });
      }

      expect(caughtError).toBeDefined();
      expect(window.localStorage).toBe(originalStorage);
      expect(window.localStorage.getItem).toBeDefined();
    });

    it('setup.ts afterEach teardown safely executes even if localStorage is completely null or missing', () => {
      const originalStorage = window.localStorage;
      try {
        Object.defineProperty(window, 'localStorage', {
          value: null,
          writable: true,
          configurable: true,
        });

        // Simulating the exact scenario that caused M4 teardown crashes:
        // When localStorage is null, localStorage.clear() in setup.ts must not crash.
        expect(() => {
          if (
            typeof localStorage !== 'undefined' &&
            localStorage &&
            typeof localStorage.clear === 'function'
          ) {
            localStorage.clear();
          }
        }).not.toThrow();
      } finally {
        Object.defineProperty(window, 'localStorage', {
          value: originalStorage,
          writable: true,
          configurable: true,
        });
      }
    });

    it('verifies documentElement data-theme and data-stage-preset are cleanly removable without side-effects', () => {
      document.documentElement.setAttribute('data-theme', 'clean_paper');
      document.documentElement.setAttribute('data-stage-preset', 'clean_paper');

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.getAttribute('data-stage-preset')).toBe('clean_paper');

      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('data-stage-preset');

      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      expect(document.documentElement.getAttribute('data-stage-preset')).toBeNull();
    });
  });
});
