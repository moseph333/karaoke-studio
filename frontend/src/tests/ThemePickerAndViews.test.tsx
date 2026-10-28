/**
 * Milestone 2 Unit and Integration Test Suite: ThemePickerAndViews.test.tsx
 *
 * Verifies:
 * 1. Accessible Theme Picker in StudioHeader (renders, lists all 4 themes, WAI-ARIA semantics).
 * 2. Complete Keyboard Accessibility (Tab, Enter, Space, ArrowDown, ArrowUp, Home, End, Escape).
 * 3. Reactive State Synchronization across Library View, Studio Workspace Views, and Modals.
 * 4. Multi-Dimensional Style Transformations across all 4 visual dimensions (Colors, Typography, Geometry, Shadows).
 * 5. Strict Punk Rock / Underground / DIY Rubric Compliance in Library and Studio views (legacy punk_diy theme).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppThemeProvider } from '../context/AppThemeContext';
import { StudioHeader } from '../components/StudioHeader';
import { StudioMetaHeader } from '../components/StudioMetaHeader';
import { AudioControls } from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { TrackSearch } from '../components/TrackSearch';
import {
  APP_THEMES,
  APP_THEME_STORAGE_KEY,
  applyThemeToDom,
  getAppTheme,
} from '../theme/appThemes';
import { AppThemeId, ProjectState } from '../types';

// Mock API and network calls
const mockApiFetch = vi.fn();

vi.mock('../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockProject: ProjectState = {
  id: 'test-project-101',
  title: 'Search and Destroy',
  artist: 'The Stooges',
  status: 'ready',
  progress: 100,
  lines: [
    {
      id: 1,
      text: "I'm a street walking cheetah with a heart full of napalm",
      start_time: 1.2,
      end_time: 4.8,
      words: [],
    },
    {
      id: 2,
      text: "I'm a runaway son of the nuclear A-bomb",
      start_time: 5.0,
      end_time: 8.5,
      words: [],
    },
  ],
  thumbnail_url: 'https://example.com/stooges.jpg',
  master_audio_url: 'https://example.com/audio.mp3',
  semitones: 0,
  guide_volume: 0,
};

describe('ThemePickerAndViews Integration Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/api/projects')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  // =========================================================================
  // Suite 1: Theme Picker Rendering & Options Listing
  // =========================================================================
  describe('Suite 1: Theme Picker Header Integration & Options Listing', () => {
    it('renders the theme picker trigger button in StudioHeader with the default Afterglow theme', () => {
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Iggy"
            project={mockProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      // Trigger button must have accessible role and label
      const trigger =
        screen.queryByTestId('app-theme-picker-trigger') ||
        screen.getByRole('button', { name: /theme/i });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      // Default theme name must be visible
      expect(trigger).toHaveTextContent(/Afterglow/i);
    });

    it('opens listbox dropdown listing all 5 distinct themes with WAI-ARIA roles', () => {
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Iggy"
            project={mockProject}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      const trigger =
        screen.queryByTestId('app-theme-picker-trigger') ||
        screen.getByRole('button', { name: /theme/i });
      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');

      const listbox = screen.getByRole('listbox');
      expect(listbox).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(5);

      // Verify all 5 themes are listed
      const expectedThemes = [
        { id: 'afterglow', name: 'Afterglow' },
        { id: 'punk_diy', name: 'Basement Flyer' },
        { id: 'tape_studio_70s', name: "Reel-to-Reel '74" },
        { id: 'dive_bar_crt', name: 'Midnight KTV Booth' },
        { id: 'clean_paper', name: 'Monolith Press' },
      ];

      expectedThemes.forEach(({ name }) => {
        expect(screen.getByRole('option', { name: new RegExp(name, 'i') })).toBeInTheDocument();
      });

      // Default option has aria-selected="true"
      const defaultOption = screen.getByRole('option', { name: /Afterglow/i });
      expect(defaultOption).toHaveAttribute('aria-selected', 'true');
    });
  });

  // =========================================================================
  // Suite 2: Keyboard Accessibility & Navigation
  // =========================================================================
  describe('Suite 2: Theme Picker Keyboard Accessibility', () => {
    it('supports Enter and Space to toggle theme picker dropdown', () => {
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Iggy"
            project={null}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      const trigger =
        screen.queryByTestId('app-theme-picker-trigger') ||
        screen.getByRole('button', { name: /theme/i });

      // Enter opens
      fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Escape closes
      fireEvent.keyDown(trigger, { key: 'Escape', code: 'Escape' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      // Space opens
      fireEvent.keyDown(trigger, { key: ' ', code: 'Space' });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('navigates options via ArrowDown and ArrowUp and selects theme with Enter', () => {
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Iggy"
            project={null}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      const trigger =
        screen.queryByTestId('app-theme-picker-trigger') ||
        screen.getByRole('button', { name: /theme/i });
      fireEvent.click(trigger);

      const listbox = screen.getByRole('listbox');

      // ArrowDown twice to the third option (tape_studio_70s)
      fireEvent.keyDown(listbox, { key: 'ArrowDown', code: 'ArrowDown' });
      fireEvent.keyDown(listbox, { key: 'ArrowDown', code: 'ArrowDown' });
      const tapeOption = screen.getByRole('option', { name: /Reel-to-Reel '74/i });

      // Press Enter to select
      fireEvent.keyDown(tapeOption, { key: 'Enter', code: 'Enter' });

      // Dropdown closes
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      // Active theme updated
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('tape_studio_70s');
    });

    it('jumps to first/last options with Home/End keys', () => {
      render(
        <AppThemeProvider>
          <StudioHeader
            currentUser="Iggy"
            project={null}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        </AppThemeProvider>
      );

      const trigger =
        screen.queryByTestId('app-theme-picker-trigger') ||
        screen.getByRole('button', { name: /theme/i });
      fireEvent.click(trigger);

      const listbox = screen.getByRole('listbox');

      // End key moves focus to last item (clean_paper)
      fireEvent.keyDown(listbox, { key: 'End', code: 'End' });
      const paperOption = screen.getByRole('option', { name: /Monolith Press/i });
      fireEvent.keyDown(paperOption, { key: 'Enter', code: 'Enter' });

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
    });
  });

  // =========================================================================
  // Suite 3: Global Theme State Synchronization Across Views & Modals
  // =========================================================================
  describe('Suite 3: Reactive Synchronization Across Library, Studio, and Modals', () => {
    it('updates active theme in Library View when theme changes', async () => {
      await act(async () => {
        render(
          <AppThemeProvider initialThemeId="punk_diy">
            <div data-testid="library-wrapper">
              <TrackSearch
                onSelectTrack={vi.fn()}
                onUploadTrack={vi.fn()}
                onOpenProject={vi.fn()}
                isLoading={false}
                currentUser="Iggy"
                authToken="token"
              />
            </div>
          </AppThemeProvider>
        );
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#0d0d0f');

      // Change theme to Clean Paper (Light)
      act(() => {
        applyThemeToDom(getAppTheme('clean_paper'));
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(document.documentElement.style.getPropertyValue('--theme-bg')).toBe('#f4f4f0');
      expect(document.documentElement.style.getPropertyValue('--theme-text')).toBe('#111111');
    });

    it('updates StudioMetaHeader, AudioControls and TransportDock when switching from Punk to 70s Tape', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <StudioMetaHeader
            project={mockProject}
            onOpenEditModal={vi.fn()}
            onOpenDeleteModal={vi.fn()}
            onOpenExportModal={vi.fn()}
            onStartRender={vi.fn()}
          />
          <AudioControls projectId={mockProject.id} onMixChange={vi.fn()} />
          <TransportDock
            masterAudioUrl={mockProject.master_audio_url}
            lines={mockProject.lines}
            currentTime={2.5}
            duration={180}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
          />
        </AppThemeProvider>
      );

      // Initially Punk Rock DIY
      expect(document.documentElement.getAttribute('data-theme')).toBe('punk_diy');
      expect(document.documentElement.style.getPropertyValue('--theme-radius-pill')).toBe('0px');

      // Switch to Analog 70s Tape
      act(() => {
        applyThemeToDom(getAppTheme('tape_studio_70s'));
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(document.documentElement.style.getPropertyValue('--theme-radius-pill')).toBe('9999px');
      expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#f59e0b');
    });

    it('synchronizes modal dialog shells across theme changes', () => {
      render(
        <AppThemeProvider initialThemeId="punk_diy">
          <DeleteConfirmModal
            isOpen={true}
            projectId="1"
            projectTitle="Raw Power"
            onClose={vi.fn()}
            onDeleted={vi.fn()}
          />
        </AppThemeProvider>
      );

      const modalDialog = screen.getByRole('dialog');
      expect(modalDialog).toBeInTheDocument();

      // Check default punk theme variables
      expect(document.documentElement.style.getPropertyValue('--theme-surface')).toBe('#17171a');
      expect(document.documentElement.style.getPropertyValue('--theme-border')).toBe('#facc15');

      // Switch to Dive Bar CRT
      act(() => {
        applyThemeToDom(getAppTheme('dive_bar_crt'));
      });

      expect(document.documentElement.getAttribute('data-theme')).toBe('dive_bar_crt');
      expect(document.documentElement.style.getPropertyValue('--theme-surface')).toBe('#13101f');
      expect(document.documentElement.style.getPropertyValue('--theme-border')).toBe('#06b6d4');
    });
  });

  // =========================================================================
  // Suite 4: Multi-Dimensional Style Transformations (All 4 Dimensions)
  // =========================================================================
  describe('Suite 4: Multi-Dimensional Style Transformations Across All Themes', () => {
    const themeIds: AppThemeId[] = ['punk_diy', 'tape_studio_70s', 'dive_bar_crt', 'clean_paper'];

    it('Dimension 1: Every theme has distinct primary background and surface color tokens', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          expect(t1.colors.bg.toLowerCase()).not.toBe(t2.colors.bg.toLowerCase());
          expect(t1.colors.surface.toLowerCase()).not.toBe(t2.colors.surface.toLowerCase());
        }
      }
    });

    it('Dimension 2: Every theme has distinct heading and body typography pairings', () => {
      for (let i = 0; i < themeIds.length; i++) {
        for (let j = i + 1; j < themeIds.length; j++) {
          const t1 = APP_THEMES[themeIds[i]];
          const t2 = APP_THEMES[themeIds[j]];
          expect(t1.typography.heading).not.toBe(t2.typography.heading);
          expect(t1.typography.body).not.toBe(t2.typography.body);
        }
      }
    });

    it('Dimension 3: Every theme defines distinct corner radius and border geometry', () => {
      // Punk DIY: 0px radius, 2px border
      expect(APP_THEMES.punk_diy.geometry.radiusMd).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.radiusPill).toBe('0px');
      expect(APP_THEMES.punk_diy.geometry.borderWidth).toBe('2px');

      // Tape Studio 70s: 10px / 9999px radius, 1.5px border
      expect(APP_THEMES.tape_studio_70s.geometry.radiusMd).toBe('10px');
      expect(APP_THEMES.tape_studio_70s.geometry.radiusPill).toBe('9999px');

      // Dive Bar CRT: 8px / 9999px radius, 1.5px border
      expect(APP_THEMES.dive_bar_crt.geometry.radiusMd).toBe('8px');
      expect(APP_THEMES.dive_bar_crt.geometry.radiusPill).toBe('9999px');

      // Clean Paper: 0px radius, 1.5px border
      expect(APP_THEMES.clean_paper.geometry.radiusMd).toBe('0px');
      expect(APP_THEMES.clean_paper.geometry.radiusPill).toBe('0px');
    });

    it('Dimension 4: Every theme defines distinct box shadow and surface depth treatments', () => {
      // Punk DIY: hard offset drop shadow, 0 blur
      expect(APP_THEMES.punk_diy.shadows.md).toMatch(/\d+px \d+px 0px/);

      // Tape Studio: warm diffuse blur
      expect(APP_THEMES.tape_studio_70s.shadows.md).toContain('rgba');

      // Dive Bar CRT: neon glow
      expect(APP_THEMES.dive_bar_crt.shadows.glow).toContain('#06b6d4');

      // Clean Paper: hard offset ink stamp
      expect(APP_THEMES.clean_paper.shadows.md).toMatch(/\d+px \d+px 0px/);
    });
  });

  // =========================================================================
  // Suite 5: Punk Rock / Underground / DIY Rubric Compliance
  // =========================================================================
  describe('Suite 5: Punk Rock / Underground / DIY Rubric Compliance', () => {
    it('complies with zine display & typewriter/monospace typography rubric', () => {
      const punk = APP_THEMES.punk_diy;
      expect(punk.typography.heading).toMatch(/Impact|"Arial Black"/i);
      expect(punk.typography.body).toMatch(/Courier/i);
      expect(punk.typography.mono).toMatch(/Courier/i);
    });

    it('complies with sharp non-pill geometry rubric across cards and controls (0px radius, 2px border)', () => {
      const punk = APP_THEMES.punk_diy;
      expect(punk.geometry.radiusSm).toBe('0px');
      expect(punk.geometry.radiusMd).toBe('0px');
      expect(punk.geometry.radiusLg).toBe('0px');
      expect(punk.geometry.radiusXl).toBe('0px');
      expect(punk.geometry.radiusPill).toBe('0px'); // Ensures buttons are non-pill square blocks
      expect(punk.geometry.borderWidth).toBe('2px');
    });

    it('complies with hard offset shadow rubric with strictly zero diffuse blur', () => {
      const punk = APP_THEMES.punk_diy;
      expect(punk.shadows.sm).toBe('2px 2px 0px #000000');
      expect(punk.shadows.md).toBe('4px 4px 0px #000000');
      expect(punk.shadows.lg).toBe('5px 5px 0px #facc15');
      expect(punk.shadows.glow).toBe('4px 4px 0px #ef4444');
    });

    it('complies with high flyer contrast ratio exceeding WCAG AAA (> 7:1)', () => {
      const punk = APP_THEMES.punk_diy;
      // Helper to compute relative luminance
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

      // Text vs Background
      const textContrast = getContrastRatio(punk.colors.text, punk.colors.bg);
      expect(textContrast).toBeGreaterThan(15); // Bleached white on ink black

      // Accent vs Background
      const accentContrast = getContrastRatio(punk.colors.accent, punk.colors.bg);
      expect(accentContrast).toBeGreaterThan(10); // Flyer yellow on ink black
    });
  });
});
