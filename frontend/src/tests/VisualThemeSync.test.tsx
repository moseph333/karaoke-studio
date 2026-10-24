import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEMES, VisualThemePicker } from '../components/VisualThemePicker';
import { useVisualTheme, cssToAssColor } from '../hooks/useVisualTheme';
import { AppThemeProvider, useAppTheme } from '../context/AppThemeContext';
import { LyricDisplay } from '../components/LyricDisplay';
import { ExportModal } from '../components/ExportModal';
import { StudioModals } from '../components/StudioModals';
import * as apiModule from '../api';
import { LyricLine, ProjectState } from '../types';

const sampleLines: LyricLine[] = [
  {
    id: 1,
    start_time: 1.0,
    end_time: 5.0,
    text: 'Raw underground zine vocals',
    words: [
      { word: 'Raw', start_time: 1.0, end_time: 1.8 },
      { word: 'underground', start_time: 1.8, end_time: 3.0 },
      { word: 'zine', start_time: 3.0, end_time: 4.0 },
      { word: 'vocals', start_time: 4.0, end_time: 5.0 },
    ],
  },
  {
    id: 2,
    start_time: 6.0,
    end_time: 10.0,
    text: 'Next line in the underground',
    words: [
      { word: 'Next', start_time: 6.0, end_time: 7.0 },
      { word: 'line', start_time: 7.0, end_time: 8.0 },
      { word: 'in', start_time: 8.0, end_time: 8.5 },
      { word: 'the', start_time: 8.5, end_time: 9.0 },
      { word: 'underground', start_time: 9.0, end_time: 10.0 },
    ],
  },
];

const mockProject: ProjectState = {
  id: 'test-sync-project',
  status: 'ready',
  progress: 100,
  title: 'Anarchy Anthem',
  artist: 'DIY Collective',
  duration: 120,
  lines: sampleLines,
  semitones: 0,
  guide_volume: 0,
};

describe('Milestone 3: Stage Presets & Reactive App Theme Sync', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
    vi.restoreAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  describe('THEMES Array Specification & Legacy Preservation', () => {
    it('defines exactly 8 stage presets: 4 legacy followed by 4 matching application presets', () => {
      expect(THEMES).toHaveLength(8);
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

    it('preserves exact legacy properties for modern_gold, cyber_cyan, neon_pink, and classic_ktv', () => {
      const gold = THEMES[0];
      expect(gold.id).toBe('modern_gold');
      expect(gold.primary_color).toBe('&H0000D7FF');
      expect(gold.secondary_color).toBe('&H00FFFFFF');
      expect(gold.previewSung).toBe('#fbbf24');
      expect(gold.previewUnsung).toBe('#ffffff');

      const cyber = THEMES[1];
      expect(cyber.id).toBe('cyber_cyan');
      expect(cyber.primary_color).toBe('&H00FFFF00');
      expect(cyber.secondary_color).toBe('&H00FFFFFF');
      expect(cyber.previewSung).toBe('#06b6d4');
      expect(cyber.previewUnsung).toBe('#ffffff');

      const neon = THEMES[2];
      expect(neon.id).toBe('neon_pink');
      expect(neon.primary_color).toBe('&H00B300FF');
      expect(neon.secondary_color).toBe('&H00FFFFFF');
      expect(neon.previewSung).toBe('#ec4899');
      expect(neon.previewUnsung).toBe('#ffffff');

      const ktv = THEMES[3];
      expect(ktv.id).toBe('classic_ktv');
      expect(ktv.primary_color).toBe('&H0000FFFF');
      expect(ktv.secondary_color).toBe('&H00FFFFFF');
      expect(ktv.previewSung).toBe('#facc15');
      expect(ktv.previewUnsung).toBe('#ffffff');
    });

    it('correctly defines punk_diy matching stage preset', () => {
      const punk = THEMES[4];
      expect(punk.id).toBe('punk_diy');
      expect(punk.name).toBe('Basement Flyer');
      expect(punk.previewSung).toBe('#facc15');
      expect(punk.previewUnsung).toBe('#f5f5f5');
      expect(punk.previewBg).toBe('#0d0d0f');
      expect(punk.primary_color).toBe('&H0015CCFA');
      expect(punk.secondary_color).toBe('&H00F5F5F5');
      expect(punk.fontFamily).toContain('Impact');
    });

    it('correctly defines tape_70s matching stage preset', () => {
      const tape = THEMES[5];
      expect(tape.id).toBe('tape_70s');
      expect(tape.name).toBe("Reel-to-Reel '74");
      expect(tape.previewSung).toBe('#f59e0b');
      expect(tape.previewUnsung).toBe('#fef3c7');
      expect(tape.previewBg).toBe('#1c140e');
      expect(tape.primary_color).toBe('&H000B9EF5');
      expect(tape.secondary_color).toBe('&H00C7F3FE');
      expect(tape.fontFamily).toContain('Georgia');
    });

    it('correctly defines crt_ktv matching stage preset', () => {
      const crt = THEMES[6];
      expect(crt.id).toBe('crt_ktv');
      expect(crt.name).toBe('Midnight KTV Booth');
      expect(crt.previewSung).toBe('#22c55e');
      expect(crt.previewUnsung).toBe('#86efac');
      expect(crt.previewBg).toBe('#061309');
      expect(crt.primary_color).toBe('&H005EC522');
      expect(crt.secondary_color).toBe('&H00ACEF86');
      expect(crt.fontFamily).toContain('VT323');
    });

    it('correctly defines clean_paper matching stage preset', () => {
      const paper = THEMES[7];
      expect(paper.id).toBe('clean_paper');
      expect(paper.name).toBe('Monolith Press');
      expect(paper.previewSung).toBe('#dc2626');
      expect(paper.previewUnsung).toBe('#111111');
      expect(paper.previewBg).toBe('#f4f4f0');
      expect(paper.primary_color).toBe('&H002626DC');
      expect(paper.secondary_color).toBe('&H00111111');
      expect(paper.fontFamily).toContain('Space Grotesk');
    });
  });

  describe('Reactive Synchronization with useAppTheme()', () => {
    it('initializes to punk_diy when mounted inside AppThemeProvider', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
      );

      const { result } = renderHook(() => useVisualTheme(), { wrapper });
      expect(result.current.selectedTheme.id).toBe('punk_diy');
      expect(result.current.activeSungColor).toBe('#facc15');
      expect(result.current.activeUnsungColor).toBe('#f5f5f5');
    });

    it('reactively updates selectedTheme when app theme changes across all 4 themes', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
      );

      const { result } = renderHook(
        () => {
          const app = useAppTheme();
          const visual = useVisualTheme();
          return { app, visual };
        },
        { wrapper }
      );

      expect(result.current.visual.selectedTheme.id).toBe('punk_diy');

      // Switch to Analog 70s Studio
      act(() => {
        result.current.app.setThemeId('tape_studio_70s');
      });
      expect(result.current.visual.selectedTheme.id).toBe('tape_70s');
      expect(result.current.visual.activeSungColor).toBe('#f59e0b');
      expect(result.current.visual.activeUnsungColor).toBe('#fef3c7');

      // Switch to Dive Bar CRT KTV
      act(() => {
        result.current.app.setThemeId('dive_bar_crt');
      });
      expect(result.current.visual.selectedTheme.id).toBe('crt_ktv');
      expect(result.current.visual.activeSungColor).toBe('#22c55e');
      expect(result.current.visual.activeUnsungColor).toBe('#86efac');

      // Switch to Clean Paper Studio
      act(() => {
        result.current.app.setThemeId('clean_paper');
      });
      expect(result.current.visual.selectedTheme.id).toBe('clean_paper');
      expect(result.current.visual.activeSungColor).toBe('#dc2626');
      expect(result.current.visual.activeUnsungColor).toBe('#111111');

      // Switch back to Punk DIY
      act(() => {
        result.current.app.setThemeId('punk_diy');
      });
      expect(result.current.visual.selectedTheme.id).toBe('punk_diy');
      expect(result.current.visual.activeSungColor).toBe('#facc15');
      expect(result.current.visual.activeUnsungColor).toBe('#f5f5f5');
    });

    it('strictly preserves customSungColor and customUnsungColor across app theme switches', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
      );

      const { result } = renderHook(
        () => {
          const app = useAppTheme();
          const visual = useVisualTheme();
          return { app, visual };
        },
        { wrapper }
      );

      // User customizes colors
      act(() => {
        result.current.visual.setCustomSungColor('#ff0099');
        result.current.visual.setCustomUnsungColor('#00ffff');
      });

      expect(result.current.visual.customSungColor).toBe('#ff0099');
      expect(result.current.visual.customUnsungColor).toBe('#00ffff');
      expect(result.current.visual.activeSungColor).toBe('#ff0099');
      expect(result.current.visual.activeUnsungColor).toBe('#00ffff');

      // Switch app theme to Analog 70s Studio
      act(() => {
        result.current.app.setThemeId('tape_studio_70s');
      });

      // selectedTheme updated, but custom color overrides are intact
      expect(result.current.visual.selectedTheme.id).toBe('tape_70s');
      expect(result.current.visual.customSungColor).toBe('#ff0099');
      expect(result.current.visual.customUnsungColor).toBe('#00ffff');
      expect(result.current.visual.activeSungColor).toBe('#ff0099');
      expect(result.current.visual.activeUnsungColor).toBe('#00ffff');
      expect(result.current.visual.effectiveTheme.primary_color).toBe(cssToAssColor('#ff0099'));
      expect(result.current.visual.effectiveTheme.secondary_color).toBe(cssToAssColor('#00ffff'));

      // Switch app theme to CRT KTV
      act(() => {
        result.current.app.setThemeId('dive_bar_crt');
      });
      expect(result.current.visual.selectedTheme.id).toBe('crt_ktv');
      expect(result.current.visual.activeSungColor).toBe('#ff0099');
      expect(result.current.visual.activeUnsungColor).toBe('#00ffff');

      // Reset to defaults reveals CRT KTV defaults
      act(() => {
        result.current.visual.resetThemeDefaults();
      });
      expect(result.current.visual.customSungColor).toBeNull();
      expect(result.current.visual.customUnsungColor).toBeNull();
      expect(result.current.visual.activeSungColor).toBe('#22c55e');
      expect(result.current.visual.activeUnsungColor).toBe('#86efac');
    });

    it('preserves single-channel override (only sung color overridden, unsung adopts preset)', () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <AppThemeProvider initialThemeId="punk_diy">{children}</AppThemeProvider>
      );

      const { result } = renderHook(
        () => {
          const app = useAppTheme();
          const visual = useVisualTheme();
          return { app, visual };
        },
        { wrapper }
      );

      act(() => {
        result.current.visual.setCustomSungColor('#e11d48');
      });

      expect(result.current.visual.activeSungColor).toBe('#e11d48');
      expect(result.current.visual.activeUnsungColor).toBe('#f5f5f5'); // Punk unsung

      act(() => {
        result.current.app.setThemeId('tape_studio_70s');
      });

      // Sung remains custom, unsung updates to tape_70s default (#fef3c7)
      expect(result.current.visual.activeSungColor).toBe('#e11d48');
      expect(result.current.visual.activeUnsungColor).toBe('#fef3c7');
    });

    it('maintains backwards compatibility when used without AppThemeProvider', () => {
      // In isolated environments without provider, defaults to modern_gold
      const { result } = renderHook(() => useVisualTheme());
      expect(result.current.selectedTheme.id).toBe('modern_gold');
      expect(result.current.activeSungColor).toBe('#fbbf24');
      expect(result.current.activeUnsungColor).toBe('#ffffff');
    });
  });

  describe('VisualThemePicker UI Component Rendering', () => {
    it('renders all 8 stage preset cards with accessible names and selection states', () => {
      const onSelectTheme = vi.fn();
      render(
        <VisualThemePicker
          selectedTheme={THEMES[4]} // punk_diy
          onSelectTheme={onSelectTheme}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      THEMES.forEach((theme) => {
        expect(screen.getByText(theme.name)).toBeInTheDocument();
      });

      const punkCard = screen.getByRole('button', { name: new RegExp(THEMES[4].name, 'i') });
      expect(punkCard).toHaveAttribute('aria-pressed', 'true');

      const tapeCard = screen.getByRole('button', { name: new RegExp(THEMES[5].name, 'i') });
      fireEvent.click(tapeCard);
      expect(onSelectTheme).toHaveBeenCalledWith(THEMES[5]);
    });
  });

  describe('LyricDisplay Stage Typography & High Contrast', () => {
    it('applies stage font style from selectedTheme to active and upcoming lyric lines', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          selectedTheme={THEMES[4]} // punk_diy with Impact font
        />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveStyle({
        fontFamily: "'Impact', 'Arial Black', sans-serif",
      });

      const upcomingLine = screen.getByTestId('upcoming-lyrics-line');
      expect(upcomingLine).toHaveStyle({
        fontFamily: "'Impact', 'Arial Black', sans-serif",
      });
    });

    it('renders Punk Rock DIY with flyer yellow sung overlay', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          themeSungColor="#facc15"
          themeUnsungColor="#f5f5f5"
          selectedTheme={THEMES[4]}
        />
      );

      const firstWordSung = screen.getByTestId('word-sung-0');
      expect(firstWordSung).toHaveStyle({
        color: '#facc15',
      });
    });
  });

  describe('ExportModal Color & Scale Parameter Forwarding', () => {
    it('forwards custom colors and font_size_scale into video render style_config', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued', task_id: 'task_render_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          selectedTheme={THEMES[4]} // punk_diy
          primaryColor="#00ff00"
          secondaryColor="#ff00ff"
          fontSizeScale={1.2}
          aspectRatio="16:9"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/test-sync-project/render',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            semitones: 0,
            guide_volume: 0,
            aspect_ratio: '16:9',
            include_visualizer: false,
            include_countdown: true,
            style_config: {
              theme_id: 'punk_diy',
              primary_color: '#00ff00',
              secondary_color: '#ff00ff',
              font_size_scale: 1.2,
            },
          }),
        })
      );
    });

    it('forwards custom colors and font_size_scale into standalone ASS subtitle export URL', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response('[Script Info]\nTitle: Test ASS', {
          status: 200,
          headers: { 'Content-Type': 'text/x-ssa' },
        })
      );

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-ass');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          selectedTheme={THEMES[4]} // punk_diy
          primaryColor="#00ff00"
          secondaryColor="#ff00ff"
          fontSizeScale={1.2}
          aspectRatio="9:16"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/test-sync-project/export/ass?aspect_ratio=9%3A16&theme_id=punk_diy&primary_color=%2300ff00&secondary_color=%23ff00ff&font_size_scale=1.2'
      );
    });

    it('StudioModals forwards primaryColor, secondaryColor, and fontSizeScale to ExportModal and download .ass includes custom color query params', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response('[Script Info]\nTitle: Test ASS', {
          status: 200,
          headers: { 'Content-Type': 'text/x-ssa' },
        })
      );

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-ass');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <StudioModals
          project={mockProject}
          isExportOpen={true}
          onCloseExport={vi.fn()}
          onCancelRender={vi.fn()}
          onStartRender={vi.fn()}
          selectedTheme={THEMES[4]} // punk_diy
          aspectRatio="16:9"
          primaryColor="#00ff00"
          secondaryColor="#ff00ff"
          fontSizeScale={1.25}
          showAuthModal={false}
          onAuthSuccess={vi.fn()}
          onCloseAuth={vi.fn()}
          showHelpModal={false}
          onCloseHelp={vi.fn()}
          showStudioDeleteModal={false}
          onCloseStudioDelete={vi.fn()}
          onStudioProjectDeleted={vi.fn()}
          showStudioEditModal={false}
          onCloseStudioEdit={vi.fn()}
          onStudioMetadataSaved={vi.fn()}
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/test-sync-project/export/ass?aspect_ratio=16%3A9&theme_id=punk_diy&primary_color=%2300ff00&secondary_color=%23ff00ff&font_size_scale=1.25'
      );
    });
  });
});
