import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEMES } from '../../components/VisualThemePicker';
import { useVisualTheme, cssToAssColor } from '../../hooks/useVisualTheme';
import { AppThemeProvider, useAppTheme } from '../../context/AppThemeContext';
import { LyricDisplay } from '../../components/LyricDisplay';
import { StudioModals } from '../../components/StudioModals';
import { ExportModal } from '../../components/ExportModal';
import * as apiModule from '../../api';
import { LyricLine, ProjectState, VisualTheme } from '../../types';

const sampleLines: LyricLine[] = [
  {
    id: 1,
    start_time: 1.0,
    end_time: 5.0,
    text: 'Adversarial line for stress testing',
    words: [
      { word: 'Adversarial', start_time: 1.0, end_time: 2.0 },
      { word: 'line', start_time: 2.0, end_time: 3.0 },
      { word: 'for', start_time: 3.0, end_time: 4.0 },
      { word: 'testing', start_time: 4.0, end_time: 5.0 },
    ],
  },
  {
    id: 2,
    start_time: 6.0,
    end_time: 9.0,
    text: 'Upcoming lyric line for fallback checks',
    words: [
      { word: 'Upcoming', start_time: 6.0, end_time: 7.0 },
      { word: 'line', start_time: 7.0, end_time: 9.0 },
    ],
  },
];

const mockProject: ProjectState = {
  id: 'challenger-stress-project',
  status: 'ready',
  progress: 100,
  title: 'Stress Test Anthem',
  artist: 'Challenger Duo',
  duration: 150,
  lines: sampleLines,
  semitones: 2,
  guide_volume: 0.5,
};

describe('M3 Iteration 2: Challenger Adversarial Stress Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
    document.documentElement.removeAttribute('data-sync-mode');
    document.documentElement.style.removeProperty('--karaoke-sung-color');
    document.documentElement.style.removeProperty('--karaoke-unsung-color');
    document.documentElement.style.removeProperty('--karaoke-font-family');
    document.documentElement.style.removeProperty('--karaoke-font-scale');
    vi.restoreAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-stress-ass');
    window.URL.revokeObjectURL = vi.fn();
  });

  describe('1. StudioModals Prop Plumbing to ExportModal', () => {
    it('passes custom colors and font_size_scale into standalone ASS subtitle export URL', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response('[Script Info]\nTitle: Test ASS', {
          status: 200,
          headers: { 'Content-Type': 'text/x-ssa' },
        })
      );

      render(
        <StudioModals
          project={mockProject}
          isExportOpen={true}
          onCloseExport={vi.fn()}
          onCancelRender={vi.fn()}
          onStartRender={vi.fn()}
          selectedTheme={THEMES[4]} // punk_diy
          aspectRatio="16:9"
          primaryColor="#33ff33"
          secondaryColor="#ff33cc"
          fontSizeScale={1.45}
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

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = apiFetchSpy.mock.calls[0][0];
      expect(calledUrl).toContain('/api/project/challenger-stress-project/export/ass?');
      expect(calledUrl).toContain('aspect_ratio=16%3A9');
      expect(calledUrl).toContain('theme_id=punk_diy');
      expect(calledUrl).toContain('primary_color=%2333ff33');
      expect(calledUrl).toContain('secondary_color=%23ff33cc');
      expect(calledUrl).toContain('font_size_scale=1.45');
    });

    it('passes custom colors and font_size_scale into video render style_config payload', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued', task_id: 'task_stress_render' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          selectedTheme={THEMES[5]} // tape_70s
          aspectRatio="9:16"
          primaryColor="#123456"
          secondaryColor="#654321"
          fontSizeScale={0.85}
          syncMode="line"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/challenger-stress-project/render',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            semitones: 2,
            guide_volume: 0.5,
            aspect_ratio: '9:16',
            include_visualizer: false,
            include_countdown: true,
            style_config: {
              theme_id: 'tape_70s',
              primary_color: '#123456',
              secondary_color: '#654321',
              font_size_scale: 0.85,
              sync_mode: 'line',
            },
            sync_mode: 'line',
          }),
        })
      );
    });

    it('StudioModals passes onStartRender and forwards syncMode to ExportModal', async () => {
      const user = userEvent.setup();
      const onStartRenderMock = vi.fn();

      render(
        <StudioModals
          project={mockProject}
          isExportOpen={true}
          onCloseExport={vi.fn()}
          onCancelRender={vi.fn()}
          onStartRender={onStartRenderMock}
          selectedTheme={THEMES[5]} // tape_70s
          aspectRatio="9:16"
          primaryColor="#123456"
          secondaryColor="#654321"
          fontSizeScale={0.85}
          syncMode="line"
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

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(onStartRenderMock).toHaveBeenCalledWith({
        includeVisualizer: false,
        includeCountdown: true,
        syncMode: 'line',
      });
    });

    it('handles undefined colors gracefully without polluting export query or style_config', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          selectedTheme={THEMES[6]} // crt_ktv
          aspectRatio="16:9"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      const payload = JSON.parse(apiFetchSpy.mock.calls[0][1]?.body as string);
      expect(payload.style_config).toEqual({
        theme_id: 'crt_ktv',
      });
      expect(payload.style_config.primary_color).toBeUndefined();
      expect(payload.style_config.secondary_color).toBeUndefined();
    });
  });

  describe('2. Multi-Cycle Theme Transition Persistence in useVisualTheme', () => {
    it('persists custom colors across 2 full cycles (8 transitions) without resetting until resetThemeDefaults()', () => {
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

      // Verify initial punk_diy stage preset
      expect(result.current.visual.selectedTheme.id).toBe('punk_diy');
      expect(result.current.visual.activeSungColor).toBe('#facc15');
      expect(result.current.visual.activeUnsungColor).toBe('#f5f5f5');

      // User sets custom colors and custom font scale
      act(() => {
        result.current.visual.setCustomSungColor('#ff1493'); // Deep pink
        result.current.visual.setCustomUnsungColor('#00ffff'); // Cyan
        result.current.visual.setFontSizeScale(1.3);
      });

      expect(result.current.visual.customSungColor).toBe('#ff1493');
      expect(result.current.visual.customUnsungColor).toBe('#00ffff');
      expect(result.current.visual.activeSungColor).toBe('#ff1493');
      expect(result.current.visual.activeUnsungColor).toBe('#00ffff');
      expect(result.current.visual.fontSizeScale).toBe(1.3);
      expect(result.current.visual.effectiveTheme.primary_color).toBe(cssToAssColor('#ff1493'));
      expect(result.current.visual.effectiveTheme.secondary_color).toBe(cssToAssColor('#00ffff'));

      // Cycle 1: tape_studio_70s -> dive_bar_crt -> clean_paper -> punk_diy
      const cycleSequence: Array<{
        appTheme: 'tape_studio_70s' | 'dive_bar_crt' | 'clean_paper' | 'punk_diy';
        expectedPreset: string;
      }> = [
        { appTheme: 'tape_studio_70s', expectedPreset: 'tape_70s' },
        { appTheme: 'dive_bar_crt', expectedPreset: 'crt_ktv' },
        { appTheme: 'clean_paper', expectedPreset: 'clean_paper' },
        { appTheme: 'punk_diy', expectedPreset: 'punk_diy' },
        // Cycle 2
        { appTheme: 'tape_studio_70s', expectedPreset: 'tape_70s' },
        { appTheme: 'dive_bar_crt', expectedPreset: 'crt_ktv' },
        { appTheme: 'clean_paper', expectedPreset: 'clean_paper' },
        { appTheme: 'punk_diy', expectedPreset: 'punk_diy' },
      ];

      for (const step of cycleSequence) {
        act(() => {
          result.current.app.setThemeId(step.appTheme);
        });

        // The stage preset must update to match the app theme
        expect(result.current.visual.selectedTheme.id).toBe(step.expectedPreset);

        // Custom colors and font scale MUST NOT reset
        expect(result.current.visual.customSungColor).toBe('#ff1493');
        expect(result.current.visual.customUnsungColor).toBe('#00ffff');
        expect(result.current.visual.activeSungColor).toBe('#ff1493');
        expect(result.current.visual.activeUnsungColor).toBe('#00ffff');
        expect(result.current.visual.fontSizeScale).toBe(1.3);
        expect(result.current.visual.effectiveTheme.primary_color).toBe(cssToAssColor('#ff1493'));
        expect(result.current.visual.effectiveTheme.secondary_color).toBe(cssToAssColor('#00ffff'));

        // Document CSS variables must also be in sync
        expect(document.documentElement.style.getPropertyValue('--karaoke-sung-color')).toBe(
          '#ff1493'
        );
        expect(document.documentElement.style.getPropertyValue('--karaoke-unsung-color')).toBe(
          '#00ffff'
        );
        expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1.3');
        expect(document.documentElement.getAttribute('data-stage-preset')).toBe(
          step.expectedPreset
        );
      }

      // Now explicitly invoke resetThemeDefaults()
      act(() => {
        result.current.visual.resetThemeDefaults();
      });

      // Verify custom colors and scale are cleared
      expect(result.current.visual.customSungColor).toBeNull();
      expect(result.current.visual.customUnsungColor).toBeNull();
      expect(result.current.visual.fontSizeScale).toBe(1.0);

      // Active colors immediately revert to the active theme's defaults (punk_diy)
      expect(result.current.visual.activeSungColor).toBe('#facc15');
      expect(result.current.visual.activeUnsungColor).toBe('#f5f5f5');
      expect(result.current.visual.effectiveTheme.primary_color).toBe(THEMES[4].primary_color);
      expect(result.current.visual.effectiveTheme.secondary_color).toBe(THEMES[4].secondary_color);

      // Subsequent theme switch now adopts the new theme preset colors naturally
      act(() => {
        result.current.app.setThemeId('clean_paper');
      });
      expect(result.current.visual.selectedTheme.id).toBe('clean_paper');
      expect(result.current.visual.activeSungColor).toBe('#dc2626');
      expect(result.current.visual.activeUnsungColor).toBe('#111111');
    });
  });

  describe('3. Stage Lyrics Font Family Fallback in LyricDisplay & useVisualTheme', () => {
    it('falls back to var(--karaoke-font-family, sans-serif) when theme preset has no fontFamily and prop is undefined', () => {
      const incompleteTheme: VisualTheme = {
        id: 'no_font_theme',
        name: 'No Font Theme',
        description: 'Theme without font family',
        primary_color: '&H00FFFFFF',
        secondary_color: '&H00AAAAAA',
        previewSung: '#ffffff',
        previewUnsung: '#aaaaaa',
        previewBg: '#000000',
        fontFamily: undefined,
      };

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={150}
          selectedTheme={incompleteTheme}
        />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveStyle({
        fontFamily: 'var(--karaoke-font-family, sans-serif)',
      });

      const upcomingLine = screen.getByTestId('upcoming-lyrics-line');
      expect(upcomingLine).toHaveStyle({
        fontFamily: 'var(--karaoke-font-family, sans-serif)',
      });
    });

    it('falls back to var(--karaoke-font-family, sans-serif) when selectedTheme is undefined and prop is undefined', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={150}
          selectedTheme={undefined}
        />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveStyle({
        fontFamily: 'var(--karaoke-font-family, sans-serif)',
      });
    });

    it('prioritizes explicit fontFamily prop over selectedTheme.fontFamily', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={150}
          selectedTheme={THEMES[4]} // punk_diy with Impact
          fontFamily="'Courier New', monospace"
        />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine).toHaveStyle({
        fontFamily: "'Courier New', monospace",
      });
    });

    it('syncs --karaoke-font-family document CSS variable when stage preset switches', () => {
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

      // punk_diy should set Impact
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
        'Impact'
      );

      // tape_studio_70s should set Georgia
      act(() => {
        result.current.app.setThemeId('tape_studio_70s');
      });
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
        'Georgia'
      );

      // dive_bar_crt should set VT323
      act(() => {
        result.current.app.setThemeId('dive_bar_crt');
      });
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
        'VT323'
      );

      // clean_paper should set Space Grotesk
      act(() => {
        result.current.app.setThemeId('clean_paper');
      });
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-family')).toContain(
        'Space Grotesk'
      );
    });
  });
});
