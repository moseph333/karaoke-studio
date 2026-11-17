/**
 * What the Export dialog tells a new user: before a first render, what the button starts
 * and what comes after; while rendering, that the dialog can be closed.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExportModal } from '../../components/ExportModal';
import type { ProjectState } from '../../types';

const song: ProjectState = {
  id: 'export-guidance',
  status: 'ready',
  progress: 100,
  title: 'Golden Hour',
  artist: 'The Night Shift',
  duration: 200,
  lines: [{ id: 1, start_time: 0, end_time: 2, text: 'Hello there', words: [] }],
  semitones: 0,
  guide_volume: 0,
  render_status: 'idle',
  render_progress: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('before a first render', () => {
  it('lists the three steps from here to YouTube', () => {
    render(<ExportModal project={song} isOpen onClose={vi.fn()} />);

    const steps = within(screen.getByRole('list', { name: 'From here to YouTube' })).getAllByRole(
      'listitem'
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      '1. RenderA few minutes for most songs. You can close this dialog meanwhile.',
      '2. DownloadThe MP4 appears here, with a preview.',
      '3. Upload to YouTubeThe title, description and tags are written for you to paste.',
    ]);
  });

  it('says in plain words what goes into the video', () => {
    render(<ExportModal project={song} isOpen onClose={vi.fn()} />);
    const video = screen.getByRole('region', { name: /full video render/i });
    expect(video).toHaveTextContent(/the song as it is now/);
    expect(video).toHaveTextContent(/key and guide vocal from Audio mix/);
    expect(video).toHaveTextContent(/16:9 or 9:16 Shorts/);
    expect(video).not.toHaveTextContent(/Synthesize/);
  });

  it('drops the steps once the song has a video, as when rendering again', () => {
    render(
      <ExportModal
        project={{ ...song, render_status: 'error', video_url: '/media/golden-hour.mp4' }}
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId('export-next-steps')).toBeNull();
  });
});

describe('while rendering', () => {
  it('says the dialog can be closed and where the progress shows', () => {
    render(
      <ExportModal
        project={{ ...song, render_status: 'rendering', render_progress: 40 }}
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('render-leave-note')).toHaveTextContent(
      'You can close this dialog and keep working. The header shows the progress, and a message tells you when the video is ready.'
    );
    expect(screen.queryByTestId('export-next-steps')).toBeNull();
  });
});
