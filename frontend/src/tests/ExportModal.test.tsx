import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../components/ExportModal';
import { getFocusableElements } from '../hooks/useFocusTrap';
import { ProjectState } from '../types';
import * as apiModule from '../api';
import { THEMES } from '../components/VisualThemePicker';

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
});
