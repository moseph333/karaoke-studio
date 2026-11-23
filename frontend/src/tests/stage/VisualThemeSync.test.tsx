import { loadDeferredScreens } from '../../deferredScreens';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { LyricDisplay } from '../../components/LyricDisplay';
import { ExportModal } from '../../components/ExportModal';
import { StudioModals } from '../../components/StudioModals';
import { STAGE_LOOKS, getStageLook } from '../../theme/stageLooks';
import * as apiModule from '../../api';
import { LyricLine, ProjectState } from '../../types';

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

const ktv = getStageLook('ktv');
const cinema = getStageLook('cinema');

describe('Milestone 3: Stage Looks', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-stage-look');
    vi.restoreAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  describe('VisualThemePicker UI Component Rendering', () => {
    it('renders all five looks as buttons with accessible names and selection states', () => {
      const onSelectTheme = vi.fn();
      render(
        <VisualThemePicker
          selectedTheme={ktv}
          onSelectTheme={onSelectTheme}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      const group = screen.getByRole('group', { name: 'Look' });
      const options = within(group).getAllByRole('button');
      expect(options.map((option) => option.getAttribute('data-testid'))).toEqual(
        STAGE_LOOKS.map((look) => `look-option-${look.id}`)
      );
      STAGE_LOOKS.forEach((look, i) => {
        // The name is the look's name and what it is; its small picture adds nothing to it
        expect(options[i]).toHaveAccessibleName(`${look.name} ${look.description}`);
        expect(options[i]).toHaveAttribute('aria-pressed', String(look.id === 'ktv'));
        const sample = options[i].querySelector(`[data-look-sample="${look.id}"]`);
        expect(sample).toHaveAttribute('aria-hidden', 'true');
      });

      fireEvent.click(screen.getByTestId('look-option-cinema'));
      expect(onSelectTheme).toHaveBeenCalledWith(cinema);
    });
  });

  describe('LyricDisplay Stage Typography & High Contrast', () => {
    it("draws the active and upcoming lyric lines in the look's typeface", () => {
      render(
        <LyricDisplay lines={sampleLines} currentTime={2.0} duration={120} selectedTheme={cinema} />
      );

      const activeLine = screen.getByTestId('active-lyrics-line');
      expect(activeLine.style.fontFamily).toContain('Jost');
      expect(activeLine.style.fontWeight).toBe('500');

      const upcomingLine = screen.getByTestId('stage-line');
      expect(upcomingLine).toHaveTextContent('Next line in the underground');
      expect(upcomingLine.style.fontFamily).toContain('Jost');
    });

    it('fills the sung words in the sung colour it is given', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          themeSungColor="#facc15"
          themeUnsungColor="#f5f5f5"
          selectedTheme={ktv}
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
          selectedTheme={ktv}
          primaryColor="#00ff00"
          secondaryColor="#ff00ff"
          fontSizeScale={1.2}
          aspectRatio="16:9"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
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
              theme_id: 'ktv',
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
          selectedTheme={ktv}
          primaryColor="#00ff00"
          secondaryColor="#ff00ff"
          fontSizeScale={1.2}
          aspectRatio="9:16"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/test-sync-project/export/ass?aspect_ratio=9%3A16&theme_id=ktv&primary_color=%2300ff00&secondary_color=%23ff00ff&font_size_scale=1.2'
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
          selectedTheme={ktv}
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
        '/api/project/test-sync-project/export/ass?aspect_ratio=16%3A9&theme_id=ktv&primary_color=%2300ff00&secondary_color=%23ff00ff&font_size_scale=1.25'
      );
    });
  });
});

// The studio, dialogs and palette are deferred chunks: with them loaded they render at once
beforeAll(() => loadDeferredScreens());
