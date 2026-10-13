import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../components/ExportModal';
import { ProjectState } from '../types';

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
});
