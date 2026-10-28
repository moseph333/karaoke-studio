/**
 * M3 Challenger 1: Adversarial Stress Suite
 *
 * Focus Areas:
 * 1. StudioHeader Viewport Stress at extreme narrow viewports (320px, 360px, 375px, 280px)
 *    with long song titles, long artist, long nickname, and render progress badge.
 *    - Zero horizontal overflow (scrollWidth <= clientWidth).
 *    - Single compact bar layout without multi-line wrapping blowout.
 *    - Mobile export trigger reliability and handler precedence (onExportClick > onOpenExportModal > onStartRender).
 * 2. PWA Manifest Schema Completeness & Web App Metadata Verification:
 *    - manifest.json schema validation (name, short_name, start_url, display, orientation, categories, icons).
 *    - Real disk icon existence and non-zero byte size check (/icon-192.png, /icon-512.png, /apple-touch-icon.png, /icon.svg).
 *    - index.html PWA tags, viewport-fit=cover, status-bar-style.
 *    - Pre-render inline script execution simulation across all themes.
 * 3. Dynamic Theme Synchronization & Defensive Hardening:
 *    - Rapid sequential switching across all 4 themes (100 switches) with zero drift.
 *    - Defensive creation of meta[name="theme-color"] when tag is missing from DOM.
 *    - Defensive handling for minimal/partial theme objects or undefined colors.
 *    - Null / undefined / empty theme handling without throwing.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeProcess = (globalThis as any).process;
import { runIndexHtmlBootScript } from './bootScriptUtils';

import { StudioHeader } from '../components/StudioHeader';
import { AppThemeProvider } from '../context/AppThemeContext';
import { applyThemeToDom, APP_THEMES, APP_THEME_STORAGE_KEY } from '../theme/appThemes';
import { AppTheme, AppThemeId, ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

describe('M3 Challenger 1: Adversarial Stress Suite', () => {
  const sampleProject: ProjectState = {
    id: 'proj_challenger_m3_1',
    status: 'ready',
    progress: 100,
    title: 'Supercalifragilisticexpialidocious Ultra Long Title 2026 Extended Remaster',
    artist: 'The Extremely Verbose Ensemble Featuring Many Guest Stars And Orchestra',
    lines: [
      {
        id: 1,
        text: 'Adversarial challenger test lyric line',
        start_time: 1.0,
        end_time: 4.5,
        words: [],
      },
    ],
    semitones: 0,
    guide_volume: 0.0,
    created_by: 'SingingLegendUser123456789',
    render_status: 'idle',
    render_progress: 0,
    heartbeat: Date.now(),
  };

  const projectRoot = nodeProcess.cwd();
  const manifestPath = fs.existsSync(path.resolve(projectRoot, 'public/manifest.json'))
    ? path.resolve(projectRoot, 'public/manifest.json')
    : path.resolve(projectRoot, 'frontend/public/manifest.json');
  const indexHtmlPath = fs.existsSync(path.resolve(projectRoot, 'index.html'))
    ? path.resolve(projectRoot, 'index.html')
    : path.resolve(projectRoot, 'frontend/index.html');
  const publicDir = path.dirname(manifestPath);

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setTestViewport(375, 667);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    document.body.innerHTML = '';
  });

  // =========================================================================
  // SECTION 1: STUDIO HEADER VIEWPORT & ERGONOMIC STRESS
  // =========================================================================

  describe('1. StudioHeader Viewport Stress at Extreme Narrow Screens', () => {
    const extremeViewports = [
      { name: 'Narrow 320px (iPhone SE 1st gen)', width: 320, height: 568 },
      { name: 'Standard Small 360px (Galaxy S / Pixel)', width: 360, height: 640 },
      { name: 'Standard Mobile 375px (iPhone mini / SE 2)', width: 375, height: 667 },
      { name: 'Ultra Narrow 280px (Galaxy Fold collapsed)', width: 280, height: 653 },
    ];

    extremeViewports.forEach(({ name, width, height }) => {
      it(`maintains zero horizontal overflow at ${name} (${width}px)`, () => {
        setTestViewport(width, height);
        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="SuperLongNicknameWithoutSpaces123456789"
              project={sampleProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
              onOpenExportModal={vi.fn()}
            />
          </AppThemeProvider>
        );

        assertZeroHorizontalOverflow(container, width);
      });
    });

    it('retains single compact bar layout without multi-line wrapping blowout with render progress', () => {
      setTestViewport(320, 568);
      const renderingProject: ProjectState = {
        ...sampleProject,
        render_status: 'rendering',
        render_progress: 87.4,
      };

      const { container } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={renderingProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
            onOpenExportModal={vi.fn()}
          />
        </AppThemeProvider>
      );

      // Verify zero overflow
      assertZeroHorizontalOverflow(container, 320);

      // Verify header structure has min-h-[3.5rem] and flex flex-wrap without clipping dropdowns
      const headerDiv = container.querySelector('header > div');
      expect(headerDiv).toBeInTheDocument();
      expect(headerDiv?.className).toContain('min-h-[3.5rem]');
      expect(headerDiv?.className).not.toContain('overflow-x-hidden');
      expect(headerDiv?.className).toContain('min-w-0');

      // Verify right action cluster wraps (rather than clipping AppThemePicker) on tiny screens
      const actionCluster = headerDiv?.children[1];
      expect(actionCluster?.className).toContain('flex-wrap');
      expect(actionCluster?.className).toContain('sm:flex-nowrap');
      expect(actionCluster?.className).not.toContain('overflow-x-hidden');
      expect(actionCluster?.className).toContain('min-w-0');

      // Verify render progress badge is rendered
      const badge = screen.getByTestId('header-render-progress');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/87%/);
    });

    it('renders a single export trigger with touch target >= 44x44px on mobile', () => {
      setTestViewport(375, 667);
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      expect(screen.getAllByRole('button', { name: 'Open export dialog' })).toHaveLength(1);
      const mobileExportBtn = screen.getByTestId('studio-export-btn');
      expect(mobileExportBtn.className).toContain('min-h-[44px]');
      expect(mobileExportBtn.className).toContain('min-w-[44px]');
      expect(mobileExportBtn.className).not.toContain('md:hidden');
      expect(mobileExportBtn).toHaveAttribute('aria-label', 'Open export dialog');
    });

    it('strictly respects export callback precedence: onExportClick > onOpenExportModal > onStartRender', () => {
      setTestViewport(375, 667);
      const onExportClickMock = vi.fn();
      const onOpenExportModalMock = vi.fn();
      const onStartRenderMock = vi.fn();

      // Case A: All 3 provided -> onExportClick must be invoked
      const { unmount: unmountA } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onExportClick={onExportClickMock}
            onOpenExportModal={onOpenExportModalMock}
            onStartRender={onStartRenderMock}
          />
        </AppThemeProvider>
      );

      fireEvent.click(screen.getByTestId('studio-export-btn'));
      expect(onExportClickMock).toHaveBeenCalledTimes(1);
      expect(onOpenExportModalMock).not.toHaveBeenCalled();
      expect(onStartRenderMock).not.toHaveBeenCalled();
      unmountA();

      // Case B: onExportClick omitted -> onOpenExportModal must be invoked
      const onOpenExportModalMockB = vi.fn();
      const onStartRenderMockB = vi.fn();
      const { unmount: unmountB } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onOpenExportModal={onOpenExportModalMockB}
            onStartRender={onStartRenderMockB}
          />
        </AppThemeProvider>
      );

      fireEvent.click(screen.getByTestId('studio-export-btn'));
      expect(onOpenExportModalMockB).toHaveBeenCalledTimes(1);
      expect(onStartRenderMockB).not.toHaveBeenCalled();
      unmountB();

      // Case C: Only onStartRender provided -> onStartRender invoked
      const onStartRenderMockC = vi.fn();
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={onStartRenderMockC}
          />
        </AppThemeProvider>
      );

      fireEvent.click(screen.getByTestId('studio-export-btn'));
      expect(onStartRenderMockC).toHaveBeenCalledTimes(1);
    });

    it('handles rapid sequential clicking on the export trigger without exception', () => {
      setTestViewport(375, 667);
      const onExportClickMock = vi.fn();

      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
            onExportClick={onExportClickMock}
          />
        </AppThemeProvider>
      );

      const btn = screen.getByTestId('studio-export-btn');
      for (let i = 0; i < 10; i++) {
        fireEvent.click(btn);
      }
      expect(onExportClickMock).toHaveBeenCalledTimes(10);
    });

    it('does NOT render export buttons if project is null or status is not ready', () => {
      setTestViewport(375, 667);
      const { rerender } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={null}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      expect(screen.queryByTestId('studio-export-btn')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();

      const processingProject: ProjectState = {
        ...sampleProject,
        status: 'separating',
      };

      rerender(
        <AppThemeProvider>
          <StudioHeader
            currentUser="TestUser"
            project={processingProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      expect(screen.queryByTestId('studio-export-btn')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // SECTION 2: PWA MANIFEST & MOBILE WEB-APP METADATA
  // =========================================================================

  describe('2. PWA Manifest & Metadata Schema Completeness', () => {
    it('manifest.json conforms to W3C Web App Manifest standard', () => {
      expect(fs.existsSync(manifestPath), `Manifest exists at ${manifestPath}`).toBe(true);
      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);

      // Core metadata
      expect(typeof manifest.name).toBe('string');
      expect(manifest.name.trim().length).toBeGreaterThan(0);
      expect(manifest.name).toBe('Karaoke Studio');

      expect(typeof manifest.short_name).toBe('string');
      expect(manifest.short_name.trim().length).toBeGreaterThan(0);
      expect(manifest.short_name.length).toBeLessThanOrEqual(12);

      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
      expect(manifest.display).toBe('standalone');
      expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);

      expect(manifest.orientation).toBe('any');
      expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);

      expect(Array.isArray(manifest.categories)).toBe(true);
      expect(manifest.categories).toContain('music');
      expect(manifest.categories).toContain('entertainment');
    });

    it('every icon referenced in manifest.json exists on disk with non-zero byte size', () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

      for (const icon of manifest.icons) {
        expect(typeof icon.src).toBe('string');
        expect(typeof icon.sizes).toBe('string');
        expect(typeof icon.type).toBe('string');
        expect(icon.type).toBe('image/png');

        // Resolve icon path relative to public/
        const relativePath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
        const iconDiskPath = path.resolve(publicDir, relativePath);

        expect(fs.existsSync(iconDiskPath), `Icon file ${iconDiskPath} must exist on disk`).toBe(
          true
        );
        const stats = fs.statSync(iconDiskPath);
        expect(stats.size, `Icon file ${iconDiskPath} must not be 0 bytes`).toBeGreaterThan(100);
      }
    });

    it('apple-touch-icon and icon.svg exist on disk with valid file content', () => {
      const appleIconPath = path.resolve(publicDir, 'apple-touch-icon.png');
      expect(fs.existsSync(appleIconPath), 'apple-touch-icon.png exists in public/').toBe(true);
      const appleStats = fs.statSync(appleIconPath);
      expect(appleStats.size).toBeGreaterThan(100);

      const svgIconPath = path.resolve(publicDir, 'icon.svg');
      expect(fs.existsSync(svgIconPath), 'icon.svg exists in public/').toBe(true);
      const svgStats = fs.statSync(svgIconPath);
      expect(svgStats.size).toBeGreaterThan(50);
    });

    it('index.html contains full PWA discovery links and iOS standalone tags', () => {
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(indexHtmlPath, 'utf8');

      // Manifest link
      expect(html).toMatch(/<link\s+[^>]*rel=["']manifest["'][^>]*href=["']\/manifest\.json["']/i);

      // Theme-color meta tag
      expect(html).toMatch(
        /<meta\s+[^>]*name=["']theme-color["'][^>]*content=["']#[0-9a-fA-F]{6}["']/i
      );

      // Apple standalone web app meta tags
      expect(html).toMatch(
        /<meta\s+[^>]*name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']/i
      );
      expect(html).toMatch(
        /<meta\s+[^>]*name=["']apple-mobile-web-app-status-bar-style["']\s+content=["']black-translucent["']/i
      );

      // Apple touch icon link
      expect(html).toMatch(
        /<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']\/apple-touch-icon\.png["']/i
      );

      // Viewport fit cover
      expect(html).toMatch(/viewport-fit=cover/i);
    });

    it('pre-render inline script in index.html correctly synchronizes theme-color before React boots', () => {
      // Simulate the index.html inline script behavior
      const testCases: Array<{
        stored: string | null;
        expectedTheme: string;
        expectedColor: string;
      }> = [
        { stored: 'afterglow', expectedTheme: 'afterglow', expectedColor: '#0b0b12' },
        { stored: 'punk_diy', expectedTheme: 'punk_diy', expectedColor: '#0d0d0f' },
        { stored: 'tape_studio_70s', expectedTheme: 'tape_studio_70s', expectedColor: '#1a1410' },
        { stored: 'dive_bar_crt', expectedTheme: 'dive_bar_crt', expectedColor: '#09080f' },
        { stored: 'clean_paper', expectedTheme: 'clean_paper', expectedColor: '#f4f4f0' },
        { stored: 'corrupted_theme_xyz', expectedTheme: 'afterglow', expectedColor: '#0b0b12' },
        { stored: null, expectedTheme: 'afterglow', expectedColor: '#0b0b12' },
      ];

      for (const tc of testCases) {
        if (tc.stored) {
          localStorage.setItem(APP_THEME_STORAGE_KEY, tc.stored);
        } else {
          localStorage.removeItem(APP_THEME_STORAGE_KEY);
        }

        // index.html ships the theme-color meta; the boot script updates it in place
        let metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (!metaThemeColor) {
          metaThemeColor = document.createElement('meta');
          metaThemeColor.setAttribute('name', 'theme-color');
          document.head.appendChild(metaThemeColor);
        }

        // Execute the real inline boot script from index.html
        runIndexHtmlBootScript();

        expect(document.documentElement.getAttribute('data-theme')).toBe(tc.expectedTheme);
        expect(metaThemeColor.getAttribute('content')).toBe(tc.expectedColor);
      }
    });
  });

  // =========================================================================
  // SECTION 3: DYNAMIC THEME-COLOR SYNCHRONIZATION & DEFENSIVE HARDENING
  // =========================================================================

  describe('3. Dynamic Theme-Color Synchronization & Defensive Hardening', () => {
    it('rapid sequential theme cycling 100 times updates meta[name="theme-color"] with zero drift', () => {
      const themes: AppThemeId[] = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];

      // Ensure meta tag starts clean
      let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
      }

      for (let round = 0; round < 25; round++) {
        for (const themeId of themes) {
          const theme = (APP_THEMES as unknown as Record<AppThemeId, AppTheme>)[themeId];
          applyThemeToDom(theme);

          meta = document.querySelector('meta[name="theme-color"]');
          expect(meta).not.toBeNull();
          expect(meta?.getAttribute('content')).toBe(theme.colors.bg);
          expect(document.documentElement.getAttribute('data-theme')).toBe(themeId);
        }
      }
    });

    it('creates meta[name="theme-color"] defensively if completely missing from DOM', () => {
      // Remove any existing meta tags
      const existingMetas = document.querySelectorAll('meta[name="theme-color"]');
      existingMetas.forEach((m) => m.remove());
      expect(document.querySelector('meta[name="theme-color"]')).toBeNull();

      applyThemeToDom(APP_THEMES.dive_bar_crt);

      const createdMeta = document.querySelector('meta[name="theme-color"]');
      expect(createdMeta).toBeInTheDocument();
      expect(createdMeta?.getAttribute('content')).toBe('#09080f');
    });

    it('updates first meta[name="theme-color"] safely if duplicate tags exist in DOM', () => {
      // Clean up existing
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());

      // Insert two meta tags
      const meta1 = document.createElement('meta');
      meta1.name = 'theme-color';
      meta1.content = '#000000';
      document.head.appendChild(meta1);

      const meta2 = document.createElement('meta');
      meta2.name = 'theme-color';
      meta2.content = '#ffffff';
      document.head.appendChild(meta2);

      applyThemeToDom(APP_THEMES.clean_paper);

      // First tag is updated by querySelector
      expect(meta1.getAttribute('content')).toBe('#f4f4f0');
    });

    it('handles minimal theme object with missing colors by reading from cssVariables', () => {
      const minimalTheme = {
        id: 'minimal_theme' as AppThemeId,
        cssVariables: {
          '--theme-bg': '#334455',
          '--theme-text': '#ffffff',
        },
      } as unknown as AppTheme;

      applyThemeToDom(minimalTheme);

      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta).toBeInTheDocument();
      expect(meta?.getAttribute('content')).toBe('#334455');
    });

    it('handles legacy minimal theme object by reading from alias --app-bg', () => {
      const aliasTheme = {
        id: 'alias_theme' as AppThemeId,
        cssVariables: {
          '--app-bg': '#556677',
        },
      } as unknown as AppTheme;

      applyThemeToDom(aliasTheme);

      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta).toBeInTheDocument();
      expect(meta?.getAttribute('content')).toBe('#556677');
    });

    it('falls back to default #0b0b12 when minimal theme has no bg variable or colors', () => {
      const bareTheme = {
        id: 'bare_theme' as AppThemeId,
        cssVariables: {
          '--some-other-token': 'value',
        },
      } as unknown as AppTheme;

      applyThemeToDom(bareTheme);

      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta).toBeInTheDocument();
      expect(meta?.getAttribute('content')).toBe('#0b0b12');
    });

    it('does not throw or mutate DOM when theme is null, undefined, or empty object', () => {
      document.documentElement.setAttribute('data-theme', 'initial_marker');

      expect(() => applyThemeToDom(null as unknown as AppTheme)).not.toThrow();
      expect(() => applyThemeToDom(undefined as unknown as AppTheme)).not.toThrow();
      expect(() => applyThemeToDom({} as unknown as AppTheme)).not.toThrow();
      expect(() => applyThemeToDom({ id: 'test' } as unknown as AppTheme)).not.toThrow();

      expect(document.documentElement.getAttribute('data-theme')).toBe('initial_marker');
    });

    it('end-to-end theme picker selection updates meta[name="theme-color"] and localStorage', () => {
      setTestViewport(375, 667);
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <StudioHeader
            currentUser="TestSinger"
            project={sampleProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      // Initial theme is punk_diy -> #0d0d0f
      let meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#0d0d0f');

      // Click theme picker trigger in mobile header
      const themeTrigger = screen.getByTestId('app-theme-picker-trigger');
      fireEvent.click(themeTrigger);

      // Select Reel-to-Reel '74 (tape_studio_70s)
      const tapeOption = screen.getByRole('option', { name: /reel-to-reel '74|tape_studio/i });
      fireEvent.click(tapeOption);

      // Meta theme-color updated to tape_studio_70s bg
      meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#1a1410');
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('tape_studio_70s');

      // Re-open and select Clean Paper (clean_paper)
      fireEvent.click(themeTrigger);
      const paperOption = screen.getByRole('option', { name: /monolith press|clean_paper/i });
      fireEvent.click(paperOption);

      meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#f4f4f0');
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('clean_paper');
    });
  });
});
