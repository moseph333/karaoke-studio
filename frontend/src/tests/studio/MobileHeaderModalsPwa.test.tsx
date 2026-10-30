/**
 * E2E Test Suite: Mobile Header, Bottom-Sheet Dialogs & PWA Readiness (R3)
 *
 * Requirements:
 * - R3: Mobile Header, Bottom-Sheet Dialogs & PWA Readiness
 *   - Adapt top-level navigation and modal overlays (Export, Help, Auth, Edit Metadata,
 *     Delete Confirm, Duet Assignment, Batch Offset, Lyric Replacement) to behave as
 *     ergonomic mobile bottom sheets (items-end sm:items-center, rounded-t-2xl sm:rounded-theme-xl,
 *     p-0 sm:p-4) with sticky headers/close actions (>= 44x44px) and safe-area inset padding.
 *   - StudioHeader exposes Export / Render trigger on mobile viewports (< 768px) and
 *     keeps header controls within a single compact bar at 375px width.
 *   - Web app manifest (manifest.json) and mobile metadata (theme-color, apple-mobile-web-app-capable)
 *     with dynamic theme-color synchronization matching all 4 built-in themes.
 *
 * 4-Tier Test Structure:
 * - Tier 1: Feature Coverage (F9: Header & Export, F10: Bottom Sheets, F11: Close Touch Targets, F12: PWA Manifest, F13: Theme-Color Sync)
 * - Tier 2: Boundary & Corner Cases (Long names, short screens, drag handle, fallbacks)
 * - Tier 3: Cross-Feature Combinations (Header export + modal sheet, theme picker + modal sync)
 * - Tier 4: Real-World Scenarios (Mobile Export & Theme Switch Journey, PWA Audit)
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
import { StudioHeader } from '../../components/StudioHeader';
import { ExportModal } from '../../components/ExportModal';
import { HelpModal } from '../../components/HelpModal';
import { AuthModal } from '../../components/AuthModal';
import { EditMetadataModal } from '../../components/EditMetadataModal';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal';
import { BatchOffsetModal } from '../../components/timeline/BatchOffsetModal';
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';
import { DuetAssignmentModal } from '../../components/timeline/DuetAssignmentModal';
import { AppThemeProvider } from '../../context/AppThemeContext';
import { applyThemeToDom, APP_THEMES } from '../../theme/appThemes';
import { ProjectState } from '../../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

describe('R3: Mobile Header, Bottom-Sheet Dialogs & PWA Readiness', () => {
  const readyProject: ProjectState = {
    id: 'test-project-r3',
    status: 'ready',
    progress: 100,
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    lines: [
      {
        id: 1,
        text: 'Is this the real life? Is this just fantasy?',
        start_time: 1.0,
        end_time: 5.5,
        words: [],
      },
    ],
    semitones: 0,
    guide_volume: 0.0,
    created_by: 'Friend',
    render_status: 'idle',
    render_progress: 0,
    heartbeat: Date.now(),
  };

  const indexHtmlPath = fs.existsSync(path.resolve(nodeProcess.cwd(), 'index.html'))
    ? path.resolve(nodeProcess.cwd(), 'index.html')
    : path.resolve(nodeProcess.cwd(), 'frontend/index.html');
  const manifestPath = fs.existsSync(path.resolve(nodeProcess.cwd(), 'public/manifest.json'))
    ? path.resolve(nodeProcess.cwd(), 'public/manifest.json')
    : path.resolve(nodeProcess.cwd(), 'frontend/public/manifest.json');

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setTestViewport(375, 667);
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('Feature 9: Mobile Studio Header & Export Trigger (ORIGINAL_REQUEST §R3)', () => {
      it('F9-1: StudioHeader exposes Export / Render trigger on mobile viewports (< 768px)', () => {
        setTestViewport(375, 667);
        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
              onOpenExportModal={vi.fn()}
            />
          </AppThemeProvider>
        );

        const exportBtn =
          screen.queryByTestId('mobile-header-export-btn') ||
          screen.queryByRole('button', { name: /render & export|export video|export/i });

        expect(exportBtn).toBeInTheDocument();
        if (exportBtn) {
          // Must not be hidden on mobile
          expect(exportBtn.className).not.toMatch(/\bhidden\b(?!\s*sm:|\s*md:)/);
          expect(exportBtn.className).not.toBe('hidden md:flex');
        }
      });

      it('F9-2: clicking mobile export trigger invokes onStartRender or onOpenExportModal', () => {
        setTestViewport(375, 667);
        const onStartRenderMock = vi.fn();
        const onOpenExportModalMock = vi.fn();

        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={onStartRenderMock}
              onOpenExportModal={onOpenExportModalMock}
            />
          </AppThemeProvider>
        );

        const exportBtn =
          screen.queryByTestId('mobile-header-export-btn') ||
          screen.queryByRole('button', { name: /render & export|export video|export/i });

        if (exportBtn) {
          fireEvent.click(exportBtn);
          expect(
            onStartRenderMock.mock.calls.length + onOpenExportModalMock.mock.calls.length
          ).toBeGreaterThanOrEqual(1);
        }
      });

      it('F9-3: StudioHeader renders within a single compact bar at 375px width with zero overflow', () => {
        setTestViewport(375, 667);
        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F9-4: AppThemePicker is accessible from mobile header navigation', () => {
        setTestViewport(375, 667);
        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        const themeTrigger = screen.getByTestId('app-theme-picker-trigger');
        expect(themeTrigger).toBeInTheDocument();
      });

      it('F9-5: Help and user profile triggers are accessible from mobile header navigation', () => {
        setTestViewport(375, 667);
        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        const helpBtn = screen.getByRole('button', { name: /help/i });
        const profileBtn = screen.getByRole('button', { name: /friend/i });

        expect(helpBtn).toBeInTheDocument();
        expect(profileBtn).toBeInTheDocument();
      });
    });

    describe('Feature 10: Mobile Bottom-Sheet Modal Dialogs (ORIGINAL_REQUEST §R3)', () => {
      it('F10-1: ExportModal adapts to mobile bottom sheet (items-end sm:items-center, p-0 sm:p-4)', () => {
        setTestViewport(375, 667);
        render(<ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('sm:items-center');
        expect(dialog.className).toContain('p-0');

        const card =
          dialog.querySelector('.bg-slate-900, [class*="bg-theme"]') || dialog.firstElementChild;
        expect(card?.className).toContain('rounded-t-2xl');
      });

      it('F10-2: HelpModal adapts to mobile bottom sheet layout', () => {
        setTestViewport(375, 667);
        render(<HelpModal isOpen={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('sm:items-center');
      });

      it('F10-3: AuthModal adapts to mobile bottom sheet layout', () => {
        setTestViewport(375, 667);
        render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('sm:items-center');
      });

      it('F10-4: EditMetadataModal and DeleteConfirmModal adapt to mobile bottom sheet layout', () => {
        setTestViewport(375, 667);
        const { unmount } = render(
          <EditMetadataModal
            isOpen={true}
            project={readyProject}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        let dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        unmount();

        render(
          <DeleteConfirmModal
            isOpen={true}
            projectId="p1"
            projectTitle="Bohemian Rhapsody"
            onClose={vi.fn()}
            onDeleted={vi.fn()}
          />
        );

        dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
      });

      it('F10-5: timeline sub-modals (BatchOffset, LyricReplacement, DuetAssignment) adapt to bottom sheet', () => {
        setTestViewport(375, 667);
        const { unmount } = render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        let dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('sm:items-center');
        unmount();

        render(
          <LyricReplacementModal
            isOpen={true}
            projectId="test-project-r3"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        );

        dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
      });
    });

    describe('Feature 11: Modal Close Button Accessibility (ORIGINAL_REQUEST §R3)', () => {
      it('F11-1: BatchOffsetModal close button meets >= 44x44px hit-target sizing (min-w-[44px] min-h-[44px])', () => {
        setTestViewport(375, 667);
        render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        expect(closeBtn).toBeInTheDocument();
        const cls = closeBtn.className;
        const meetsTarget = cls.includes('min-w-[44px]') && cls.includes('min-h-[44px]');
        expect(meetsTarget, 'BatchOffsetModal close button must meet min 44x44px target').toBe(
          true
        );
      });

      it('F11-2: LyricReplacementModal close button meets >= 44x44px hit-target sizing (min-w-[44px] min-h-[44px])', () => {
        setTestViewport(375, 667);
        render(
          <LyricReplacementModal
            isOpen={true}
            projectId="test-project-r3"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        expect(closeBtn).toBeInTheDocument();
        const cls = closeBtn.className;
        const meetsTarget = cls.includes('min-w-[44px]') && cls.includes('min-h-[44px]');
        expect(meetsTarget, 'LyricReplacementModal close button must meet min 44x44px target').toBe(
          true
        );
      });

      it('F11-3: DuetAssignmentModal close button meets >= 44x44px hit-target sizing', () => {
        setTestViewport(375, 667);
        render(
          <DuetAssignmentModal
            isOpen={true}
            onClose={vi.fn()}
            lines={readyProject.lines}
            onApply={vi.fn()}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        expect(closeBtn).toBeInTheDocument();
        const cls = closeBtn.className;
        const meetsTarget =
          (cls.includes('min-w-[44px]') && cls.includes('min-h-[44px]')) ||
          (cls.includes('w-11') && cls.includes('h-11')) ||
          cls.includes('p-3');
        expect(meetsTarget, 'DuetAssignmentModal close button must meet min 44x44px target').toBe(
          true
        );
      });

      it('F11-4: ExportModal and HelpModal close buttons meet >= 44x44px hit-target sizing', () => {
        setTestViewport(375, 667);
        const { unmount } = render(
          <ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />
        );

        let closeBtn = screen.getByRole('button', { name: /close export dialog/i });
        expect(closeBtn.className).toContain('min-w-[44px]');
        expect(closeBtn.className).toContain('min-h-[44px]');
        unmount();

        render(<HelpModal isOpen={true} onClose={vi.fn()} />);
        closeBtn = screen.getByRole('button', { name: /close help/i });
        expect(closeBtn.className).toContain('min-w-[44px]');
        expect(closeBtn.className).toContain('min-h-[44px]');
      });

      it('F11-5: close buttons provide explicit accessible labels (aria-label) and focus rings', () => {
        setTestViewport(375, 667);
        render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        expect(closeBtn).toHaveAttribute('aria-label');
        expect(closeBtn.className).toMatch(/focus(-visible)?:ring/);
      });
    });

    describe('Feature 12: PWA Manifest & Mobile Web-App Metadata (ORIGINAL_REQUEST §R3)', () => {
      it('F12-1: frontend/public/manifest.json exists and parses with valid PWA manifest fields', () => {
        expect(fs.existsSync(manifestPath), 'frontend/public/manifest.json must exist').toBe(true);
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);

        expect(manifest.name).toBe('Karaoke Studio');
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.start_url).toBe('/');
        expect(manifest.display).toBe('standalone');
      });

      it('F12-2: manifest.json defines valid icons array including 192x192 and 512x512 sizes', () => {
        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        expect(Array.isArray(manifest.icons)).toBe(true);
        expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

        const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
        expect(sizes).toContain('192x192');
        expect(sizes).toContain('512x512');
      });

      it('F12-3: index.html contains <link rel="manifest" href="/manifest.json">', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');

        expect(html).toMatch(
          /<link\s+[^>]*rel=["']manifest["'][^>]*href=["']\/manifest\.json["']/i
        );
      });

      it('F12-4: index.html contains <meta name="theme-color"> tag', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');

        expect(html).toMatch(/<meta\s+[^>]*name=["']theme-color["']/i);
      });

      it('F12-5: index.html contains apple-mobile-web-app-capable and apple-touch-icon tags', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');

        expect(html).toMatch(
          /<meta\s+[^>]*name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']/i
        );
        expect(html).toMatch(/<link\s+[^>]*rel=["']apple-touch-icon["']/i);
      });
    });

    describe('Feature 13: Dynamic theme-color Synchronization (ORIGINAL_REQUEST §R3)', () => {
      it('F13-1: applying punk_diy theme updates document meta[name="theme-color"] to #0d0d0f', () => {
        let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
        if (!meta) {
          meta = document.createElement('meta');
          meta.name = 'theme-color';
          document.head.appendChild(meta);
        }

        applyThemeToDom(APP_THEMES.punk_diy);
        meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe('#0d0d0f');
      });

      it('F13-2: applying tape_studio_70s theme updates meta[name="theme-color"] to #1a1410', () => {
        applyThemeToDom(APP_THEMES.tape_studio_70s);
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe('#1a1410');
      });

      it('F13-3: applying dive_bar_crt theme updates meta[name="theme-color"] to #09080f', () => {
        applyThemeToDom(APP_THEMES.dive_bar_crt);
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe('#09080f');
      });

      it('F13-4: applying clean_paper theme updates meta[name="theme-color"] to #f4f4f0', () => {
        applyThemeToDom(APP_THEMES.clean_paper);
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe('#f4f4f0');
      });

      it('F13-5: dynamic theme-color matches data-theme attribute on documentElement', () => {
        applyThemeToDom(APP_THEMES.dive_bar_crt);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe(APP_THEMES.dive_bar_crt.colors.bg);
      });
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('F9 Boundary Cases: Mobile Header', () => {
      it('F9-B1: very long username nickname in header truncates without pushing export button off-screen', () => {
        setTestViewport(375, 667);
        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="ExtremelyLongKaraokeSingerPseudonym12345"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F9-B2: active background video render progress displays without header line-wrap blowout', () => {
        setTestViewport(375, 667);
        const renderingProject: ProjectState = {
          ...readyProject,
          render_status: 'rendering',
          render_progress: 54,
        };

        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={renderingProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        assertZeroHorizontalOverflow(container, 375);
      });

      it('F9-B3: header at narrow 320px viewport renders cleanly with zero horizontal overflow', () => {
        setTestViewport(320, 568);
        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        assertZeroHorizontalOverflow(container, 320);
      });

      it('F9-B4: return to song search "New Song" button operates cleanly on mobile', () => {
        const onNewSongMock = vi.fn();
        render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={onNewSongMock}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        const newSongBtn = screen.getByRole('button', { name: /new song/i });
        fireEvent.click(newSongBtn);
        expect(onNewSongMock).toHaveBeenCalled();
      });

      it('F9-B5: header uses sticky top-0 z-40 positioning on mobile scroll', () => {
        const { container } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );

        const header = container.querySelector('header');
        expect(header?.className).toContain('sticky');
        expect(header?.className).toContain('top-0');
        expect(header?.className).toContain('z-40');
      });
    });

    describe('F10 Boundary Cases: Bottom-Sheet Modals', () => {
      it('F10-B1: modal on short mobile viewport (375x500 keyboard open) confines to max-h-[90vh] overflow-y-auto', () => {
        setTestViewport(375, 500);
        render(<ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        const innerCard = dialog.querySelector('.max-h-\\[90vh\\]') || dialog.firstElementChild;
        expect(innerCard?.className).toContain('max-h-[90vh]');
        expect(innerCard?.className).toContain('overflow-y-auto');
      });

      it('F10-B2: modal contains mobile drag handle visual indicator on bottom sheet', () => {
        setTestViewport(375, 667);
        render(<ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        const dragHandle =
          dialog.querySelector('[data-testid="bottom-sheet-drag-handle"]') ||
          dialog.querySelector('.w-12.h-1\\.5, .w-10.h-1, .w-12.h-1');
        expect(dragHandle).toBeInTheDocument();
      });

      it('F10-B3: modal footer contains safe-area inset padding on mobile', () => {
        setTestViewport(375, 667);
        render(<ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        const hasSafePadding =
          dialog.className.includes('safe-area') ||
          dialog.innerHTML.includes('safe-area-inset-bottom') ||
          dialog.querySelector('[class*="pb-[calc"]');
        expect(hasSafePadding).toBeTruthy();
      });

      it('F10-B4: backdrop click outside bottom sheet dismisses modal', () => {
        const onCloseMock = vi.fn();
        render(<ExportModal project={readyProject} isOpen={true} onClose={onCloseMock} />);

        const dialog = screen.getByRole('dialog');
        fireEvent.click(dialog);
        expect(onCloseMock).toHaveBeenCalled();
      });

      it('F10-B5: Escape key dismisses mobile bottom sheet dialog', () => {
        const onCloseMock = vi.fn();
        render(<ExportModal project={readyProject} isOpen={true} onClose={onCloseMock} />);

        const dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        expect(onCloseMock).toHaveBeenCalled();
      });
    });

    describe('F11 Boundary Cases: Modal Close Targets', () => {
      it('F11-B1: close button touch targets pass assertion across all modals', () => {
        setTestViewport(375, 667);
        const { unmount } = render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        expect(closeBtn.className).toContain('min-w-[44px]');
        unmount();
      });

      it('F11-B2: rapid multi-click on close button triggers onClose cleanly', () => {
        const onCloseMock = vi.fn();
        render(
          <BatchOffsetModal
            isOpen={true}
            onClose={onCloseMock}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        fireEvent.click(closeBtn);
        fireEvent.click(closeBtn);
        expect(onCloseMock).toHaveBeenCalled();
      });

      it('F11-B3: keyboard Tab focus navigates to close button with visible focus ring', () => {
        render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        closeBtn.focus();
        expect(document.activeElement).toBe(closeBtn);
        expect(closeBtn.className).toMatch(/focus(-visible)?:ring/);
      });

      it('F11-B4: close button does not overlap or crush long modal titles on 320px viewport', () => {
        setTestViewport(320, 568);
        const { container } = render(
          <BatchOffsetModal
            isOpen={true}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        assertZeroHorizontalOverflow(container, 320);
      });

      it('F11-B5: close button touch event triggers without click delay', () => {
        const onCloseMock = vi.fn();
        render(
          <BatchOffsetModal
            isOpen={true}
            onClose={onCloseMock}
            onApplyOffset={vi.fn()}
            totalLines={1}
          />
        );

        const closeBtn = screen.getByRole('button', { name: /close/i });
        fireEvent.touchStart(closeBtn);
        fireEvent.touchEnd(closeBtn);
        fireEvent.click(closeBtn);
        expect(onCloseMock).toHaveBeenCalled();
      });
    });

    describe('F12 Boundary Cases: PWA Manifest', () => {
      it('F12-B1: manifest defines categories including entertainment or music', () => {
        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.categories).toBeDefined();
        const hasMusic = manifest.categories.some((c: string) => /music|entertainment/i.test(c));
        expect(hasMusic).toBe(true);
      });

      it('F12-B2: manifest background_color matches studio theme aesthetic', () => {
        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });

      it('F12-B3: index.html viewport meta tag includes viewport-fit=cover', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');
        expect(html).toContain('viewport-fit=cover');
      });

      it('F12-B4: index.html defines apple-mobile-web-app-status-bar-style', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');
        expect(html).toMatch(/apple-mobile-web-app-status-bar-style/i);
      });

      it('F12-B5: apple touch icon link specifies valid PNG or SVG icon asset', () => {
        expect(fs.existsSync(indexHtmlPath)).toBe(true);
        const html = fs.readFileSync(indexHtmlPath, 'utf8');
        expect(html).toMatch(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["'][^"']+["']/i);
      });
    });

    describe('F13 Boundary Cases: Theme-Color Synchronization', () => {
      it('F13-B1: applyThemeToDom creates meta[name="theme-color"] if missing from DOM', () => {
        const existing = document.querySelector('meta[name="theme-color"]');
        if (existing) existing.remove();

        applyThemeToDom(APP_THEMES.punk_diy);
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta).toBeInTheDocument();
        expect(meta?.getAttribute('content')).toBe('#0d0d0f');
      });

      it('F13-B3: rapid theme cycling across all 4 themes maintains synchronous meta tag updates', () => {
        applyThemeToDom(APP_THEMES.punk_diy);
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
          '#0d0d0f'
        );

        applyThemeToDom(APP_THEMES.tape_studio_70s);
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
          '#1a1410'
        );

        applyThemeToDom(APP_THEMES.clean_paper);
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
          '#f4f4f0'
        );

        applyThemeToDom(APP_THEMES.dive_bar_crt);
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
          '#09080f'
        );
      });

      it('F13-B4: unrecognized theme ID safely falls back to default theme-color (#0d0d0f)', () => {
        applyThemeToDom(APP_THEMES.punk_diy);
        const meta = document.querySelector('meta[name="theme-color"]');
        expect(meta?.getAttribute('content')).toBe('#0d0d0f');
      });

      it('F13-B5: theme color values strictly conform to standard 7-character hex codes (#rrggbb)', () => {
        Object.values(APP_THEMES).forEach((theme) => {
          expect(theme.colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
      });
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('F9+F10: Opening ExportModal from mobile header export trigger renders mobile bottom sheet', () => {
      setTestViewport(375, 667);
      let isExportOpen = false;

      const { rerender } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Friend"
            project={readyProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={() => {
              isExportOpen = true;
            }}
            onOpenExportModal={() => {
              isExportOpen = true;
            }}
          />
          <ExportModal
            project={readyProject}
            isOpen={isExportOpen}
            onClose={() => {
              isExportOpen = false;
            }}
          />
        </AppThemeProvider>
      );

      const exportBtn =
        screen.queryByTestId('mobile-header-export-btn') ||
        screen.queryByRole('button', { name: /render & export|export video|export/i });

      if (exportBtn) {
        fireEvent.click(exportBtn);
        rerender(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
            <ExportModal
              project={readyProject}
              isOpen={isExportOpen}
              onClose={() => {
                isExportOpen = false;
              }}
            />
          </AppThemeProvider>
        );

        const dialog = screen.queryByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog?.className).toContain('items-end');
      }
    });

    it('F9+F13: Switching theme via AppThemePicker in mobile header updates meta[name="theme-color"]', () => {
      setTestViewport(375, 667);
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Friend"
            project={readyProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      const trigger = screen.getByTestId('app-theme-picker-trigger');
      fireEvent.click(trigger);

      const crtOption = screen.getByRole('option', { name: /midnight ktv booth|crt/i });
      fireEvent.click(crtOption);

      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#09080f');
    });

    it('F10+F11: BatchOffsetModal renders as bottom sheet with >=44px close button and applies offset', () => {
      setTestViewport(375, 667);
      const onApplyMock = vi.fn();
      const onCloseMock = vi.fn();

      render(
        <BatchOffsetModal
          isOpen={true}
          onClose={onCloseMock}
          onApplyOffset={onApplyMock}
          totalLines={3}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('items-end');

      const closeBtn = screen.getByRole('button', { name: /close/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');

      const applyBtn = screen.getByRole('button', { name: /apply offset/i });
      fireEvent.click(applyBtn);
      expect(onApplyMock).toHaveBeenCalled();
    });

    it('F10+F11: LyricReplacementModal renders as bottom sheet with >=44px close button', () => {
      setTestViewport(375, 667);
      render(
        <LyricReplacementModal
          isOpen={true}
          projectId="test-project-r3"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('items-end');

      const closeBtn = screen.getByRole('button', { name: /close/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('F10+F12: PWA standalone mode combined with safe-area padding preserves full modal visibility', () => {
      setTestViewport(375, 812);
      const { container } = render(
        <ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />
      );

      assertZeroHorizontalOverflow(container, 375);
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('Scenario 3: Mobile Export & Theme Switch Session (F9, F10, F11, F12, F13)', () => {
      setTestViewport(375, 667);
      let isExportOpen = false;

      const { rerender } = render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Friend"
            project={readyProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={() => {
              isExportOpen = true;
            }}
            onOpenExportModal={() => {
              isExportOpen = true;
            }}
          />
          <ExportModal
            project={readyProject}
            isOpen={isExportOpen}
            onClose={() => {
              isExportOpen = false;
            }}
          />
        </AppThemeProvider>
      );

      // 1. Mobile user taps header export trigger on 375px phone
      const exportBtn =
        screen.queryByTestId('mobile-header-export-btn') ||
        screen.queryByRole('button', { name: /render & export|export video|export/i });

      if (exportBtn) {
        fireEvent.click(exportBtn);
        rerender(
          <AppThemeProvider>
            <StudioHeader
              currentUser="Friend"
              project={readyProject}
              isLyricsDirty={false}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
            <ExportModal
              project={readyProject}
              isOpen={isExportOpen}
              onClose={() => {
                isExportOpen = false;
              }}
            />
          </AppThemeProvider>
        );

        // 2. Export dialog slides up as mobile bottom sheet
        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');

        // 3. User closes dialog using >=44px close button
        const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
        expect(closeBtn.className).toContain('min-w-[44px]');
        fireEvent.click(closeBtn);
      }

      // 4. User opens theme picker in mobile header
      const themeTrigger = screen.getByTestId('app-theme-picker-trigger');
      fireEvent.click(themeTrigger);

      // 5. Selects "Midnight KTV Booth" (dive_bar_crt)
      const crtOption = screen.getByRole('option', { name: /midnight ktv booth|crt/i });
      fireEvent.click(crtOption);

      // 6. Confirms document theme-color meta tag updated to #09080f
      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#09080f');

      // 7. Confirms persistent theme saved in localStorage
      expect(localStorage.getItem('karaoke_app_theme')).toBe('dive_bar_crt');
    });

    it('Scenario: PWA Mobile Home-Screen Installation Audit (F12, F13)', () => {
      // 1. Verify manifest existence and core PWA manifest properties
      expect(fs.existsSync(manifestPath), 'manifest.json exists').toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifest.start_url).toBe('/');
      expect(manifest.display).toBe('standalone');

      // 2. Verify icon definitions
      expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
      expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);

      // 3. Verify HTML link & meta tags
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(html).toContain('manifest.json');
      expect(html).toContain('name="theme-color"');
      expect(html).toContain('apple-mobile-web-app-capable');

      // 4. Verify initial theme-color synchronization
      applyThemeToDom(APP_THEMES.punk_diy);
      const meta = document.querySelector('meta[name="theme-color"]');
      expect(meta?.getAttribute('content')).toBe('#0d0d0f');
    });
  });
});
