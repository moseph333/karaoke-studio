import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../../components/ExportModal';
import { getFocusableElements } from '../../hooks/useFocusTrap';
import { ProjectState } from '../../types';
import * as apiModule from '../../api';
import { THEMES } from '../../components/VisualThemePicker';

describe('ExportModal', () => {
  const baseProject: ProjectState = {
    id: 'test-project-export',
    status: 'ready',
    progress: 100,
    lines: [],
    semitones: 0,
    guide_volume: 0.0,
    render_status: 'completed',
    video_url: '/static/rendered_output.mp4',
    youtube_package: {
      title: 'Queen - Bohemian Rhapsody (Karaoke Version)',
      description: 'Karaoke backing track for Bohemian Rhapsody with synchronized lyrics.',
      tags: ['karaoke', 'queen', 'bohemian rhapsody'],
      key_note: 'Original Key (0 st)',
      lyrics: 'Is this the real life? Is this just fantasy?',
      privacy_status: 'public',
    },
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ExportModal project={baseProject} isOpen={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal dialog when isOpen is true', () => {
    render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Export & YouTube Package/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportModal project={baseProject} isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes modal when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<ExportModal project={baseProject} isOpen={true} onClose={onClose} />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies YouTube title to clipboard when copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText');
    render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

    const copyTitleBtn = screen.getByRole('button', { name: /copy title/i });
    await user.click(copyTitleBtn);

    expect(writeSpy).toHaveBeenCalledWith('Queen - Bohemian Rhapsody (Karaoke Version)');
  });

  it('shows rendering progress bar and status when render is in progress', () => {
    const renderingProject: ProjectState = {
      ...baseProject,
      render_status: 'rendering',
      render_progress: 42,
      render_detail: 'Encoding video frames at 60fps...',
    };

    render(<ExportModal project={renderingProject} isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Rendering High-Definition Karaoke Video/i)).toBeInTheDocument();
    expect(screen.getByText(/42\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/Encoding video frames at 60fps.../i)).toBeInTheDocument();
  });

  // --- Feature 45: Focus Trap & A11y Tests ---

  it('renders with complete ARIA attributes including aria-describedby', () => {
    render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'export-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'export-modal-desc');
  });

  it('traps focus inside the modal and wraps Tab from last element back to first', async () => {
    const user = userEvent.setup();
    render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    const focusable = getFocusableElements(dialog);
    expect(focusable.length).toBeGreaterThan(0);

    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];

    expect(firstElement).toHaveFocus();

    lastElement.focus();
    expect(lastElement).toHaveFocus();

    // Tab wraps around to first focusable element
    await user.tab();
    expect(firstElement).toHaveFocus();
  });

  describe('Subtitle Export Controls', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('renders subtitle export section with Download .LRC and .ASS buttons when render_status is idle', () => {
      const idleProject: ProjectState = {
        ...baseProject,
        render_status: 'idle',
        video_url: undefined,
      };

      render(
        <ExportModal
          project={idleProject}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="16:9"
          selectedTheme={THEMES[0]}
        />
      );

      expect(screen.getByText(/Synchronized Subtitles \(\.LRC & \.ASS\)/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download \.lrc subtitles/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download \.ass subtitles/i })).toBeInTheDocument();
    });

    it('provides >=44px accessible touch targets for both subtitle download buttons', () => {
      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      expect(lrcBtn.className).toContain('min-h-[44px]');
      expect(assBtn.className).toContain('min-h-[44px]');
    });

    it('renders subtitle export buttons concurrently while video rendering is active', () => {
      const renderingProject: ProjectState = {
        ...baseProject,
        render_status: 'rendering',
        render_progress: 35,
      };

      render(<ExportModal project={renderingProject} isOpen={true} onClose={vi.fn()} />);

      // Subtitle buttons must still be present
      expect(screen.getByRole('button', { name: /download \.lrc subtitles/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download \.ass subtitles/i })).toBeInTheDocument();
      // And render progress must also be present
      expect(screen.getByText(/Rendering High-Definition Karaoke Video/i)).toBeInTheDocument();
    });

    it('triggers apiFetch with /api/project/:id/export/lrc when clicking Download .LRC', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['[00:01.00]Hello world\n'], { type: 'text/plain' });
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="Queen - Bohemian Rhapsody.lrc"',
          },
        })
      );

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-lrc');
      window.URL.revokeObjectURL = vi.fn();

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith('/api/project/test-project-export/export/lrc');
    });

    it('triggers apiFetch with theme and aspect ratio query parameters when clicking Download .ASS', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['[Script Info]\nTitle: Test\n'], { type: 'text/x-ssa' });
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 200,
          headers: {
            'Content-Type': 'text/x-ssa; charset=utf-8',
            'Content-Disposition': 'attachment; filename="Queen - Bohemian Rhapsody.ass"',
          },
        })
      );

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-ass');
      window.URL.revokeObjectURL = vi.fn();

      render(
        <ExportModal
          project={baseProject}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
          selectedTheme={THEMES[1]} // cyber_cyan
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/project/test-project-export/export/ass?aspect_ratio=9%3A16&theme_id=cyber_cyan'
      );
    });

    it('displays structured error message when subtitle export endpoint fails', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Project lyrics are not ready for export' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(
        await screen.findByText('Project lyrics are not ready for export')
      ).toBeInTheDocument();
    });
  });

  describe('Video Render Options & Visualizer Toggle', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('renders visualizer toggle checkbox with min-44px touch target and unchecked by default', () => {
      const idleProject: ProjectState = {
        ...baseProject,
        render_status: 'idle',
        video_url: undefined,
      };

      render(<ExportModal project={idleProject} isOpen={true} onClose={vi.fn()} />);

      const toggleCheckbox = screen.getByTestId('toggle-export-visualizer');
      expect(toggleCheckbox).toBeInTheDocument();
      expect(toggleCheckbox).not.toBeChecked();
      expect(toggleCheckbox.className).toContain('min-h-[44px]');
      expect(toggleCheckbox.className).toContain('min-w-[44px]');
    });

    it('toggles visualizer checkbox state and invokes onStartRender with includeVisualizer flag', async () => {
      const user = userEvent.setup();
      const onStartRender = vi.fn();
      const idleProject: ProjectState = {
        ...baseProject,
        render_status: 'idle',
        video_url: undefined,
      };

      render(
        <ExportModal
          project={idleProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRender}
        />
      );

      const toggleCheckbox = screen.getByTestId('toggle-export-visualizer');
      await user.click(toggleCheckbox);
      expect(toggleCheckbox).toBeChecked();

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(onStartRender).toHaveBeenCalledWith({
        includeVisualizer: true,
        includeCountdown: true,
      });
    });

    it('triggers direct apiFetch POST /api/project/:id/render with visualizer and countdown options', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const idleProject: ProjectState = {
        ...baseProject,
        render_status: 'idle',
        video_url: undefined,
        semitones: 2,
        guide_volume: 0.5,
      };

      render(
        <ExportModal
          project={idleProject}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
          selectedTheme={THEMES[1]} // cyber_cyan
        />
      );

      const toggleCheckbox = screen.getByTestId('toggle-export-visualizer');
      await user.click(toggleCheckbox);
      expect(toggleCheckbox).toBeChecked();

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledWith('/api/project/test-project-export/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semitones: 2,
          guide_volume: 0.5,
          aspect_ratio: '9:16',
          include_visualizer: true,
          include_countdown: true,
          style_config: { theme_id: 'cyber_cyan' },
        }),
      });
    });
  });

  describe('Rendering again', () => {
    it('brings the options back over a finished video and renders again', async () => {
      const user = userEvent.setup();
      const onStartRender = vi.fn();
      render(
        <ExportModal
          project={baseProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRender}
        />
      );
      expect(screen.getByText(/your video is ready/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start video render/i })).toBeNull();

      await user.click(screen.getByRole('button', { name: /render again/i }));

      expect(screen.getByText(/full video render/i)).toBeInTheDocument();
      expect(screen.getByText(/current video stays available/i)).toBeInTheDocument();
      expect(screen.queryByText(/download video/i)).toBeNull();
      await user.click(screen.getByTestId('toggle-export-visualizer'));
      await user.click(screen.getByRole('button', { name: /start video render/i }));

      expect(onStartRender).toHaveBeenCalledWith({
        includeVisualizer: true,
        includeCountdown: true,
      });
    });

    it('keeps the current video when the new render is called off', async () => {
      const user = userEvent.setup();
      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /render again/i }));
      await user.click(screen.getByRole('button', { name: /keep current video/i }));

      expect(screen.getByText(/your video is ready/i)).toBeInTheDocument();
      expect(screen.getByText(/download video/i)).toBeInTheDocument();
    });

    it('offers Try Again after a failed render', async () => {
      const user = userEvent.setup();
      const onStartRender = vi.fn();
      const failed: ProjectState = {
        ...baseProject,
        render_status: 'error',
        render_error: 'FFmpeg exited with code 1',
        video_url: undefined,
      };
      render(
        <ExportModal
          project={failed}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRender}
        />
      );
      expect(screen.getByText('FFmpeg exited with code 1')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /try again/i }));

      expect(screen.queryByText('FFmpeg exited with code 1')).toBeNull();
      expect(screen.queryByRole('button', { name: /keep current video/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: /start video render/i }));
      expect(onStartRender).toHaveBeenCalledTimes(1);
    });

    it('shows the new video once the new render finishes', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />
      );
      await user.click(screen.getByRole('button', { name: /render again/i }));

      rerender(
        <ExportModal
          project={{ ...baseProject, render_status: 'rendering', render_progress: 40 }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /cancel render/i })).toBeInTheDocument();

      rerender(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);
      expect(screen.getByText(/your video is ready/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /start video render/i })).toBeNull();
    });

    it('shows the finished video again when the dialog reopens', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />
      );
      await user.click(screen.getByRole('button', { name: /render again/i }));

      rerender(<ExportModal project={baseProject} isOpen={false} onClose={vi.fn()} />);
      rerender(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      expect(screen.getByText(/your video is ready/i)).toBeInTheDocument();
    });
  });

  describe('Videos kept across formats and unfinished renders', () => {
    const wideUrl = '/static/output/song_karaoke.mp4?v=100';
    const tallUrl = '/static/output/song_karaoke_vertical.mp4?v=200';
    const bothFormats: ProjectState = {
      ...baseProject,
      artist: 'Queen',
      title: 'Bohemian Rhapsody',
      video_url: tallUrl,
      videos_by_aspect: { '16:9': wideUrl, '9:16': tallUrl },
    };

    it('offers the other format next to the latest video', () => {
      render(<ExportModal project={bothFormats} isOpen={true} onClose={vi.fn()} />);

      const main = screen.getByRole('link', { name: /download video/i });
      expect(main).toHaveAttribute('href', tallUrl);
      expect(main).toHaveAttribute('download', 'Queen - Bohemian Rhapsody (9x16).mp4');
      const other = screen.getByRole('link', { name: 'Download 16:9 video' });
      expect(other).toHaveAttribute('href', wideUrl);
      expect(other).toHaveAttribute('download', 'Queen - Bohemian Rhapsody (16x9).mp4');
      expect(other.className).toContain('min-h-[44px]');
      expect(screen.queryByRole('link', { name: 'Download 9:16 video' })).toBeNull();
    });

    it('names each video after its format whichever was rendered last', () => {
      const { rerender } = render(
        <ExportModal
          project={{ ...bothFormats, video_url: wideUrl }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
        />
      );
      expect(screen.getByRole('link', { name: /download video/i })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (16x9).mp4'
      );
      expect(screen.getByRole('link', { name: 'Download 9:16 video' })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (9x16).mp4'
      );

      rerender(<ExportModal project={bothFormats} isOpen={true} onClose={vi.fn()} />);
      expect(screen.getByRole('link', { name: /download video/i })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (9x16).mp4'
      );
      expect(screen.getByRole('link', { name: 'Download 16:9 video' })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (16x9).mp4'
      );
    });

    it('keeps the bare name for a video from before formats were recorded', () => {
      render(
        <ExportModal
          project={{ ...baseProject, artist: 'Queen', title: 'Bohemian Rhapsody' }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('link', { name: /download video/i })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody.mp4'
      );
    });

    it('labels the finished video with its own format, not the selected one', () => {
      const { container, rerender } = render(
        <ExportModal project={bothFormats} isOpen={true} onClose={vi.fn()} aspectRatio="16:9" />
      );
      // Before the video's metadata arrives, the preview frame follows the offered file's format
      const previewFrame = () =>
        (container.querySelector('video') as HTMLVideoElement).parentElement as HTMLElement;
      expect(screen.getByText('9:16 Shorts · 1080p60')).toBeInTheDocument();
      expect(Number(previewFrame().style.aspectRatio)).toBeCloseTo(9 / 16, 3);
      expect(previewFrame().className).toContain('max-w-xs');

      rerender(
        <ExportModal
          project={{ ...bothFormats, video_url: wideUrl }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
        />
      );
      expect(screen.getByText('16:9 · 1080p60')).toBeInTheDocument();
      expect(Number(previewFrame().style.aspectRatio)).toBeCloseTo(16 / 9, 3);
      expect(previewFrame().className).not.toContain('max-w-xs');

      // A legacy video's format is unknown, so the badge keeps the selected format
      rerender(
        <ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} aspectRatio="9:16" />
      );
      expect(screen.getByText('9:16 Shorts · 1080p60')).toBeInTheDocument();
    });

    it('offers no other format when the song has one video', () => {
      const { rerender } = render(
        <ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />
      );
      expect(screen.queryByRole('link', { name: /download 16:9 video/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /download 9:16 video/i })).toBeNull();

      rerender(
        <ExportModal
          project={{ ...bothFormats, videos_by_aspect: { '9:16': tallUrl } }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByRole('link', { name: /download 16:9 video/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /download 9:16 video/i })).toBeNull();
    });

    it("offers the failed format's previous video first, then the other format's", () => {
      // The last render was 9:16; a 16:9 render then failed
      render(
        <ExportModal
          project={{ ...bothFormats, render_status: 'error', render_error: 'FFmpeg exited' }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="16:9"
        />
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      const kept = screen.getAllByRole('link', { name: /download previous/i });
      expect(kept.map((link) => link.textContent)).toEqual([
        'Download previous 16:9 video',
        'Download previous 9:16 video',
      ]);
      expect(kept[0]).toHaveAttribute('href', wideUrl);
      expect(kept[0]).toHaveAttribute('download', 'Queen - Bohemian Rhapsody (16x9).mp4');
      expect(kept[1]).toHaveAttribute('href', tallUrl);
      expect(kept[1]).toHaveAttribute('download', 'Queen - Bohemian Rhapsody (9x16).mp4');
      for (const link of kept) expect(link.className).toContain('min-h-[44px]');
    });

    it('keeps the previous videos downloadable after a cancelled render', () => {
      render(
        <ExportModal
          project={{
            ...bothFormats,
            video_url: wideUrl,
            render_status: 'idle',
            render_detail: 'Rendering cancelled',
          }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
        />
      );

      expect(screen.getByRole('button', { name: /start video render/i })).toBeInTheDocument();
      const kept = screen.getAllByRole('link', { name: /download previous/i });
      expect(kept.map((link) => link.getAttribute('href'))).toEqual([tallUrl, wideUrl]);
      expect(screen.getByRole('link', { name: 'Download previous 9:16 video' })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (9x16).mp4'
      );
      expect(screen.getByRole('link', { name: 'Download previous 16:9 video' })).toHaveAttribute(
        'download',
        'Queen - Bohemian Rhapsody (16x9).mp4'
      );
    });

    it('falls back to the latest video when the failed format has none', () => {
      render(
        <ExportModal
          project={{
            ...bothFormats,
            videos_by_aspect: { '9:16': tallUrl },
            render_status: 'error',
            render_error: 'FFmpeg exited',
          }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="16:9"
        />
      );

      const kept = screen.getAllByRole('link', { name: /download previous/i });
      expect(kept).toHaveLength(1);
      expect(kept[0]).toHaveAccessibleName('Download previous 9:16 video');
      expect(kept[0]).toHaveAttribute('href', tallUrl);
      expect(kept[0]).toHaveAttribute('download', 'Queen - Bohemian Rhapsody (9x16).mp4');
    });

    it('offers a video from before formats were recorded under its bare name', () => {
      render(
        <ExportModal
          project={{
            ...baseProject,
            artist: 'Queen',
            title: 'Bohemian Rhapsody',
            render_status: 'error',
            render_error: 'FFmpeg exited',
          }}
          isOpen={true}
          onClose={vi.fn()}
          aspectRatio="9:16"
        />
      );

      const kept = screen.getAllByRole('link', { name: /download previous/i });
      expect(kept).toHaveLength(1);
      expect(kept[0]).toHaveAccessibleName('Download previous video');
      expect(kept[0]).toHaveAttribute('href', baseProject.video_url);
      expect(kept[0]).toHaveAttribute('download', 'Queen - Bohemian Rhapsody.mp4');
    });

    it('offers no previous video when there is none or while rendering again over it', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ExportModal
          project={{ ...baseProject, render_status: 'error', video_url: undefined }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByRole('link', { name: /download previous/i })).toBeNull();

      rerender(<ExportModal project={bothFormats} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /render again/i }));

      expect(screen.getByRole('button', { name: /keep current video/i })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /download previous/i })).toBeNull();
    });
  });
});
