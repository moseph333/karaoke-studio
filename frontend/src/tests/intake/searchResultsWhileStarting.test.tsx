import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as apiModule from '../../api';
import { TrackSearch } from '../../components/TrackSearch';

const results = [
  { id: 'a1', title: 'First Song', artist: 'Band', url: 'https://youtu.be/a1', duration: 200 },
  { id: 'b2', title: 'Second Song', artist: 'Band', url: 'https://youtu.be/b2', duration: 210 },
];

/** Renders the home screen with search results listed; `rerender` sets `isLoading`. */
async function renderWithResults() {
  vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url) =>
    String(url).includes('/api/search')
      ? new Response(JSON.stringify({ results }), { status: 200 })
      : new Response(JSON.stringify([]), { status: 200 })
  );
  const onSelectTrack = vi.fn();
  const view = (isLoading: boolean) => (
    <TrackSearch onSelectTrack={onSelectTrack} isLoading={isLoading} />
  );
  const user = userEvent.setup();
  const { rerender } = render(view(false));
  await user.type(screen.getByLabelText(/Paste a song link/i), 'some song');
  await user.click(screen.getByRole('button', { name: /Search YouTube or load track/i }));
  await screen.findByText('First Song');
  return { onSelectTrack, setLoading: (isLoading: boolean) => rerender(view(isLoading)) };
}

describe('search results while a song is being started', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the clicked result', async () => {
    const { onSelectTrack } = await renderWithResults();

    fireEvent.click(screen.getByText('First Song'));

    expect(onSelectTrack).toHaveBeenCalledTimes(1);
    expect(onSelectTrack).toHaveBeenCalledWith('https://youtu.be/a1', undefined);
  });

  it('ignores further clicks on any result until the start has finished', async () => {
    const { onSelectTrack, setLoading } = await renderWithResults();

    fireEvent.click(screen.getByText('First Song'));
    setLoading(true);
    fireEvent.click(screen.getByText('First Song'));
    fireEvent.click(screen.getByText('Second Song'));
    fireEvent.click(screen.getByRole('button', { name: /Create Karaoke: Second Song/ }));

    expect(onSelectTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Create Karaoke: Second Song/ })).toBeDisabled();

    // A failed start leaves the results usable again
    setLoading(false);
    fireEvent.click(screen.getByText('Second Song'));
    expect(onSelectTrack).toHaveBeenLastCalledWith('https://youtu.be/b2', undefined);
  });
});
