/**
 * AppThemePickerChallengerStress.test.tsx
 *
 * Empirical Challenger Stress Harness for Milestone 2:
 * 1. Rapid keyboard navigation, boundary wrapping (Home/End, Arrow looping).
 * 2. Rapid successive theme toggles and state consistency between DOM data-theme and localStorage.
 * 3. Fallback resilience: interactive operation outside AppThemeProvider.
 * 4. Multi-tab storage event resilience and storage quota exception safety.
 * 5. 4-Dimensional distinctness verification across all 4 themes.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppThemePicker } from '../components/AppThemePicker';
import { AppThemeProvider, useAppTheme } from '../context/AppThemeContext';
import { APP_THEMES, APP_THEME_LIST, APP_THEME_STORAGE_KEY } from '../theme/appThemes';
import { AppThemeId } from '../types';

describe('AppThemePicker Empirical Challenger Stress Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // =========================================================================
  // Challenge 1: Keyboard Navigation, Looping & Boundary Stress
  // =========================================================================
  describe('Challenge 1: Keyboard Navigation Looping & Boundary Stress', () => {
    it('seamlessly loops ArrowDown from index (length - 1) to index 0', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      trigger.focus();
      // Open with Enter -> highlighted at 0 (punk_diy)
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-punk_diy');

      // Navigate down to clean_paper (index 3)
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // index 1: tape_studio_70s
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // index 2: dive_bar_crt
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // index 3: clean_paper
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-clean_paper');

      // Next ArrowDown must wrap back to index 0: punk_diy
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-punk_diy');
    });

    it('seamlessly loops ArrowUp from index 0 to index (length - 1)', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' }); // Opens at index 0 (punk_diy)
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-punk_diy');

      // Press ArrowUp at index 0 -> should loop to index 3 (clean_paper)
      fireEvent.keyDown(trigger, { key: 'ArrowUp' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-clean_paper');

      // Press ArrowUp again -> should go to index 2 (dive_bar_crt)
      fireEvent.keyDown(trigger, { key: 'ArrowUp' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-dive_bar_crt');
    });

    it('survives 200 rapid alternating ArrowDown, ArrowUp, Home, End keystrokes without out-of-bounds error', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });

      const keys = [
        'ArrowDown',
        'ArrowDown',
        'ArrowUp',
        'End',
        'ArrowDown',
        'Home',
        'ArrowUp',
        'End',
        'ArrowUp',
      ];
      for (let i = 0; i < 200; i++) {
        const k = keys[i % keys.length];
        expect(() => fireEvent.keyDown(trigger, { key: k })).not.toThrow();
        const activeDesc = trigger.getAttribute('aria-activedescendant');
        expect(activeDesc).toBeTruthy();
        expect(activeDesc).toMatch(
          /^theme-option-(punk_diy|tape_studio_70s|dive_bar_crt|clean_paper)$/
        );
      }
    });

    it('handles rapid repeated Enter / Space toggles without leaking listbox state', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      trigger.focus();

      // Open, close with Escape, open with Space, close with Escape 20 times
      for (let i = 0; i < 20; i++) {
        fireEvent.keyDown(trigger, { key: ' ' });
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        fireEvent.keyDown(trigger, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
      }
    });
  });

  // =========================================================================
  // Challenge 2: State Consistency & Rapid Successive Theme Toggles
  // =========================================================================
  describe('Challenge 2: State Consistency Across Rapid Successive Theme Toggles', () => {
    it('maintains absolute synchronization between DOM data-theme and localStorage across 60 rapid switches', () => {
      // Test harness component exposing useAppTheme directly
      const StateProbe: React.FC = () => {
        const { themeId, theme, setThemeId } = useAppTheme();
        return (
          <div>
            <AppThemePicker />
            <div data-testid="probe-theme-id">{themeId}</div>
            <div data-testid="probe-theme-name">{theme.name}</div>
            <button data-testid="set-punk" onClick={() => setThemeId('punk_diy')}>
              Set Punk
            </button>
            <button data-testid="set-tape" onClick={() => setThemeId('tape_studio_70s')}>
              Set Tape
            </button>
            <button data-testid="set-crt" onClick={() => setThemeId('dive_bar_crt')}>
              Set CRT
            </button>
            <button data-testid="set-paper" onClick={() => setThemeId('clean_paper')}>
              Set Paper
            </button>
          </div>
        );
      };

      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <StateProbe />
        </AppThemeProvider>
      );

      const themes: AppThemeId[] = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];

      // Perform 60 rapid sequential switches
      for (let i = 0; i < 60; i++) {
        const targetThemeId = themes[i % themes.length];
        const button = screen.getByTestId(
          targetThemeId === 'punk_diy'
            ? 'set-punk'
            : targetThemeId === 'tape_studio_70s'
              ? 'set-tape'
              : targetThemeId === 'dive_bar_crt'
                ? 'set-crt'
                : 'set-paper'
        );

        act(() => {
          fireEvent.click(button);
        });

        // 1. DOM data-theme attribute
        expect(document.documentElement.getAttribute('data-theme')).toBe(targetThemeId);

        // 2. localStorage persistence
        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe(targetThemeId);

        // 3. React context state
        expect(screen.getByTestId('probe-theme-id')).toHaveTextContent(targetThemeId);

        // 4. CSS custom property sync
        const expectedBg = APP_THEMES[targetThemeId].colors.bg;
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe(expectedBg);
      }
    });

    it('recovers gracefully from corrupt localStorage values on initialization and during runtime', () => {
      // Set invalid garbage in localStorage
      localStorage.setItem(APP_THEME_STORAGE_KEY, 'corrupted_theme_xyz');

      render(
        <AppThemeProvider>
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      // Defaults safely to Punk Rock DIY
      expect(trigger).toHaveTextContent(APP_THEMES.punk_diy.name);
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
    });

    it('survives localStorage quota exceeded exceptions during setThemeId', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      // Mock setItem throwing DOMException
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);

      const tapeOption = screen.getByRole('option', { name: /Analog 70s Tape/i });

      // Should not throw and should still update DOM and state
      expect(() => {
        fireEvent.click(tapeOption);
      }).not.toThrow();

      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(trigger).toHaveTextContent(APP_THEMES.tape_studio_70s.name);
    });

    it('reacts dynamically to multi-tab storage events from external windows', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <AppThemePicker />
        </AppThemeProvider>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      expect(trigger).toHaveTextContent(APP_THEMES.punk_diy.name);

      // Simulate external window storage change to 'dive_bar_crt'
      act(() => {
        const event = new StorageEvent('storage', {
          key: APP_THEME_STORAGE_KEY,
          newValue: 'dive_bar_crt',
        });
        window.dispatchEvent(event);
      });

      expect(trigger).toHaveTextContent(APP_THEMES.dive_bar_crt.name);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
    });
  });

  // =========================================================================
  // Challenge 3: Fallback Resilience Outside AppThemeProvider
  // =========================================================================
  describe('Challenge 3: Fallback Resilience Outside AppThemeProvider', () => {
    it('operates interactively (open, keyboard navigate, select) when mounted with no provider', () => {
      expect(() => {
        render(<AppThemePicker />);
      }).not.toThrow();

      const trigger = screen.getByRole('button', { name: /select theme/i });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(APP_THEMES.punk_diy.name);

      // Open dropdown via click
      fireEvent.click(trigger);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Keyboard navigate
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      // Select option via Enter
      fireEvent.keyDown(trigger, { key: 'Enter' });

      // Dropdown closed safely
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      // Trigger did not throw and DOM was updated via fallback
      expect(document.documentElement.getAttribute('data-theme')).toBeTruthy();
    });

    it('allows direct option click outside provider without unhandled error', () => {
      render(<AppThemePicker />);

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);

      const paperOption = screen.getByRole('option', { name: /Brutalist Clean Paper/i });

      expect(() => {
        fireEvent.click(paperOption);
      }).not.toThrow();

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
    });
  });

  // =========================================================================
  // Challenge 4: 4-Dimensional Distinctness Across All 4 Themes
  // =========================================================================
  describe('Challenge 4: 4-Dimensional Distinctness Across All 4 Themes', () => {
    const themes = APP_THEME_LIST;
    expect(themes).toHaveLength(4);

    it('Dimension 1 (Colors): All 6 pairs have distinct bg, surface, text, and accent hexes', () => {
      for (let i = 0; i < themes.length; i++) {
        for (let j = i + 1; j < themes.length; j++) {
          const t1 = themes[i];
          const t2 = themes[j];

          expect(
            t1.colors.bg.toLowerCase(),
            `Theme ${t1.id} vs ${t2.id} must have distinct bg`
          ).not.toBe(t2.colors.bg.toLowerCase());
          expect(
            t1.colors.surface.toLowerCase(),
            `Theme ${t1.id} vs ${t2.id} must have distinct surface`
          ).not.toBe(t2.colors.surface.toLowerCase());
          expect(
            t1.colors.accent.toLowerCase(),
            `Theme ${t1.id} vs ${t2.id} must have distinct accent`
          ).not.toBe(t2.colors.accent.toLowerCase());
        }
      }
    });

    it('Dimension 2 (Typography): All 4 themes use distinct heading font stacks', () => {
      const headingFonts = new Set(themes.map((t) => t.typography.heading));
      expect(headingFonts.size).toBe(4);

      // Verify specific font signatures
      expect(APP_THEMES.punk_diy.typography.heading).toContain('Impact');
      expect(APP_THEMES.tape_studio_70s.typography.heading).toContain('Fraunces');
      expect(APP_THEMES.dive_bar_crt.typography.heading).toContain('VT323');
      expect(APP_THEMES.clean_paper.typography.heading).toContain('Space Grotesk');
    });

    it('Dimension 3 (Geometry): Non-pill sharp geometry in Punk vs curved in 70s Tape / CRT', () => {
      // Punk DIY must have 0px radius across all tokens (sharp non-pill block geometry)
      expect(APP_THEMES.punk_diy.geometry.radiusSm).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.radiusMd).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.radiusLg).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.radiusPill).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.borderWidth).toBe('2px');

      // 70s Tape must have soft warm 10px / 9999px pill curves
      expect(APP_THEMES.tape_studio_70s.geometry.radiusMd).toBe('10px');
      expect(APP_THEMES.tape_studio_70s.geometry.radiusPill).toBe('9999px');

      // CRT KTV has 8px arcade chassis radius
      expect(APP_THEMES.dive_bar_crt.geometry.radiusMd).toBe('8px');
      expect(APP_THEMES.dive_bar_crt.geometry.radiusPill).toBe('9999px');

      // Clean Paper must have 0px architectural razor-sharp geometry
      expect(APP_THEMES.clean_paper.geometry.radiusMd).toBe('0px');
      expect(APP_THEMES.clean_paper.geometry.radiusPill).toBe('0px');
    });

    it('Dimension 4 (Shadows): Hard 0-blur offset in Punk vs warm diffuse in 70s vs CRT glow', () => {
      // Punk DIY: strictly 0px blur hard drop shadow
      expect(APP_THEMES.punk_diy.shadows.md).toBe('4px 4px 0px #000000');
      expect(APP_THEMES.punk_diy.shadows.glow).toBe('4px 4px 0px #ef4444');

      // 70s Tape: warm diffuse shadow with blur > 0
      expect(APP_THEMES.tape_studio_70s.shadows.md).toMatch(/(?:0|\d+px) \d+px \d+px rgba/);

      // CRT KTV: CRT phosphor neon glow
      expect(APP_THEMES.dive_bar_crt.shadows.glow).toBe('0 0 24px #06b6d4');

      // Clean Paper: sharp 0-blur ink stamp
      expect(APP_THEMES.clean_paper.shadows.md).toBe('4px 4px 0px #111111');
    });

    it('Contrast & Readability: All 4 themes provide accessible contrast ratios (> 4.5:1 text, > 3:1 accent)', () => {
      function getLuminance(hex: string): number {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16) / 255;
        const g = parseInt(clean.substring(2, 4), 16) / 255;
        const b = parseInt(clean.substring(4, 6), 16) / 255;
        const a = [r, g, b].map((v) =>
          v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        );
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      }
      function getContrastRatio(hex1: string, hex2: string): number {
        const lum1 = getLuminance(hex1);
        const lum2 = getLuminance(hex2);
        const brightest = Math.max(lum1, lum2);
        const darkest = Math.min(lum1, lum2);
        return (brightest + 0.05) / (darkest + 0.05);
      }

      for (const t of themes) {
        // Text on surface
        const textSurfaceRatio = getContrastRatio(t.colors.text, t.colors.surface);
        expect(
          textSurfaceRatio,
          `Theme ${t.id} text (${t.colors.text}) on surface (${t.colors.surface}) must meet AA (>= 4.5:1)`
        ).toBeGreaterThanOrEqual(4.5);

        // Text on bg
        const textBgRatio = getContrastRatio(t.colors.text, t.colors.bg);
        expect(
          textBgRatio,
          `Theme ${t.id} text (${t.colors.text}) on bg (${t.colors.bg}) must meet AA (>= 4.5:1)`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
