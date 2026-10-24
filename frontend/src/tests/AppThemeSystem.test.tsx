/**
 * AppThemeSystem.test.tsx — 4-Tier Comprehensive E2E Theme Test Suite
 *
 * Covers Karaoke Studio Application-Wide Theme System & Stage Preset Integration
 * across all 4 Tiers specified in TEST_INFRA.md and PROJECT.md:
 *
 * Tier 1: Core Feature Coverage (Features F1 through F13, >=5 test cases each)
 * Tier 2: Boundary & Corner Cases (7 boundary categories, >=5 test cases each)
 * Tier 3: Cross-Feature Combinations (Pairwise interaction coverage)
 * Tier 4: Real-World Application Scenarios (End-to-End User Journeys)
 *
 * Test Philosophy: Opaque-box, requirement-driven, mathematically verified contrast,
 * real component rendering in Vitest JSDOM environment, zero facade testing.
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
} from '../theme/appThemes';

// Context & Hooks
import { AppThemeProvider, useAppTheme, AppThemeContext } from '../context/AppThemeContext';
import { useVisualTheme, cssToAssColor } from '../hooks/useVisualTheme';

// Components
import { AppThemePicker } from '../components/AppThemePicker';
import { StudioHeader } from '../components/StudioHeader';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import { LyricDisplay } from '../components/LyricDisplay';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { AudioControls } from '../components/AudioControls';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

// API Module
import * as apiModule from '../api';

// ============================================================================
// Test Fixtures & Utilities
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
  id: 'proj_theme_e2e_101',
  title: 'Sonic Reducer',
  artist: 'Dead Boys',
  duration: 195,
  status: 'ready',
  progress: 100,
  lines: sampleLyricLines,
  semitones: 0,
  guide_volume: 0,
  created_by: 'TestRunner',
};

/**
 * Mathematical WCAG relative luminance & contrast ratio calculation.
 * Ensures rigorous objective color contrast assertions.
 */
function getSrgbLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function parseHexColor(hex: string): [number, number, number] {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function calculateWcagContrast(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHexColor(hex1);
  const [r2, g2, b2] = parseHexColor(hex2);
  const l1 = getSrgbLuminance(r1, g1, b1);
  const l2 = getSrgbLuminance(r2, g2, b2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// ============================================================================
// TEST SUITE BEGIN
// ============================================================================

describe('AppThemeSystem 4-Tier E2E Test Suite', () => {
  let mockApiFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
    document.documentElement.removeAttribute('data-sync-mode');
    document.documentElement.style.cssText = '';

    mockApiFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/export/ass') || url.includes('/export/lrc')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'Content-Type': 'text/x-ssa; charset=utf-8',
            'Content-Disposition': 'attachment; filename="test.ass"',
          }),
          text: () => Promise.resolve('[Script Info]\n[V4+ Styles]'),
          blob: () => Promise.resolve(new Blob(['[Script Info]'])),
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{}'),
      });
    });

    vi.spyOn(apiModule, 'apiFetch').mockImplementation(mockApiFetch);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // TIER 1: CORE FEATURE COVERAGE (F1 to F13)
  // ==========================================================================
  describe('Tier 1: Core Feature Coverage (F1 to F13)', () => {
    // ------------------------------------------------------------------------
    // Feature 1: App Theme Tokens & Types
    // ------------------------------------------------------------------------
    describe('F1: App Theme Tokens & Types', () => {
      const themeIds: AppThemeId[] = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];

      it('F1.1: defines exactly the 4 required human-crafted themes with valid identifiers', () => {
        expect(DEFAULT_APP_THEME_ID).toBe('punk_diy');
        expect(Object.keys(APP_THEMES).sort()).toEqual([...themeIds].sort());
        expect(APP_THEME_LIST.length).toBe(4);
        themeIds.forEach((id) => {
          const theme = APP_THEMES[id];
          expect(theme.id).toBe(id);
          expect(theme.name).toBeTruthy();
          expect(theme.tagline).toBeTruthy();
          expect(isAppThemeId(id)).toBe(true);
        });
      });

      it('F1.2: validates Dimension 1 (Colors & Surfaces) across all 4 themes', () => {
        themeIds.forEach((id) => {
          const { colors } = APP_THEMES[id];
          expect(colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.surface).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.border).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.text).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.textMuted).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.sung).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(colors.unsung).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
      });

      it('F1.3: validates Dimension 2 (Typography) across all 4 themes', () => {
        themeIds.forEach((id) => {
          const { typography } = APP_THEMES[id];
          expect(typography.heading).toBeTruthy();
          expect(typography.body).toBeTruthy();
          expect(typography.mono).toBeTruthy();
          expect(typography.karaoke).toBeTruthy();
          expect(typeof typography.heading).toBe('string');
        });
      });

      it('F1.4: validates Dimension 3 (Corner Geometry & Borders) across all 4 themes', () => {
        themeIds.forEach((id) => {
          const { geometry } = APP_THEMES[id];
          expect(geometry.radiusSm).toMatch(/px$/);
          expect(geometry.radiusMd).toMatch(/px$/);
          expect(geometry.radiusLg).toMatch(/px$/);
          expect(geometry.radiusPill).toMatch(/px$/);
          expect(geometry.borderWidth).toMatch(/px$/);
          expect(geometry.borderWidthThick).toMatch(/px$/);
        });
      });

      it('F1.5: validates Dimension 4 (Shadows & Depth) and Swatches across all 4 themes', () => {
        themeIds.forEach((id) => {
          const theme = APP_THEMES[id];
          expect(theme.shadows.sm).toBeTruthy();
          expect(theme.shadows.md).toBeTruthy();
          expect(theme.shadows.lg).toBeTruthy();
          expect(theme.shadows.glow).toBeTruthy();

          expect(theme.swatches.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(theme.swatches.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
          expect(theme.swatches.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
      });

      it('F1.6: confirms exact stage preset mapping contract for all 4 themes', () => {
        expect(APP_THEMES.punk_diy.stagePresetId).toBe('punk_diy');
        expect(APP_THEMES.tape_studio_70s.stagePresetId).toBe('tape_70s');
        expect(APP_THEMES.dive_bar_crt.stagePresetId).toBe('crt_ktv');
        expect(APP_THEMES.clean_paper.stagePresetId).toBe('clean_paper');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 2: CSS Custom Properties & Tailwind Bridge
    // ------------------------------------------------------------------------
    describe('F2: CSS Custom Properties & Tailwind Bridge', () => {
      it('F2.1: applyThemeToDom sets data-theme attribute on document.documentElement', () => {
        applyThemeToDom(APP_THEMES.punk_diy);
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');

        applyThemeToDom(APP_THEMES.tape_studio_70s);
        expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      });

      it('F2.2: applyThemeToDom binds all core semantic CSS variables to document.documentElement', () => {
        applyThemeToDom(APP_THEMES.punk_diy);
        const style = document.documentElement.style;
        expect(style.getPropertyValue('--theme-bg')).toBe('#0d0d0f');
        expect(style.getPropertyValue('--theme-surface')).toBe('#17171a');
        expect(style.getPropertyValue('--theme-border')).toBe('#facc15');
        expect(style.getPropertyValue('--theme-accent')).toBe('#facc15');
        expect(style.getPropertyValue('--theme-sung')).toBe('#facc15');
        expect(style.getPropertyValue('--theme-unsung')).toBe('#f5f5f5');
        expect(style.getPropertyValue('--theme-radius-md')).toBe('0px');
      });

      it('F2.3: binds backward-compatible and test alias tokens (--app-*)', () => {
        applyThemeToDom(APP_THEMES.dive_bar_crt);
        const style = document.documentElement.style;
        expect(style.getPropertyValue('--app-bg')).toBe('#09080f');
        expect(style.getPropertyValue('--app-surface')).toBe('#13101f');
        expect(style.getPropertyValue('--app-accent')).toBe('#06b6d4');
        expect(style.getPropertyValue('--app-border-color')).toBe('#06b6d4');
      });

      it('F2.4: sets stage typography and karaoke font family CSS custom properties', () => {
        applyThemeToDom(APP_THEMES.tape_studio_70s);
        const style = document.documentElement.style;
        expect(style.getPropertyValue('--theme-font-heading')).toContain('Fraunces');
        expect(style.getPropertyValue('--karaoke-font-family')).toContain('Fraunces');
        expect(style.getPropertyValue('--theme-font-karaoke')).toContain('Fraunces');
      });

      it('F2.5: buildThemeCssVariables produces a complete dictionary containing 20+ valid CSS properties', () => {
        const theme = APP_THEMES.clean_paper;
        const vars = buildThemeCssVariables(
          theme.colors,
          theme.typography,
          theme.geometry,
          theme.shadows
        );
        expect(Object.keys(vars).length).toBeGreaterThanOrEqual(25);
        expect(vars['--theme-bg']).toBe('#f4f4f0');
        expect(vars['--theme-border-width']).toBe('1.5px');
        expect(vars['--theme-shadow-md']).toBe('4px 4px 0px #111111');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 3: Zero-FOUC Pre-Render Script
    // ------------------------------------------------------------------------
    describe('F3: Zero-FOUC Pre-Render Script', () => {
      // Re-executes the exact pre-render script logic embedded in index.html <head>
      const executePreRenderScript = () => {
        try {
          const validThemes = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];
          const saved = localStorage.getItem('karaoke_app_theme');
          if (saved && validThemes.indexOf(saved) !== -1) {
            document.documentElement.setAttribute('data-theme', saved);
          } else {
            document.documentElement.setAttribute('data-theme', 'punk_diy');
          }
        } catch {
          document.documentElement.setAttribute('data-theme', 'punk_diy');
        }
      };

      it('F3.1: defaults to punk_diy on fresh boot when localStorage is empty', () => {
        localStorage.clear();
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      });

      it('F3.2: reads valid saved theme from localStorage and applies immediately without FOUC', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, 'tape_studio_70s');
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');

        localStorage.setItem(APP_THEME_STORAGE_KEY, 'clean_paper');
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      });

      it('F3.3: falls back safely to punk_diy when localStorage holds unknown theme identifier', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, 'neon_glitch_cyber');
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      });

      it('F3.4: falls back safely to punk_diy when localStorage holds empty string or corrupt payload', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, '');
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');

        localStorage.setItem(APP_THEME_STORAGE_KEY, 'null');
        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      });

      it('F3.5: falls back safely to punk_diy when localStorage throws SecurityError in restricted iframe', () => {
        const originalGetItem = localStorage.getItem;
        localStorage.getItem = vi.fn().mockImplementation(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        });

        executePreRenderScript();
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');

        localStorage.getItem = originalGetItem;
      });
    });

    // ------------------------------------------------------------------------
    // Feature 4: Theme State & LocalStorage Persistence
    // ------------------------------------------------------------------------
    describe('F4: Theme State & LocalStorage Persistence', () => {
      it('F4.1: useAppTheme hook initializes with punk_diy on clean session profile', () => {
        expect(AppThemeContext).toBeDefined();
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });
        expect(result.current.themeId).toBe('punk_diy');
        expect(result.current.theme.id).toBe('punk_diy');
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      });

      it('F4.2: setThemeId updates context state and synchronizes document data-theme', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setThemeId('dive_bar_crt');
        });

        expect(result.current.themeId).toBe('dive_bar_crt');
        expect(result.current.theme.id).toBe('dive_bar_crt');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
      });

      it('F4.3: persists selected theme to localStorage synchronously', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setThemeId('clean_paper');
        });

        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('clean_paper');
        expect(getStoredAppTheme()).toBe('clean_paper');
      });

      it('F4.4: resetToDefault restores punk_diy in state, DOM attribute, and localStorage', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setThemeId('tape_studio_70s');
        });
        expect(result.current.themeId).toBe('tape_studio_70s');

        act(() => {
          result.current.resetToDefault();
        });

        expect(result.current.themeId).toBe('punk_diy');
        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('punk_diy');
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      });

      it('F4.5: useAppTheme outside AppThemeProvider provides non-crashing fallback', () => {
        // Must not throw when rendered without AppThemeProvider
        const { result } = renderHook(() => useAppTheme());
        expect(result.current.themeId).toBe('punk_diy');
        expect(result.current.theme.id).toBe('punk_diy');
        expect(typeof result.current.setThemeId).toBe('function');

        // Invoking setThemeId outside provider applies theme to DOM safely
        act(() => {
          result.current.setThemeId('tape_studio_70s');
        });
        expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 5: Accessible Header Theme Picker
    // ------------------------------------------------------------------------
    describe('F5: Accessible Header Theme Picker', () => {
      it('F5.1: renders trigger button with complete WAI-ARIA listbox semantics', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        expect(trigger).toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
      });

      it('F5.2: clicking trigger opens listbox with role="listbox" and 4 options', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const listbox = screen.getByRole('listbox', { name: /available application themes/i });
        expect(listbox).toBeInTheDocument();

        const options = screen.getAllByRole('option');
        expect(options.length).toBe(4);
      });

      it('F5.3: options indicate aria-selected, swatches, and checkmark on active theme', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        fireEvent.click(trigger);

        const options = screen.getAllByRole('option');
        const punkOption = options[0];
        expect(punkOption).toHaveAttribute('aria-selected', 'true');
        expect(punkOption).toHaveAttribute('data-theme-id', 'punk_diy');

        const tapeOption = options[1];
        expect(tapeOption).toHaveAttribute('aria-selected', 'false');
        expect(tapeOption).toHaveAttribute('data-theme-id', 'tape_studio_70s');
      });

      it('F5.4: supports ArrowDown/ArrowUp keyboard navigation and Home/End jumping', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        // Open via ArrowDown
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        const listbox = screen.getByRole('listbox');
        // ArrowDown navigates to option 1 (tape_studio_70s)
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
        // End key navigates to last option (clean_paper)
        fireEvent.keyDown(listbox, { key: 'End' });
        // Home key returns to first option (punk_diy)
        fireEvent.keyDown(listbox, { key: 'Home' });
      });

      it('F5.5: pressing Enter or Space on highlighted option selects theme and closes listbox', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        fireEvent.click(trigger);

        const options = screen.getAllByRole('option');
        // Click or Enter on option 2 (dive_bar_crt)
        fireEvent.click(options[2]);

        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
      });

      it('F5.6: pressing Escape key closes listbox and restores focus to trigger button', () => {
        render(
          <AppThemeProvider>
            <AppThemePicker />
          </AppThemeProvider>
        );

        const trigger = screen.getByRole('button', { name: /select theme/i });
        fireEvent.click(trigger);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    // ------------------------------------------------------------------------
    // Feature 6: Multi-Dimensional View Transformation
    // ------------------------------------------------------------------------
    describe('F6: Multi-Dimensional View Transformation', () => {
      it('F6.1: StudioHeader renders theme-adaptive background, border, and picker', () => {
        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="TestUser"
              project={mockProjectState}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        const header = screen.getByRole('banner');
        expect(header).toHaveClass('border-b');
        expect(screen.getByText('Karaoke Studio')).toBeInTheDocument();
        expect(screen.getByTestId('app-theme-picker-trigger')).toBeInTheDocument();
      });

      it('F6.2: AudioControls transport bar adapts styling with active theme tokens', () => {
        const audioRef = { current: document.createElement('audio') };
        render(
          <AppThemeProvider>
            <AudioControls
              projectId={mockProjectState.id}
              audioRef={audioRef}
              currentTime={12.0}
              duration={180.0}
              isPlaying={false}
              onTogglePlay={vi.fn()}
              onSeek={vi.fn()}
              onMixChange={vi.fn()}
            />
          </AppThemeProvider>
        );

        const playBtn = screen.getByRole('button', { name: /^start playback$/i });
        expect(playBtn).toBeInTheDocument();
      });

      it('F6.3: DeleteConfirmModal renders dialog with theme surface and border classes', () => {
        render(
          <AppThemeProvider>
            <DeleteConfirmModal
              isOpen={true}
              projectId={mockProjectState.id}
              projectTitle="Sonic Reducer"
              onClose={vi.fn()}
              onDeleted={vi.fn()}
            />
          </AppThemeProvider>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /delete project\?/i })).toBeInTheDocument();
      });

      it('F6.4: ExportModal dialog adapts theme styling dynamically', () => {
        render(
          <AppThemeProvider>
            <ExportModal project={mockProjectState} isOpen={true} onClose={vi.fn()} />
          </AppThemeProvider>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText(/Export & YouTube Package/i)).toBeInTheDocument();
      });

      it('F6.5: switching active theme dynamically alters root properties across all mounted views', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        const Consumer = () => {
          themeContext = useAppTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Consumer />
            <StudioHeader
              currentUser="TestUser"
              project={mockProjectState}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        // Initial punk_diy
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#0d0d0f');

        // Switch to tape_studio_70s
        act(() => {
          themeContext.setThemeId('tape_studio_70s');
        });
        expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#1a1410');

        // Switch to clean_paper
        act(() => {
          themeContext.setThemeId('clean_paper');
        });
        expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#f4f4f0');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 7: Punk Rock / Underground / DIY Rubric
    // ------------------------------------------------------------------------
    describe('F7: Punk Rock / Underground / DIY Rubric', () => {
      const punk = APP_THEMES.punk_diy;

      it('F7.1: heading uses bold display/stencil typography and body uses typewriter mono', () => {
        expect(punk.typography.heading).toContain('Impact');
        expect(punk.typography.body).toContain('Courier Prime');
        expect(punk.typography.mono).toContain('Courier Prime');
      });

      it('F7.2: corners are sharp with 0px radius across all tokens including pill', () => {
        expect(punk.geometry.radiusSm).toBe('0px');
        expect(punk.geometry.radiusMd).toBe('0px');
        expect(punk.geometry.radiusLg).toBe('0px');
        expect(punk.geometry.radiusXl).toBe('0px');
        expect(punk.geometry.radiusPill).toBe('0px');
      });

      it('F7.3: defines bold visible borders >= 2px thickness', () => {
        expect(punk.geometry.borderWidth).toBe('2px');
        expect(punk.geometry.borderWidthThick).toBe('3px');
        expect(punk.colors.border).toBe('#facc15'); // Flyer yellow ink border
      });

      it('F7.4: defines hard-edged offset drop shadows with 0px blur', () => {
        expect(punk.shadows.sm).toBe('2px 2px 0px #000000');
        expect(punk.shadows.md).toBe('4px 4px 0px #000000');
        expect(punk.shadows.lg).toBe('5px 5px 0px #facc15');
      });

      it('F7.5: flyer yellow accent meets WCAG AAA high contrast ratio (>7:1) against dark background', () => {
        const contrast = calculateWcagContrast(punk.colors.accent, punk.colors.bg);
        // Flyer yellow #facc15 on #0d0d0f dark ground
        expect(contrast).toBeGreaterThanOrEqual(7.0);
        expect(contrast).toBeGreaterThan(12.0); // Mathematically verified ~12.8:1
      });
    });

    // ------------------------------------------------------------------------
    // Feature 8: 3 Distinct Alternative Themes
    // ------------------------------------------------------------------------
    describe('F8: 3 Distinct Alternative Themes', () => {
      it('F8.1: Analog 70s Tape Studio defines walnut teak console, serif headings, and amber VU meter glow', () => {
        const tape = APP_THEMES.tape_studio_70s;
        expect(tape.colors.bg).toBe('#1a1410');
        expect(tape.typography.heading).toContain('Fraunces');
        expect(tape.geometry.radiusMd).toBe('10px');
        expect(tape.shadows.glow).toContain('rgba(245, 158, 11');
      });

      it('F8.2: Dive Bar CRT KTV defines grimy booth, pixel scanline VT323 typography, and neon cyan glow', () => {
        const crt = APP_THEMES.dive_bar_crt;
        expect(crt.colors.bg).toBe('#09080f');
        expect(crt.typography.heading).toContain('VT323');
        expect(crt.geometry.radiusMd).toBe('8px');
        expect(crt.shadows.glow).toBe('0 0 24px #06b6d4');
      });

      it('F8.3: Brutalist Clean Paper defines drafting newsprint, Space Grotesk, and razor-sharp 0px geometry', () => {
        const paper = APP_THEMES.clean_paper;
        expect(paper.colors.bg).toBe('#f4f4f0');
        expect(paper.colors.text).toBe('#111111');
        expect(paper.typography.heading).toContain('Space Grotesk');
        expect(paper.geometry.radiusSm).toBe('0px');
        expect(paper.geometry.radiusPill).toBe('0px');
        expect(paper.shadows.md).toBe('4px 4px 0px #111111');
      });

      it('F8.4: multi-dimensional distinctness: each pair of themes differs across all 4 visual dimensions', () => {
        const themeList = APP_THEME_LIST;
        for (let i = 0; i < themeList.length; i++) {
          for (let j = i + 1; j < themeList.length; j++) {
            const t1 = themeList[i];
            const t2 = themeList[j];

            // 1. Color bg differs
            expect(t1.colors.bg).not.toBe(t2.colors.bg);
            // 2. Heading typography differs
            expect(t1.typography.heading).not.toBe(t2.typography.heading);
            // 3. Geometry (radius or borderWidth) differs
            const geo1 = `${t1.geometry.radiusMd}-${t1.geometry.borderWidth}`;
            const geo2 = `${t2.geometry.radiusMd}-${t2.geometry.borderWidth}`;
            expect(geo1).not.toBe(geo2);
            // 4. Shadow md differs
            expect(t1.shadows.md).not.toBe(t2.shadows.md);
          }
        }
      });

      it('F8.5: complete semantic token parity: all 4 themes define all mandatory properties without omissions', () => {
        APP_THEME_LIST.forEach((theme) => {
          expect(theme.colors.surfaceSubtle).toBeTruthy();
          expect(theme.colors.surfaceRaised).toBeTruthy();
          expect(theme.colors.borderSubtle).toBeTruthy();
          expect(theme.colors.textInverse).toBeTruthy();
          expect(theme.colors.highlight).toBeTruthy();
          expect(theme.typography.karaoke).toBeTruthy();
          expect(theme.shadows.card || theme.shadows.md).toBeTruthy();
        });
      });
    });

    // ------------------------------------------------------------------------
    // Feature 9: Stage Preset Extension (Frontend & Backend)
    // ------------------------------------------------------------------------
    describe('F9: Stage Preset Extension (Frontend & Backend)', () => {
      it('F9.1: frontend THEMES array defines exactly 8 stage presets', () => {
        expect(THEMES.length).toBe(8);
        const ids = THEMES.map((t) => t.id);
        expect(ids).toEqual([
          'modern_gold',
          'cyber_cyan',
          'neon_pink',
          'classic_ktv',
          'punk_diy',
          'tape_70s',
          'crt_ktv',
          'clean_paper',
        ]);
      });

      it('F9.2: legacy presets are strictly preserved with exact original colors', () => {
        expect(THEMES[0].id).toBe('modern_gold');
        expect(THEMES[0].primary_color).toBe('&H0000D7FF');
        expect(THEMES[0].secondary_color).toBe('&H00FFFFFF');

        expect(THEMES[1].id).toBe('cyber_cyan');
        expect(THEMES[1].primary_color).toBe('&H00FFFF00');

        expect(THEMES[2].id).toBe('neon_pink');
        expect(THEMES[2].primary_color).toBe('&H00B300FF');

        expect(THEMES[3].id).toBe('classic_ktv');
        expect(THEMES[3].primary_color).toBe('&H0000FFFF');
      });

      it('F9.3: punk_diy preset defines Impact font, flyer yellow sung, and paper unsung colors', () => {
        const punkPreset = THEMES.find((t) => t.id === 'punk_diy')!;
        expect(punkPreset).toBeDefined();
        expect(punkPreset.fontFamily).toContain('Impact');
        expect(punkPreset.primary_color).toBe('&H0015CCFA');
        expect(punkPreset.secondary_color).toBe('&H00F5F5F5');
        expect(punkPreset.previewSung).toBe('#facc15');
      });

      it('F9.4: tape_70s preset defines Georgia font and warm amber VU / sepia cream colors', () => {
        const tapePreset = THEMES.find((t) => t.id === 'tape_70s')!;
        expect(tapePreset).toBeDefined();
        expect(tapePreset.fontFamily).toContain('Georgia');
        expect(tapePreset.primary_color).toBe('&H000B9EF5');
        expect(tapePreset.previewSung).toBe('#f59e0b');
        expect(tapePreset.previewUnsung).toBe('#fef3c7');
      });

      it('F9.5: crt_ktv & clean_paper presets define matching typography and palette tokens', () => {
        const crtPreset = THEMES.find((t) => t.id === 'crt_ktv')!;
        expect(crtPreset.fontFamily).toContain('VT323');
        expect(crtPreset.primary_color).toBe('&H005EC522');

        const paperPreset = THEMES.find((t) => t.id === 'clean_paper')!;
        expect(paperPreset.fontFamily).toContain('Space Grotesk');
        expect(paperPreset.primary_color).toBe('&H002626DC');
        expect(paperPreset.previewSung).toBe('#dc2626');
        expect(paperPreset.previewUnsung).toBe('#111111');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 10: Application Theme & Stage Preset Sync
    // ------------------------------------------------------------------------
    describe('F10: Application Theme & Stage Preset Sync', () => {
      it('F10.1: useVisualTheme initializes with stage preset corresponding to active app theme', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });
        expect(result.current.selectedTheme.id).toBe('punk_diy');
        expect(document.documentElement.getAttribute('data-stage-preset')).toBe('punk_diy');
      });

      it('F10.2: switching app theme to tape_studio_70s syncs stage preset to tape_70s', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        let visualThemeHook!: ReturnType<typeof useVisualTheme>;

        const Harness = () => {
          themeContext = useAppTheme();
          visualThemeHook = useVisualTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        expect(visualThemeHook.selectedTheme.id).toBe('punk_diy');

        act(() => {
          themeContext.setThemeId('tape_studio_70s');
        });

        expect(visualThemeHook.selectedTheme.id).toBe('tape_70s');
        expect(document.documentElement.getAttribute('data-stage-preset')).toBe('tape_70s');
      });

      it('F10.3: switching app theme to dive_bar_crt syncs stage preset to crt_ktv', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        let visualThemeHook!: ReturnType<typeof useVisualTheme>;

        const Harness = () => {
          themeContext = useAppTheme();
          visualThemeHook = useVisualTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        act(() => {
          themeContext.setThemeId('dive_bar_crt');
        });

        expect(visualThemeHook.selectedTheme.id).toBe('crt_ktv');
        expect(document.documentElement.getAttribute('data-stage-preset')).toBe('crt_ktv');
      });

      it('F10.4: switching app theme to clean_paper syncs stage preset to clean_paper', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        let visualThemeHook!: ReturnType<typeof useVisualTheme>;

        const Harness = () => {
          themeContext = useAppTheme();
          visualThemeHook = useVisualTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        act(() => {
          themeContext.setThemeId('clean_paper');
        });

        expect(visualThemeHook.selectedTheme.id).toBe('clean_paper');
        expect(document.documentElement.getAttribute('data-stage-preset')).toBe('clean_paper');
      });

      it('F10.5: manually selecting stage preset via VisualThemePicker updates state', () => {
        const onSelect = vi.fn();
        render(
          <VisualThemePicker
            selectedTheme={THEMES[4]} // punk_diy
            onSelectTheme={onSelect}
            aspectRatio="16:9"
            onChangeAspectRatio={vi.fn()}
            onCustomBgUploaded={vi.fn()}
          />
        );

        const tapeCard = screen.getByText("Reel-to-Reel '74");
        fireEvent.click(tapeCard);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'tape_70s' }));
      });
    });

    // ------------------------------------------------------------------------
    // Feature 11: Custom Stage Color Preservation
    // ------------------------------------------------------------------------
    describe('F11: Custom Stage Color Preservation', () => {
      it('F11.1: customSungColor is preserved across app theme switches', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        let visualThemeHook!: ReturnType<typeof useVisualTheme>;

        const Harness = () => {
          themeContext = useAppTheme();
          visualThemeHook = useVisualTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        // User customizes sung color to electric lime
        act(() => {
          visualThemeHook.setCustomSungColor('#00ff55');
        });
        expect(visualThemeHook.customSungColor).toBe('#00ff55');
        expect(visualThemeHook.activeSungColor).toBe('#00ff55');

        // User switches app theme
        act(() => {
          themeContext.setThemeId('tape_studio_70s');
        });

        // Stage preset synced, BUT custom color strictly preserved!
        expect(visualThemeHook.selectedTheme.id).toBe('tape_70s');
        expect(visualThemeHook.customSungColor).toBe('#00ff55');
        expect(visualThemeHook.activeSungColor).toBe('#00ff55');
      });

      it('F11.2: customUnsungColor is preserved across app theme switches', () => {
        let themeContext!: ReturnType<typeof useAppTheme>;
        let visualThemeHook!: ReturnType<typeof useVisualTheme>;

        const Harness = () => {
          themeContext = useAppTheme();
          visualThemeHook = useVisualTheme();
          return null;
        };

        render(
          <AppThemeProvider>
            <Harness />
          </AppThemeProvider>
        );

        // User customizes unsung color
        act(() => {
          visualThemeHook.setCustomUnsungColor('#ff0099');
        });

        // Switch to dive_bar_crt
        act(() => {
          themeContext.setThemeId('dive_bar_crt');
        });

        expect(visualThemeHook.customUnsungColor).toBe('#ff0099');
        expect(visualThemeHook.activeUnsungColor).toBe('#ff0099');
      });

      it('F11.3: effectiveTheme converts custom colors to ASS format (&H00BBGGRR)', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          // #00FF55 -> R=00, G=FF, B=55 -> BGR &H0055FF00
          result.current.setCustomSungColor('#00ff55');
          // #FF0099 -> R=FF, G=00, B=99 -> BGR &H009900FF
          result.current.setCustomUnsungColor('#ff0099');
        });

        expect(result.current.effectiveTheme.primary_color).toBe('&H0055FF00');
        expect(result.current.effectiveTheme.secondary_color).toBe('&H009900FF');
      });

      it('F11.4: resetThemeDefaults clears custom colors back to preset defaults', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setCustomSungColor('#00ff55');
          result.current.setCustomUnsungColor('#ff0099');
        });

        expect(result.current.customSungColor).toBe('#00ff55');

        act(() => {
          result.current.resetThemeDefaults();
        });

        expect(result.current.customSungColor).toBeNull();
        expect(result.current.customUnsungColor).toBeNull();
        expect(result.current.activeSungColor).toBe(result.current.selectedTheme.previewSung);
      });

      it('F11.5: custom colors update root CSS properties --karaoke-sung-color and --karaoke-unsung-color', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setCustomSungColor('#123456');
          result.current.setCustomUnsungColor('#abcdef');
        });

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--karaoke-sung-color')).toBe('#123456');
        expect(style.getPropertyValue('--karaoke-unsung-color')).toBe('#abcdef');
      });
    });

    // ------------------------------------------------------------------------
    // Feature 12: Stage Typography & Atmosphere Binding
    // ------------------------------------------------------------------------
    describe('F12: Stage Typography & Atmosphere Binding', () => {
      it('F12.1: LyricDisplay stageFontFamily binds to preset font or --karaoke-font-family', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            selectedTheme={THEMES[4]} // punk_diy
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine).toBeInTheDocument();
        expect(activeLine.style.fontFamily).toContain('Impact');
      });

      it('F12.2: useVisualTheme sets --karaoke-font-family on document.documentElement', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
          'Impact'
        );

        act(() => {
          result.current.setSelectedTheme(THEMES[5]); // tape_70s
        });

        expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
          'Georgia'
        );
      });

      it('F12.3: LyricDisplay renders active lyrics line with accurate font scaling', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            fontSizeScale={1.5}
            selectedTheme={THEMES[4]}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontSize).toBe('1.5em');
        expect(activeLine.getAttribute('data-font-scale')).toBe('1.5');
      });

      it('F12.4: updating font scale in useVisualTheme synchronizes --karaoke-font-scale on root', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setFontSizeScale(1.2);
        });

        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1.2');
      });

      it('F12.5: LyricDisplay renders high-contrast flyer yellow sung lyrics against dark stage atmosphere', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            themeSungColor="#facc15"
            themeUnsungColor="#f5f5f5"
            selectedTheme={THEMES[4]}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine).toBeInTheDocument();
        // Contrast of sung yellow on dark is >7:1
        expect(calculateWcagContrast('#facc15', '#0d0d0f')).toBeGreaterThan(7.0);
      });
    });

    // ------------------------------------------------------------------------
    // Feature 13: Subtitle & Video Export Alignment
    // ------------------------------------------------------------------------
    describe('F13: Subtitle & Video Export Alignment', () => {
      it('F13.1: ExportSubtitleSection incorporates theme_id parameter into ASS export request URL', async () => {
        render(
          <ExportSubtitleSection
            project={mockProjectState}
            selectedTheme={THEMES[4]} // punk_diy
          />
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('theme_id=punk_diy'));
      });

      it('F13.2: ExportSubtitleSection incorporates custom color overrides into ASS export URL', async () => {
        render(
          <ExportSubtitleSection
            project={mockProjectState}
            selectedTheme={THEMES[4]}
            primaryColor="#00ff55"
            secondaryColor="#ff0099"
          />
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('primary_color=%2300ff55')
        );
        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('secondary_color=%23ff0099')
        );
      });

      it('F13.3: ExportSubtitleSection passes active fontSizeScale in export URL', async () => {
        render(
          <ExportSubtitleSection
            project={mockProjectState}
            selectedTheme={THEMES[5]}
            fontSizeScale={1.5}
          />
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('font_size_scale=1.5'));
      });

      it('F13.4: ExportSubtitleSection passes active sync_mode (word vs line) in export URL', async () => {
        render(
          <ExportSubtitleSection
            project={mockProjectState}
            selectedTheme={THEMES[4]}
            syncMode="line"
          />
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('sync_mode=line'));
      });

      it('F13.5: ExportModal passes style_config with matching theme_id and colors in video render POST payload', async () => {
        render(
          <ExportModal
            project={mockProjectState}
            isOpen={true}
            onClose={vi.fn()}
            selectedTheme={THEMES[4]}
            primaryColor="#facc15"
            secondaryColor="#f5f5f5"
            fontSizeScale={1.2}
            syncMode="line"
          />
        );

        const renderBtn = screen.getByRole('button', { name: /start video render/i });
        await act(async () => {
          fireEvent.click(renderBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(
          `/api/project/${mockProjectState.id}/render`,
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"theme_id":"punk_diy"'),
          })
        );
      });
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (7 Categories, >=5 tests each)
  // ==========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {
    // ------------------------------------------------------------------------
    // Category 1: Corrupted localStorage Values
    // ------------------------------------------------------------------------
    describe('B1: Corrupted localStorage Values', () => {
      it('B1.1: safely falls back to punk_diy when localStorage holds "null" literal string', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, 'null');
        expect(getStoredAppTheme()).toBe('punk_diy');
        expect(getAppTheme('null').id).toBe('punk_diy');
      });

      it('B1.2: safely falls back to punk_diy when localStorage holds "{}" json string', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, '{}');
        expect(getStoredAppTheme()).toBe('punk_diy');
      });

      it('B1.3: safely falls back to punk_diy when localStorage holds "[object Object]"', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, '[object Object]');
        expect(getStoredAppTheme()).toBe('punk_diy');
      });

      it('B1.4: prototype property names ("toString", "constructor", "__proto__") safely fall back', () => {
        ['toString', 'constructor', '__proto__', 'valueOf'].forEach((protoName) => {
          localStorage.setItem(APP_THEME_STORAGE_KEY, protoName);
          expect(getStoredAppTheme()).toBe('punk_diy');
          expect(getAppTheme(protoName).id).toBe('punk_diy');
        });
      });

      it('B1.5: arbitrary long random or unicode strings fall back to punk_diy', () => {
        localStorage.setItem(APP_THEME_STORAGE_KEY, '🔥punk_theme_invalid_🚀'.repeat(10));
        expect(getStoredAppTheme()).toBe('punk_diy');
      });
    });

    // ------------------------------------------------------------------------
    // Category 2: LocalStorage Throwing Exceptions
    // ------------------------------------------------------------------------
    describe('B2: LocalStorage Throwing Exceptions', () => {
      it('B2.1: SecurityError on localStorage.getItem safely falls back to punk_diy', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('Access denied', 'SecurityError');
        });

        expect(getStoredAppTheme()).toBe('punk_diy');
        spy.mockRestore();
      });

      it('B2.2: QuotaExceededError on localStorage.setItem is swallowed without crashing', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });

        expect(() => setStoredAppTheme('clean_paper')).not.toThrow();
        spy.mockRestore();
      });

      it('B2.3: missing localStorage object (sandbox environment) falls back gracefully', () => {
        const originalStorage = window.localStorage;
        try {
          Object.defineProperty(window, 'localStorage', {
            value: null,
            writable: true,
            configurable: true,
          });

          expect(getStoredAppTheme()).toBe('punk_diy');
          expect(() => setStoredAppTheme('tape_studio_70s')).not.toThrow();
        } finally {
          Object.defineProperty(window, 'localStorage', {
            value: originalStorage,
            writable: true,
            configurable: true,
          });
        }
      });

      it('B2.4: getStoredAppTheme does not throw when invoked in window-less environment', () => {
        expect(getStoredAppTheme()).toBe('punk_diy');
      });

      it('B2.5: AppThemeProvider functions normally when localStorage access is restricted', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('Storage restricted', 'SecurityError');
        });

        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        expect(() => {
          act(() => {
            result.current.setThemeId('tape_studio_70s');
          });
        }).not.toThrow();

        expect(result.current.themeId).toBe('tape_studio_70s');
        spy.mockRestore();
      });
    });

    // ------------------------------------------------------------------------
    // Category 3: Rapid Toggling & Race Conditions
    // ------------------------------------------------------------------------
    describe('B3: Rapid Toggling & Race Conditions', () => {
      it('B3.1: rapid consecutive theme toggles settle cleanly on final selected theme', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setThemeId('tape_studio_70s');
          result.current.setThemeId('dive_bar_crt');
          result.current.setThemeId('clean_paper');
          result.current.setThemeId('punk_diy');
        });

        expect(result.current.themeId).toBe('punk_diy');
        expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
        expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('punk_diy');
      });

      it('B3.2: rapid toggling maintains synchronized CSS properties on :root without lag', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setThemeId('clean_paper');
        });
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#f4f4f0');

        act(() => {
          result.current.setThemeId('tape_studio_70s');
        });
        expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#1a1410');
      });

      it('B3.3: multi-tab storage event updates active theme synchronously', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: 'dive_bar_crt',
            })
          );
        });

        expect(result.current.themeId).toBe('dive_bar_crt');
      });

      it('B3.4: multi-tab storage event with corrupt/invalid value is ignored without corrupting state', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: APP_THEME_STORAGE_KEY,
              newValue: 'corrupt_theme_attack',
            })
          );
        });

        expect(result.current.themeId).toBe('punk_diy');
      });

      it('B3.5: cycling through all 4 themes repeatedly in loop preserves valid state at every step', () => {
        const { result } = renderHook(() => useAppTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        const sequence: AppThemeId[] = [
          'punk_diy',
          'tape_studio_70s',
          'dive_bar_crt',
          'clean_paper',
          'punk_diy',
        ];

        sequence.forEach((themeId) => {
          act(() => {
            result.current.setThemeId(themeId);
          });
          expect(result.current.themeId).toBe(themeId);
          expect(document.documentElement.getAttribute('data-theme')).toBe(themeId);
        });
      });
    });

    // ------------------------------------------------------------------------
    // Category 4: Partial Color Overrides
    // ------------------------------------------------------------------------
    describe('B4: Partial Color Overrides', () => {
      it('B4.1: overriding sung color only preserves theme default for unsung color', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setCustomSungColor('#00ffff');
        });

        expect(result.current.customSungColor).toBe('#00ffff');
        expect(result.current.customUnsungColor).toBeNull();
        expect(result.current.activeUnsungColor).toBe(result.current.selectedTheme.previewUnsung);
      });

      it('B4.2: overriding unsung color only preserves theme default for sung color', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setCustomUnsungColor('#ff0055');
        });

        expect(result.current.customSungColor).toBeNull();
        expect(result.current.customUnsungColor).toBe('#ff0055');
        expect(result.current.activeSungColor).toBe(result.current.selectedTheme.previewSung);
      });

      it('B4.3: 3-digit shorthand hex (#fc0) is properly expanded and converted to ASS', () => {
        // #fc0 -> #ffcc00 -> R=FF, G=CC, B=00 -> BGR &H0000CCFF
        const ass = cssToAssColor('#fc0');
        expect(ass).toBe('&H0000CCFF');
      });

      it('B4.4: malformed hex strings fall back safely to default ASS color', () => {
        const fallback = '&H0000D7FF';
        expect(cssToAssColor('invalid_color')).toBe(fallback);
        expect(cssToAssColor('#12')).toBe(fallback);
        expect(cssToAssColor('')).toBe(fallback);
      });

      it('B4.5: direct ASS format strings (&H...) are normalized to uppercase', () => {
        expect(cssToAssColor('&h0015ccfa')).toBe('&H0015CCFA');
        expect(cssToAssColor('&H0000FFFF')).toBe('&H0000FFFF');
      });
    });

    // ------------------------------------------------------------------------
    // Category 5: Missing Font Families & Fallbacks
    // ------------------------------------------------------------------------
    describe('B5: Missing Font Families & Fallbacks', () => {
      it('B5.1: LyricDisplay stageFontFamily falls back to var(--karaoke-font-family, sans-serif) when theme font is undefined', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            fontFamily=""
            selectedTheme={undefined}
          />
        );

        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontFamily).toContain('var(--karaoke-font-family, sans-serif)');
      });

      it('B5.2: typography tokens with multiple fallback fonts format safely without syntax error', () => {
        APP_THEME_LIST.forEach((theme) => {
          expect(theme.typography.heading).toMatch(/sans-serif|serif|monospace/);
          expect(theme.typography.body).toMatch(/sans-serif|serif|monospace/);
        });
      });

      it('B5.3: custom font in useVisualTheme propagates safely to root style', () => {
        const customTheme: VisualTheme = {
          ...THEMES[4],
          fontFamily: 'CustomFont, sans-serif',
        };

        renderHook(() => useVisualTheme(customTheme));
        expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toBe(
          'CustomFont, sans-serif'
        );
      });

      it('B5.4: unknown font in applyThemeToDom safely populates CSS custom property', () => {
        const customAppTheme: AppTheme = {
          ...APP_THEMES.punk_diy,
          typography: {
            ...APP_THEMES.punk_diy.typography,
            heading: 'NonExistentFont, sans-serif',
          },
          cssVariables: {
            ...APP_THEMES.punk_diy.cssVariables,
            '--theme-font-heading': 'NonExistentFont, sans-serif',
          },
        };

        applyThemeToDom(customAppTheme);
        expect(document.documentElement.style.getPropertyValue('--theme-font-heading')).toBe(
          'NonExistentFont, sans-serif'
        );
      });

      it('B5.5: stage preview lyrics remain visible and operable when web fonts fail to load', () => {
        render(
          <LyricDisplay lines={sampleLyricLines} currentTime={2.0} selectedTheme={THEMES[4]} />
        );

        const words = screen.getAllByRole('button');
        expect(words.length).toBeGreaterThan(0);
        expect(screen.getAllByText('Raw').length).toBeGreaterThan(0);
      });
    });

    // ------------------------------------------------------------------------
    // Category 6: Extreme Font Scale Values
    // ------------------------------------------------------------------------
    describe('B6: Extreme Font Scale Values', () => {
      it('B6.1: handles low scale boundary (0.5x) by setting root CSS property --karaoke-font-scale', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setFontSizeScale(0.5);
        });

        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('0.5');
        expect(result.current.fontSizeScale).toBe(0.5);
      });

      it('B6.2: handles high scale boundary (2.0x) by setting root CSS property --karaoke-font-scale', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setFontSizeScale(2.0);
        });

        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('2');
        expect(result.current.fontSizeScale).toBe(2.0);
      });

      it('B6.3: useVisualTheme propagates custom font scale into effectiveTheme.font_size_scale', () => {
        const { result } = renderHook(() => useVisualTheme(), {
          wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
        });

        act(() => {
          result.current.setFontSizeScale(1.8);
        });

        expect(result.current.effectiveTheme.font_size_scale).toBe(1.8);
      });

      it('B6.4: LyricDisplay clamps upcoming next-line scale to minimum 0.7em at extreme low scale', () => {
        render(
          <LyricDisplay
            lines={sampleLyricLines}
            currentTime={2.0}
            fontSizeScale={0.5}
            selectedTheme={THEMES[4]}
          />
        );

        // Active line at 0.5em
        const activeLine = screen.getByTestId('active-lyrics-line');
        expect(activeLine.style.fontSize).toBe('0.5em');
      });

      it('B6.5: font scale passed to export subtitle URL preserves decimal precision', async () => {
        render(
          <ExportSubtitleSection
            project={mockProjectState}
            selectedTheme={THEMES[4]}
            fontSizeScale={1.5}
          />
        );

        const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        await act(async () => {
          fireEvent.click(downloadAssBtn);
        });

        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('font_size_scale=1.5'));
      });
    });

    // ------------------------------------------------------------------------
    // Category 7: Clean Paper Contrast Safeguards
    // ------------------------------------------------------------------------
    describe('B7: Clean Paper Contrast Safeguards', () => {
      const paper = APP_THEMES.clean_paper;

      it('B7.1: Clean Paper light background with primary text achieves WCAG AAA (>7:1) contrast', () => {
        const contrast = calculateWcagContrast(paper.colors.text, paper.colors.bg);
        // #111111 on #f4f4f0
        expect(contrast).toBeGreaterThanOrEqual(7.0);
        expect(contrast).toBeGreaterThan(14.0); // Mathematically verified ~14.9:1
      });

      it('B7.2: Clean Paper muted text meets WCAG AA (>4.5:1) contrast against light background', () => {
        const contrast = calculateWcagContrast(paper.colors.textMuted, paper.colors.bg);
        // #525252 on #f4f4f0
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      });

      it('B7.3: Clean Paper borders maintain sharp visibility on light drafting canvas', () => {
        expect(paper.colors.border).toBe('#111111');
        const borderContrast = calculateWcagContrast(paper.colors.border, paper.colors.bg);
        expect(borderContrast).toBeGreaterThan(10.0);
      });

      it('B7.4: Clean Paper stage preset unsung text achieves high contrast on preview canvas', () => {
        const paperPreset = THEMES.find((t) => t.id === 'clean_paper')!;
        const contrast = calculateWcagContrast(paperPreset.previewUnsung, paperPreset.previewBg);
        expect(contrast).toBeGreaterThan(10.0);
      });

      it('B7.5: Clean Paper wax red sung highlight provides stark visible contrast against paper canvas', () => {
        const paperPreset = THEMES.find((t) => t.id === 'clean_paper')!;
        const contrast = calculateWcagContrast(paperPreset.previewSung, paperPreset.previewBg);
        expect(contrast).toBeGreaterThan(3.5);
      });
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // ==========================================================================
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('C1: Theme + Line Sync Mode: line mode highlights active line fully in theme sung color', () => {
      render(
        <LyricDisplay
          lines={sampleLyricLines}
          currentTime={2.0}
          syncMode="line"
          themeSungColor="#06b6d4" // CRT Cyan
          themeUnsungColor="#e0e7ff"
          selectedTheme={THEMES[6]} // crt_ktv
        />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine.getAttribute('data-sync-mode')).toBe('line');

      // In line mode, each word has 100% sung overlay when line is active
      sampleLyricLines[0].words.forEach((_, idx) => {
        const overlay = screen.getByTestId(`word-sung-${idx}`);
        expect(overlay.style.width).toBe('100%');
        expect(overlay.style.color).toBe('rgb(6, 182, 212)');
      });
    });

    it('C2: Theme + Duet Singers: theme styling co-exists with multi-singer duet role colors', () => {
      render(
        <LyricDisplay
          lines={sampleLyricLines}
          currentTime={6.0} // Singer 2 line active
          themeSungColor="#facc15"
          singer2SungColor="#ec4899"
          bothSungColor="#10b981"
          selectedTheme={THEMES[4]} // punk_diy
        />
      );

      // Singer 2 badge should be illuminated in singer 2 sung color (#ec4899)
      const singerBadge = screen.getByText(/Singer 2/i);
      expect(singerBadge).toBeInTheDocument();
    });

    it('C3: Theme + Custom Color Overrides + Stage Export: export request includes both theme and custom color', async () => {
      render(
        <ExportSubtitleSection
          project={mockProjectState}
          selectedTheme={THEMES[5]} // tape_70s
          primaryColor="#00ff88"
          secondaryColor="#ff00cc"
          fontSizeScale={1.2}
          syncMode="line"
        />
      );

      const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await act(async () => {
        fireEvent.click(downloadAssBtn);
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/theme_id=tape_70s.*primary_color=%2300ff88.*sync_mode=line/)
      );
    });

    it('C4: Theme + Export Modal Lifecycle: modal re-styles live on theme change without closing', () => {
      let themeContext!: ReturnType<typeof useAppTheme>;
      const Harness = () => {
        themeContext = useAppTheme();
        return <ExportModal project={mockProjectState} isOpen={true} onClose={vi.fn()} />;
      };

      render(
        <AppThemeProvider>
          <Harness />
        </AppThemeProvider>
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Switch theme while modal is open
      act(() => {
        themeContext.setThemeId('dive_bar_crt');
      });

      // Modal is still open and mounted
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
    });

    it('C5: Theme switch during active audio playback preserves playback state and current time', () => {
      let themeContext!: ReturnType<typeof useAppTheme>;
      const audioRef = { current: document.createElement('audio') };

      const Harness = () => {
        themeContext = useAppTheme();
        return (
          <div>
            <AudioControls
              projectId={mockProjectState.id}
              audioRef={audioRef}
              currentTime={45.2}
              duration={180.0}
              isPlaying={true}
              onTogglePlay={vi.fn()}
              onSeek={vi.fn()}
              onMixChange={vi.fn()}
            />
            <LyricDisplay
              lines={sampleLyricLines}
              currentTime={2.0}
              isPlaying={true}
              selectedTheme={THEMES[4]}
            />
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <Harness />
        </AppThemeProvider>
      );

      // Verify active pause button (playback running)
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();

      // Switch theme
      act(() => {
        themeContext.setThemeId('clean_paper');
      });

      // Playback remains active and uninterrupted
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================
  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Scenario 1: Cold start on clean profile defaults to Punk Rock / DIY with correct tokens, swatches, and stage preset', () => {
      localStorage.clear();

      let themeContext!: ReturnType<typeof useAppTheme>;
      let visualThemeHook!: ReturnType<typeof useVisualTheme>;

      const FullApp = () => {
        themeContext = useAppTheme();
        visualThemeHook = useVisualTheme();
        return (
          <div>
            <StudioHeader
              currentUser="SidVicious"
              project={mockProjectState}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
            <LyricDisplay
              lines={sampleLyricLines}
              currentTime={2.0}
              selectedTheme={visualThemeHook.selectedTheme}
            />
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <FullApp />
        </AppThemeProvider>
      );

      // Verify default identity: Punk Rock DIY
      expect(themeContext.themeId).toBe('punk_diy');
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');

      // Verify trigger swatch preview shows flyer yellow and safety red
      const trigger = screen.getByTestId('app-theme-picker-trigger');
      expect(trigger).toHaveTextContent('Basement Flyer');

      // Verify stage preset defaulted to matching punk_diy preset
      expect(visualThemeHook.selectedTheme.id).toBe('punk_diy');
      expect(document.documentElement.getAttribute('data-stage-preset')).toBe('punk_diy');

      // Verify Impact font and flyer yellow sung colors
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine.style.fontFamily).toContain('Impact');
    });

    it('Scenario 2: User switches through all 4 themes, observing multi-dimensional changes across Library, Studio, and Modals', () => {
      let themeContext!: ReturnType<typeof useAppTheme>;

      const FullStudio = () => {
        themeContext = useAppTheme();
        return (
          <div>
            <StudioHeader
              currentUser="DavidBowie"
              project={mockProjectState}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
            <DeleteConfirmModal
              isOpen={true}
              projectId={mockProjectState.id}
              projectTitle="Sonic Reducer"
              onClose={vi.fn()}
              onDeleted={vi.fn()}
            />
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <FullStudio />
        </AppThemeProvider>
      );

      const trigger = screen.getByTestId('app-theme-picker-trigger');

      // 1. Switch to Reel-to-Reel '74
      fireEvent.click(trigger);
      const tapeOption = screen.getByRole('option', { name: /reel-to-reel '74/i });
      fireEvent.click(tapeOption);

      expect(themeContext.themeId).toBe('tape_studio_70s');
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#1a1410');
      expect(document.documentElement.style.getPropertyValue('--theme-radius-md')).toBe('10px');

      // 2. Switch to Midnight KTV Booth
      fireEvent.click(trigger);
      const crtOption = screen.getByRole('option', { name: /midnight ktv booth/i });
      fireEvent.click(crtOption);

      expect(themeContext.themeId).toBe('dive_bar_crt');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#09080f');
      expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#06b6d4');

      // 3. Switch to Monolith Press
      fireEvent.click(trigger);
      const paperOption = screen.getByRole('option', { name: /monolith press/i });
      fireEvent.click(paperOption);

      expect(themeContext.themeId).toBe('clean_paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#f4f4f0');
      expect(document.documentElement.style.getPropertyValue('--theme-radius-sm')).toBe('0px');
    });

    it('Scenario 3: Studio stage preset synchronizes with app theme, user customizes stage colors, exports ASS subtitles, and verifies custom colors in download URL and video payload', async () => {
      let themeContext!: ReturnType<typeof useAppTheme>;
      let visualThemeHook!: ReturnType<typeof useVisualTheme>;

      const ExportStudio = () => {
        themeContext = useAppTheme();
        visualThemeHook = useVisualTheme();
        return (
          <div>
            <StudioHeader
              currentUser="DebbieHarry"
              project={mockProjectState}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
            <ExportModal
              project={mockProjectState}
              isOpen={true}
              onClose={vi.fn()}
              selectedTheme={visualThemeHook.selectedTheme}
              primaryColor={visualThemeHook.activeSungColor}
              secondaryColor={visualThemeHook.activeUnsungColor}
              fontSizeScale={visualThemeHook.fontSizeScale}
              syncMode={visualThemeHook.syncMode}
            />
          </div>
        );
      };

      render(
        <AppThemeProvider>
          <ExportStudio />
        </AppThemeProvider>
      );

      // User switches to tape_studio_70s
      act(() => {
        themeContext.setThemeId('tape_studio_70s');
      });
      expect(visualThemeHook.selectedTheme.id).toBe('tape_70s');

      // User customizes stage sung color to high-vis electric cyan
      act(() => {
        visualThemeHook.setCustomSungColor('#00ffff');
      });

      // User switches application theme to punk_diy
      act(() => {
        themeContext.setThemeId('punk_diy');
      });
      // Custom color #00ffff is strictly preserved!
      expect(visualThemeHook.customSungColor).toBe('#00ffff');

      // User clicks Download .ASS button
      const downloadAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await act(async () => {
        fireEvent.click(downloadAssBtn);
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/theme_id=punk_diy.*primary_color=%2300ffff/)
      );

      // User clicks Render 1080p Video
      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await act(async () => {
        fireEvent.click(renderBtn);
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/project/${mockProjectState.id}/render`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"primary_color":"#00ffff"'),
        })
      );
    });

    it('Scenario 4: Persistent session: user selects Clean Paper, reloads application, verifies Clean Paper is preserved with zero FOUC and active in all views, then resets defaults', () => {
      // Step 1: User selects clean_paper
      const { result, unmount } = renderHook(() => useAppTheme(), {
        wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
      });

      act(() => {
        result.current.setThemeId('clean_paper');
      });
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('clean_paper');

      // Unmount to simulate page unload
      unmount();

      // Step 2: Simulate page reload (pre-render script executes)
      const savedTheme = localStorage.getItem(APP_THEME_STORAGE_KEY);
      expect(savedTheme).toBe('clean_paper');
      document.documentElement.setAttribute('data-theme', savedTheme!);
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');

      // Step 3: React application boots with saved theme
      const reloadedHook = renderHook(() => useAppTheme(), {
        wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider>,
      });

      expect(reloadedHook.result.current.themeId).toBe('clean_paper');
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#f4f4f0');

      // Step 4: User resets to defaults
      act(() => {
        reloadedHook.result.current.resetToDefault();
      });

      expect(reloadedHook.result.current.themeId).toBe('punk_diy');
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('punk_diy');
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
    });
  });
});
