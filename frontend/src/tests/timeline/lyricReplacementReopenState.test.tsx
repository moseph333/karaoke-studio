import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';

const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  readApiError: async (_res: unknown, fallback: string) => fallback,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

/** The dialog as the timeline renders it: always mounted, shown through `isOpen`. */
function modal(open: boolean, title = 'First Title', artist = 'First Artist') {
  return (
    <LyricReplacementModal
      isOpen={open}
      onClose={vi.fn()}
      projectId="proj-1"
      trackTitle={title}
      trackArtist={artist}
      onSuccess={vi.fn()}
    />
  );
}

const openSearchTab = () =>
  fireEvent.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));

describe('reopening the replace-lyrics dialog', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('searches for the title and artist the song has now', () => {
    const { rerender } = render(modal(true));
    openSearchTab();
    fireEvent.change(screen.getByLabelText('Track Title'), { target: { value: 'typo' } });

    rerender(modal(false));
    // The song is renamed while the dialog is closed
    rerender(modal(false, 'Renamed Title', 'Renamed Artist'));
    rerender(modal(true, 'Renamed Title', 'Renamed Artist'));

    expect(screen.getByLabelText('Track Title')).toHaveValue('Renamed Title');
    expect(screen.getByLabelText('Artist Name')).toHaveValue('Renamed Artist');
  });

  it('shows no results or error from the last time it was open', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 1, track_name: 'Old Result', artist_name: 'Someone', plain_lyrics: 'la la' },
      ],
    });
    const { rerender } = render(modal(true));
    openSearchTab();
    fireEvent.click(screen.getByRole('button', { name: 'Search Candidates' }));
    expect(await screen.findByText('Old Result')).toBeInTheDocument();

    mockApiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    fireEvent.click(screen.getByRole('button', { name: 'Search Candidates' }));
    expect(await screen.findByText('Failed to search lyric candidates')).toBeInTheDocument();

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.queryByText('Old Result')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to search lyric candidates')).not.toBeInTheDocument();
  });

  it('keeps the search fields while it stays open and the song is polled', () => {
    const { rerender } = render(modal(true));
    openSearchTab();
    fireEvent.change(screen.getByLabelText('Track Title'), { target: { value: 'My query' } });

    rerender(modal(true));

    expect(screen.getByLabelText('Track Title')).toHaveValue('My query');
  });

  it('keeps pasted lyrics when it is closed and opened again', () => {
    const { rerender } = render(modal(true));
    fireEvent.change(screen.getByLabelText(/Lyric Text or LRC Timestamps/i), {
      target: { value: 'pasted words' },
    });

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByLabelText(/Lyric Text or LRC Timestamps/i)).toHaveValue('pasted words');
  });
});
