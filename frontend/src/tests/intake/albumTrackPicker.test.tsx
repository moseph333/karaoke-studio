/**
 * The album picker: a pasted or uploaded whole album lists its songs, says where the list
 * came from, and makes the picked songs (with corrected names and artist) songs of their own.
 * Songs made already open from their rows; a long song taken for an album can still be made
 * as one song.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlbumTrackPicker } from '../../components/album/AlbumTrackPicker';
import type { AlbumListing, ProjectState } from '../../types';

const albumProject: ProjectState = {
  id: 'AlbumVid001',
  status: 'album',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0,
  title: 'Seasick',
  artist: 'Imperial Teen',
};

const listing = (overrides: Partial<AlbumListing> = {}): AlbumListing => ({
  id: 'AlbumVid001',
  kind: 'link',
  title: 'Seasick',
  artist: 'Imperial Teen',
  duration: 2328,
  source: 'chapters',
  whole_allowed: true,
  tracks: [
    { number: 1, title: 'Imperial Teen', start: 0, end: 296.7, named: true },
    {
      number: 2,
      title: 'Water Boy',
      start: 296.7,
      end: 393.2,
      named: true,
      project_id: 'AlbumVid001-t02',
      project_status: 'ready',
    },
    { number: 3, title: 'Butch', start: 393.2, end: 660.3, named: true },
    {
      number: 4,
      title: 'Track 4',
      start: 660.3,
      end: 2328,
      named: false,
      project_id: 'AlbumVid001-t04',
      project_status: 'error',
    },
  ],
  ...overrides,
});

function mockListing(body: AlbumListing) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    )
  );
}

function renderPicker(props: Partial<React.ComponentProps<typeof AlbumTrackPicker>> = {}) {
  const handlers = {
    onMakeSongs: vi.fn().mockResolvedValue({ projects: [] }),
    onMakeWhole: vi.fn().mockResolvedValue(true),
    onOpenSong: vi.fn(),
    onBack: vi.fn(),
  };
  render(<AlbumTrackPicker project={albumProject} {...handlers} {...props} />);
  return handlers;
}

describe('the album picker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists the songs with their place in the album and where the list came from', async () => {
    mockListing(listing());
    renderPicker();

    expect(await screen.findByRole('heading', { level: 1, name: 'Seasick' })).toBeInTheDocument();
    const songs = await screen.findByRole('list', { name: 'Songs of Seasick' });
    expect(within(songs).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/the video's chapters/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('album-track-3')).getByText(/6:33 – 11:00 · 4:27/)
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Album artist' })).toHaveValue('Imperial Teen');
  });

  it('opens a song made already instead of picking it again', async () => {
    mockListing(listing());
    const { onOpenSong } = renderPicker();

    const made = await screen.findByTestId('album-track-2');
    expect(within(made).queryByRole('checkbox')).toBeNull();
    await userEvent.click(within(made).getByRole('button', { name: /Open song 2, Water Boy/ }));
    expect(onOpenSong).toHaveBeenCalledWith('AlbumVid001-t02', 'ready');
  });

  it('makes the picked songs, with a corrected name and artist', async () => {
    mockListing(listing());
    const { onMakeSongs } = renderPicker();

    const first = await screen.findByTestId('album-track-1');
    await userEvent.click(within(first).getByRole('checkbox'));
    await userEvent.click(within(first).getByRole('button', { name: 'Rename song 1' }));
    const name = within(first).getByRole('textbox', { name: 'Name of song 1' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Imperial Teen (Song)');
    await userEvent.click(within(screen.getByTestId('album-track-3')).getByRole('checkbox'));
    const artist = screen.getByRole('textbox', { name: 'Album artist' });
    await userEvent.clear(artist);
    await userEvent.type(artist, 'Imperial Teen & Friends');

    await userEvent.click(screen.getByRole('button', { name: 'Make 2 songs' }));

    expect(onMakeSongs).toHaveBeenCalledWith(
      'AlbumVid001',
      [{ number: 1, title: 'Imperial Teen (Song)' }, { number: 3 }],
      'Imperial Teen & Friends'
    );
  });

  it('asks for the name of a picked song that has none, and says a failed one can be tried again', async () => {
    mockListing(listing());
    renderPicker();

    const unnamed = await screen.findByTestId('album-track-4');
    expect(within(unnamed).getByText(/Failed last time/)).toBeInTheDocument();
    await userEvent.click(within(unnamed).getByRole('checkbox'));
    expect(screen.getByTestId('album-unnamed-hint')).toHaveTextContent('Song 4 has no name yet');

    await userEvent.type(
      within(unnamed).getByRole('textbox', { name: 'Name of song 4' }),
      'Pig Latin'
    );
    expect(screen.queryByTestId('album-unnamed-hint')).toBeNull();
  });

  it('picks every song that is not made yet, and none again', async () => {
    mockListing(listing());
    renderPicker();

    await userEvent.click(await screen.findByRole('button', { name: 'Pick all' }));
    expect(screen.getByRole('button', { name: 'Make 3 songs' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pick none' }));
    expect(screen.getByRole('button', { name: 'Pick songs to make' })).toBeDisabled();
  });

  it('makes the whole recording one song only where the server allows it', async () => {
    mockListing(listing());
    const { onMakeWhole } = renderPicker();
    await userEvent.click(await screen.findByRole('button', { name: 'Make it all one song' }));
    expect(onMakeWhole).toHaveBeenCalledWith('AlbumVid001');
  });

  it('offers no whole song for a recording too long to be one', async () => {
    mockListing(listing({ whole_allowed: false }));
    renderPicker();
    await screen.findByTestId('album-track-1');
    expect(screen.queryByRole('button', { name: 'Make it all one song' })).toBeNull();
  });

  it('says how the songs of an album nothing names were found', async () => {
    mockListing(listing({ source: 'pauses', kind: 'upload' }));
    renderPicker();
    expect(await screen.findByText(/Nothing names the songs in this file/)).toBeInTheDocument();
  });

  it('says when no songs could be told apart', async () => {
    mockListing(listing({ source: 'none', tracks: [] }));
    renderPicker();
    expect(await screen.findByText(/No songs could be told apart\. Make/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pick songs/ })).toBeNull();
  });

  it('says when the list cannot be loaded and loads it again', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'That song is not an album to pick from.' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValue(
        new Response(JSON.stringify(listing()), { headers: { 'Content-Type': 'application/json' } })
      );
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('not an album to pick from');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
