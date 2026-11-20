import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportAudioSection } from '../../components/export/ExportAudioSection';
import type { ProjectState } from '../../types';
import * as apiModule from '../../api';

const song: ProjectState = {
  id: 'parts-song',
  title: 'Choir Anthem',
  artist: 'The Harmonies',
  status: 'ready',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0,
};
const split: ProjectState = { ...song, vocal_splits: { lead_backing: { model: 'm' } } };

describe('vocal part stems in the export dialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('are not offered for a song whose vocals are one stem', () => {
    render(<ExportAudioSection project={song} />);

    expect(screen.getAllByRole('button', { name: /^Download/ })).toHaveLength(3);
    expect(screen.queryByText('Backing Vocal Stem')).toBeNull();
  });

  it('are offered once the vocals are split, with 44px buttons', () => {
    render(<ExportAudioSection project={split} />);

    const buttons = screen.getAllByRole('button', { name: /^Download/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Download Instrumental Stem',
      'Download Vocal Stem',
      'Download Master Mix',
      'Download Lead Vocal Stem',
      'Download Backing Vocal Stem',
    ]);
    for (const button of buttons) expect(button.className).toContain('min-h-[44px]');
  });

  it('download from the stem route under the name the server gives', async () => {
    const user = userEvent.setup();
    const apiSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      new Response(new Blob(['RIFF']), {
        status: 200,
        headers: {
          'Content-Disposition':
            'attachment; filename="The Harmonies - Choir Anthem (Backing Vocals).wav"',
        },
      })
    );
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.download);
    });
    render(<ExportAudioSection project={split} />);

    await user.click(screen.getByRole('button', { name: 'Download Backing Vocal Stem' }));

    await waitFor(() =>
      expect(clicked).toEqual(['The Harmonies - Choir Anthem (Backing Vocals).wav'])
    );
    expect(apiSpy).toHaveBeenCalledWith('/api/project/parts-song/export/audio/backing_vocals');
  });

  it('say why a part could not be downloaded', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Audio file for lead_vocals not found on disk' }), {
        status: 400,
      })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ExportAudioSection project={split} />);

    await user.click(screen.getByRole('button', { name: 'Download Lead Vocal Stem' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Audio file for lead_vocals not found on disk'
    );
  });
});
