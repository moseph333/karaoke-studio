import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportAudioSection } from '../../components/export/ExportAudioSection';
import { ProjectState } from '../../types';
import * as apiModule from '../../api';

describe('ExportAudioSection', () => {
  const mockProject: ProjectState = {
    id: 'proj_stem_123',
    title: 'Neon Horizon',
    artist: 'Synthwave Duo',
    status: 'ready',
    progress: 100,
    lines: [],
    semitones: 0,
    guide_volume: 0.0,
    instrumental_url: '/static/stems/proj_stem_123/instrumental.wav',
    vocals_url: '/static/stems/proj_stem_123/vocals.wav',
    master_audio_url: '/static/output/proj_stem_123_master.wav',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders section title and all 3 audio stem options', () => {
    render(<ExportAudioSection project={mockProject} />);

    expect(screen.getByText('Direct Audio Stem Downloads')).toBeInTheDocument();
    expect(screen.getByText('Instrumental Stem')).toBeInTheDocument();
    expect(screen.getByText('Vocal Stem')).toBeInTheDocument();
    expect(screen.getByText('Master Mix')).toBeInTheDocument();

    const downloadButtons = screen.getAllByRole('button', { name: /^Download/i });
    expect(downloadButtons).toHaveLength(3);
  });

  it('provides >=44px accessible touch targets for all stem download buttons', () => {
    render(<ExportAudioSection project={mockProject} />);

    const downloadButtons = screen.getAllByRole('button', { name: /^Download/i });
    for (const btn of downloadButtons) {
      expect(btn.className).toContain('min-h-[44px]');
    }
  });

  it('disables download buttons when project status is not ready', () => {
    const unreadyProject: ProjectState = {
      ...mockProject,
      status: 'downloading',
    };
    render(<ExportAudioSection project={unreadyProject} />);

    const downloadButtons = screen.getAllByRole('button', { name: /^Download/i });
    for (const btn of downloadButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('triggers apiFetch with correct endpoint when downloading instrumental stem', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['sample-wav-data'], { type: 'audio/wav' });

    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        'Content-Disposition':
          'attachment; filename="Synthwave Duo - Neon Horizon (Instrumental).wav"',
      }),
    } as unknown as Response);

    render(<ExportAudioSection project={mockProject} />);

    const instBtn = screen.getByRole('button', { name: 'Download Instrumental Stem' });
    await user.click(instBtn);

    expect(apiModule.apiFetch).toHaveBeenCalledTimes(1);
    expect(apiModule.apiFetch).toHaveBeenCalledWith(
      '/api/project/proj_stem_123/export/audio/instrumental'
    );
  });

  it('triggers apiFetch when downloading vocal and master stems', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['sample-wav-data'], { type: 'audio/wav' });

    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="Synthwave Duo - Neon Horizon (Vocals).wav"',
      }),
    } as unknown as Response);

    render(<ExportAudioSection project={mockProject} />);

    const vocalsBtn = screen.getByRole('button', { name: 'Download Vocal Stem' });
    await user.click(vocalsBtn);

    expect(apiModule.apiFetch).toHaveBeenCalledWith(
      '/api/project/proj_stem_123/export/audio/vocals'
    );

    const masterBtn = screen.getByRole('button', { name: 'Download Master Mix' });
    await user.click(masterBtn);

    expect(apiModule.apiFetch).toHaveBeenCalledWith(
      '/api/project/proj_stem_123/export/audio/master'
    );
  });

  it('displays error alert when audio stem export fails', async () => {
    const user = userEvent.setup();

    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: 'Audio file for instrumental not found on disk' }),
    } as unknown as Response);

    render(<ExportAudioSection project={mockProject} />);

    const instBtn = screen.getByRole('button', { name: 'Download Instrumental Stem' });
    await user.click(instBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText(/Audio file for instrumental not found on disk/i)
      ).toBeInTheDocument();
    });
  });
});
