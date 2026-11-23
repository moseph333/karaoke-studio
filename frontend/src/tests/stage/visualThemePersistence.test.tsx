import { loadDeferredScreens } from '../../deferredScreens';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../../components/LyricDisplay';
import { StudioModals } from '../../components/StudioModals';
import { ExportModal } from '../../components/ExportModal';
import { DEFAULT_STAGE_LOOK_ID, getStageLook } from '../../theme/stageLooks';
import { faceMetrics } from '../../theme/stageFontMetrics';
import * as apiModule from '../../api';
import { LyricLine, ProjectState } from '../../types';

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
    document.documentElement.removeAttribute('data-stage-look');
    document.documentElement.removeAttribute('data-sync-mode');
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
          selectedTheme={getStageLook('marquee')}
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
      expect(calledUrl).toContain('theme_id=marquee');
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
          selectedTheme={getStageLook('cinema')}
          aspectRatio="9:16"
          primaryColor="#123456"
          secondaryColor="#654321"
          fontSizeScale={0.85}
          syncMode="line"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
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
              theme_id: 'cinema',
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
          selectedTheme={getStageLook('cinema')}
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

      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
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
          selectedTheme={getStageLook('prompter')}
          aspectRatio="16:9"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
      await user.click(renderBtn);

      const payload = JSON.parse(apiFetchSpy.mock.calls[0][1]?.body as string);
      expect(payload.style_config).toEqual({
        theme_id: 'prompter',
      });
      expect(payload.style_config.primary_color).toBeUndefined();
      expect(payload.style_config.secondary_color).toBeUndefined();
    });
  });

  describe('3. Stage Lyrics Typeface Without a Chosen Look', () => {
    it('draws the stage in the default look and its typeface when selectedTheme is undefined', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={150}
          selectedTheme={undefined}
        />
      );

      const look = getStageLook(DEFAULT_STAGE_LOOK_ID);
      expect(screen.getByTestId('lyric-display-stage')).toHaveAttribute('data-look', look.id);
      expect(screen.getByTestId('stage-frame')).toHaveAttribute('data-look', look.id);

      const face = faceMetrics(look.frames['16:9'].lyric.face);
      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine.style.fontFamily).toContain(face.css_family);
      expect(activeLine.style.fontWeight).toBe(String(face.css_weight));
    });
  });
});

// The studio, dialogs and palette are deferred chunks: with them loaded they render at once
beforeAll(() => loadDeferredScreens());
