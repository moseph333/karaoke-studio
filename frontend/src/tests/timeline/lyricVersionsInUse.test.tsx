import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';
import type { LyricCandidate } from '../../types';

const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  readApiError: async () => 'failed',
}));
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

const CLEAN: LyricCandidate = {
  id: 11911175,
  track_name: 'Laser Sharks (Original Mix)',
  artist_name: 'Savant',
  album_name: 'Protos',
  duration: 242,
  synced_lyrics: '[00:40.00]Now, here comes a different product of evolution',
  quality_flags: [],
};
const MESSY: LyricCandidate = {
  id: 1866922,
  track_name: 'Laser Sharks',
  artist_name: 'Savant',
  album_name: 'Protos',
  duration: 244,
  synced_lyrics: '[00:39.70] A DIFFERENT PRODUCT OF EVOLUTION',
  quality_flags: ['all_caps', 'repeat_markers'],
};

function answer(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

async function searchVersions(inUseId: number | null) {
  mockApiFetch.mockImplementation((url: string) =>
    url.includes('/candidates')
      ? answer([CLEAN, MESSY].map((c) => ({ ...c, in_use: c.id === inUseId })))
      : answer({ lines: [] })
  );
  const user = userEvent.setup();
  render(
    <LyricReplacementModal
      isOpen
      onClose={vi.fn()}
      projectId="sharks"
      trackTitle="Laser Sharks"
      trackArtist="Savant"
      onSuccess={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));
  await user.click(screen.getByRole('button', { name: /Search Candidates/i }));
  await waitFor(() => expect(screen.getByTestId('lyric-candidate-1')).toBeInTheDocument());
  return user;
}

describe('the list of LRCLIB versions', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('marks the version the song uses and names what is wrong with sloppy ones', async () => {
    await searchVersions(CLEAN.id as number);
    const first = screen.getByTestId('lyric-candidate-0');
    const second = screen.getByTestId('lyric-candidate-1');
    expect(within(first).getByTestId('badge-in-use')).toHaveTextContent('In use');
    expect(within(second).queryByTestId('badge-in-use')).not.toBeInTheDocument();
    expect(within(second).getByTestId('quality-flag-all_caps')).toHaveTextContent('All caps');
    expect(within(second).getByTestId('quality-flag-repeat_markers')).toBeInTheDocument();
    expect(within(first).queryByTestId(/quality-flag-/)).not.toBeInTheDocument();
  });

  it('shows no in-use mark when the lyrics came from elsewhere', async () => {
    await searchVersions(null);
    expect(screen.queryByTestId('badge-in-use')).not.toBeInTheDocument();
  });

  it('tells the server which listing was applied', async () => {
    const user = await searchVersions(null);
    await user.click(
      screen.getByRole('button', { name: /Apply candidate Laser Sharks \(Original Mix\)/i })
    );
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/project/sharks/realign-lyrics',
        expect.objectContaining({ method: 'POST' })
      )
    );
    const call = mockApiFetch.mock.calls.find(([url]) => String(url).endsWith('realign-lyrics'));
    expect(JSON.parse(call![1].body)).toMatchObject({ lyric_source_id: CLEAN.id });
  });
});
