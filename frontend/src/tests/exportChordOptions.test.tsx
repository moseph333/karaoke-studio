import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { ProjectState } from '../types';
import * as apiModule from '../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './helpers/responsiveTestUtils';

describe('Export UI & Modal Options Integration (F15)', () => {
  const mockProject: ProjectState = {
    id: 'test-chord-export-proj',
    title: 'Harmonic Symphony',
    artist: 'Chords Maestro',
    status: 'ready',
    progress: 100,
    lines: [
      {
        id: 1,
        text: 'Singing in harmony',
        start_time: 1.0,
        end_time: 4.0,
        words: [{ word: 'Singing', start_time: 1.0, end_time: 2.0 }],
      },
    ],
    semitones: 2,
    guide_volume: 0.0,
    render_status: 'idle',
    chords: [
      { start: 0.0, end: 2.0, chord: 'C' },
      { start: 2.0, end: 4.0, chord: 'G' },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  describe('1. ExportSubtitleSection Chords Toggle & URL Generation', () => {
    it('renders include-chords-subtitle-checkbox unchecked by default', () => {
      render(<ExportSubtitleSection project={mockProject} />);
      const checkbox = screen.getByTestId('include-chords-subtitle-checkbox');
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it('toggles include-chords-subtitle-checkbox state upon click', async () => {
      const user = userEvent.setup();
      render(<ExportSubtitleSection project={mockProject} />);
      const checkbox = screen.getByTestId('include-chords-subtitle-checkbox');
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it('appends include_chords=true&semitones={N} to .ass download URL when checked', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['[Script Info]']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="chords.ass"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-ass-chord');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportSubtitleSection project={mockProject} activeSemitones={3} />);
      const checkbox = screen.getByTestId('include-chords-subtitle-checkbox');
      await user.click(checkbox);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('include_chords=true');
      expect(url).toContain('semitones=3');
    });

    it('falls back to project.semitones when activeSemitones is omitted', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['[Script Info]']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="chords.ass"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-fallback');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportSubtitleSection project={mockProject} />);
      const checkbox = screen.getByTestId('include-chords-subtitle-checkbox');
      await user.click(checkbox);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('include_chords=true');
      expect(url).toContain('semitones=2');
    });

    it('does NOT append include_chords to .ass download URL when unchecked', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['[Script Info]']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="regular.ass"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-no-chord');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportSubtitleSection project={mockProject} activeSemitones={3} />);
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain('include_chords');
    });

    it('does NOT append include_chords to .lrc download URL even when checkbox is checked', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['[00:01.00] Singing in harmony']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="lyrics.lrc"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-lrc');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportSubtitleSection project={mockProject} activeSemitones={4} />);
      const checkbox = screen.getByTestId('include-chords-subtitle-checkbox');
      await user.click(checkbox);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(`/api/project/${mockProject.id}/export/lrc`);
    });
  });

  describe('2. ExportModal Video Render Options & Chord Sheet Download', () => {
    it('renders include-chords-video-checkbox unchecked by default in idle render state', () => {
      render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />);
      const checkbox = screen.getByTestId('include-chords-video-checkbox');
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it('toggles include-chords-video-checkbox upon user click', async () => {
      const user = userEvent.setup();
      render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />);
      const checkbox = screen.getByTestId('include-chords-video-checkbox');
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      await user.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it('includes include_chords in direct render payload when start video render is clicked', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi
        .spyOn(apiModule, 'apiFetch')
        .mockResolvedValue(new Response(JSON.stringify({ status: 'queued' }), { status: 200 }));

      render(
        <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} activeSemitones={5} />
      );
      const checkbox = screen.getByTestId('include-chords-video-checkbox');
      await user.click(checkbox);
      expect(checkbox).toBeChecked();

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        `/api/project/${mockProject.id}/render`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"include_chords":true'),
        })
      );
      const sentBody = JSON.parse((apiFetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(sentBody.semitones).toBe(5);
      expect(sentBody.include_chords).toBe(true);
    });

    it('passes includeChords: true to onStartRender callback when checked', async () => {
      const user = userEvent.setup();
      const onStartRenderMock = vi.fn();

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRenderMock}
        />
      );

      const checkbox = screen.getByTestId('include-chords-video-checkbox');
      await user.click(checkbox);

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(onStartRenderMock).toHaveBeenCalledWith({
        includeVisualizer: false,
        includeCountdown: true,
        includeChords: true,
      });
    });

    it('does NOT include includeChords in onStartRender callback when unchecked', async () => {
      const user = userEvent.setup();
      const onStartRenderMock = vi.fn();

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRenderMock}
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(onStartRenderMock).toHaveBeenCalledWith({
        includeVisualizer: false,
        includeCountdown: true,
      });
    });

    it('renders download-chord-sheet-btn and triggers GET /api/project/:id/export/chord-sheet', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['# Title: Harmonic Symphony\nC | G']), {
          status: 200,
          headers: {
            'Content-Disposition':
              "attachment; filename*=UTF-8''Harmonic%20Symphony%20(Chord%20Sheet).txt",
          },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:chord-sheet');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} activeSemitones={4} />
      );

      const chordSheetBtn = screen.getByTestId('download-chord-sheet-btn');
      expect(chordSheetBtn).toBeInTheDocument();
      await user.click(chordSheetBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        `/api/project/${mockProject.id}/export/chord-sheet?semitones=4`
      );
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

    it('parses standard Content-Disposition filename when RFC 5987 header is absent', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['C | G']), {
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="Harmonic_Symphony_Chords.txt"',
          },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:chord-sheet-std');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />);

      const chordSheetBtn = screen.getByTestId('download-chord-sheet-btn');
      await user.click(chordSheetBtn);

      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

    it('displays alert message when chord sheet download fails with server error', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Project backing audio not found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />);
      const chordSheetBtn = screen.getByTestId('download-chord-sheet-btn');
      await user.click(chordSheetBtn);

      expect(await screen.findByText('Project backing audio not found')).toBeInTheDocument();
    });

    it('forwards activeSemitones down to ExportSubtitleSection inside ExportModal', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['[Script Info]']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="modal-chords.ass"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:modal-ass');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} activeSemitones={7} />
      );

      const subtitleCheckbox = screen.getByTestId('include-chords-subtitle-checkbox');
      await user.click(subtitleCheckbox);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('include_chords=true');
      expect(url).toContain('semitones=7');
    });
  });

  describe('3. Accessibility & Responsive Viewports', () => {
    it('satisfies >=44px touch targets on all interactive controls in ExportModal', () => {
      const { container } = render(
        <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />
      );
      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toEqual([]);
    });

    it('satisfies >=44px touch targets on interactive controls in standalone ExportSubtitleSection', () => {
      const { container } = render(<ExportSubtitleSection project={mockProject} />);
      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toEqual([]);
    });

    it('satisfies zero horizontal overflow across 320px, 375px, 768px, and 1280px viewports', () => {
      const viewports = [320, 375, 768, 1280];
      for (const width of viewports) {
        setTestViewport(width, 667);
        const { container } = render(
          <div style={{ width, overflow: 'hidden' }}>
            <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />
          </div>
        );
        assertZeroHorizontalOverflow(container, width);
        cleanup();
      }
    });
  });
});
