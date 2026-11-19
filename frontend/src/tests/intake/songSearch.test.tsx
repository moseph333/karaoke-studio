/**
 * The intake card's song search: typed words are searched as the typing pauses and list
 * songs (with a preview, the album, the year, the length and what kind of recording each
 * is), a misspelling is searched by its respelling, songs already in the library open
 * instead of being made again, and YouTube uploads stand in when a song is not listed or no
 * catalog answers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as apiModule from '../../api';
import { TrackSearch } from '../../components/TrackSearch';
import { SEARCH_DEBOUNCE_MS, isSearchable } from '../../hooks/useSongSearch';
import type { SearchResult, SongSearchResponse, SongSearchResult } from '../../types';

const song = (fields: Partial<SongSearchResult> & { id: string; title: string }) =>
  ({
    artist: 'Oasis',
    url: `https://www.deezer.com/track/${fields.id}`,
    album: '',
    year: null,
    duration: 258,
    preview: null,
    explicit: false,
    versions: [],
    project_id: null,
    project_status: null,
    ...fields,
  }) as SongSearchResult;

const WONDERWALL = song({
  id: 'deezer-1',
  title: 'Wonderwall',
  album: 'Stop The Clocks',
  year: 1995,
  preview: 'https://audio.example/wonderwall.m4a',
});
const WONDERWALL_LIVE = song({
  id: 'deezer-2',
  title: 'Wonderwall (Live at Knebworth)',
  album: 'Knebworth 1996',
  duration: 244,
  versions: ['live'],
  explicit: true,
  preview: 'https://audio.example/knebworth.m4a',
});
const UPLOAD: SearchResult = {
  id: 'bx1Bh8ZvH84',
  title: 'Oasis - Wonderwall (Official Video)',
  artist: 'Oasis',
  duration: 280,
  url: 'https://www.youtube.com/watch?v=bx1Bh8ZvH84',
};

type Answer = SongSearchResponse | { results: SearchResult[] } | Response | Promise<unknown>;

interface Requests {
  songs: string[];
  videos: string[];
}

/** Routes the two search endpoints to `songs(query)` and `videos(query)`. */
function mockSearch(
  songs: (query: string) => Answer,
  videos: (query: string) => Answer = () => ({ results: [] })
): Requests {
  const requests: Requests = { songs: [], videos: [] };
  vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, init) => {
    const path = String(url);
    if (!path.includes('/api/search')) return new Response(JSON.stringify({}), { status: 200 });
    const { query } = JSON.parse(String(init?.body ?? '{}')) as { query: string };
    const isSongs = path.includes('/api/search/songs');
    (isSongs ? requests.songs : requests.videos).push(query);
    const answer = await (isSongs ? songs : videos)(query);
    return answer instanceof Response
      ? answer
      : new Response(JSON.stringify(answer), { status: 200 });
  });
  return requests;
}

const catalogs = (results: SongSearchResult[], corrected: string | null = null) => ({
  results,
  corrected,
  sources: ['deezer', 'itunes'],
});

function renderSearch(props: Partial<React.ComponentProps<typeof TrackSearch>> = {}) {
  const onSelectTrack = vi.fn();
  const onOpenProject = vi.fn();
  render(
    <TrackSearch
      onSelectTrack={onSelectTrack}
      onOpenProject={onOpenProject}
      isLoading={false}
      {...props}
    />
  );
  const box = screen.getByRole('textbox', { name: /Search for a song or artist/i });
  return { box, onSelectTrack, onOpenProject };
}

const type = (box: HTMLElement, text: string) => fireEvent.change(box, { target: { value: text } });
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /search for a song or load a link/i }));
const songsList = () => screen.findByRole('list', { name: 'Songs' });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('searching as the typing pauses', () => {
  it('searches the words once the typing stops, not on every key', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();

    for (const text of ['wo', 'wonder', 'wonderwall']) {
      type(box, text);
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50));
    }
    expect(requests.songs).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(60));
    expect(requests.songs).toEqual(['wonderwall']);
    expect(requests.videos).toEqual([]);
    vi.useRealTimers();
    expect(await screen.findByText('Wonderwall')).toBeInTheDocument();
  });

  it('searches at once on Search, and not again when the pause follows', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();

    type(box, '  wonderwall   oasis ');
    submit();
    expect(requests.songs).toEqual(['wonderwall oasis']);

    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 3));
    expect(requests.songs).toEqual(['wonderwall oasis']);
  });

  it('does not search a link, one letter or an empty box', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();

    for (const text of ['w', '   ', 'https://youtu.be/dQw4w9WgXcQ', 'example.com/song']) {
      type(box, text);
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2));
    }

    expect(requests.songs).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('searches the same words again after the box was emptied', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();

    for (const text of ['wonderwall', '', 'wonderwall']) {
      type(box, text);
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 20));
    }

    expect(requests.songs).toEqual(['wonderwall', 'wonderwall']);
    expect(screen.getByText('Wonderwall')).toBeInTheDocument();
  });

  it('tells search words from links and stray letters', () => {
    expect(isSearchable('wonderwall')).toBe(true);
    expect(isSearchable('u2')).toBe(true);
    // One character is a word in some scripts
    expect(isSearchable('夜')).toBe(true);
    expect(isSearchable('w')).toBe(false);
    expect(isSearchable('  ')).toBe(false);
    expect(isSearchable('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toBe(false);
    expect(isSearchable('www.example.com/x')).toBe(false);
  });

  it('keeps only the answer to the latest words', async () => {
    let answerFirst: (value: unknown) => void = () => {};
    const requests = mockSearch((query) =>
      query === 'wonder'
        ? new Promise((resolve) => {
            answerFirst = resolve;
          })
        : catalogs([song({ id: 'deezer-9', title: 'Champagne Supernova' })])
    );
    const { box } = renderSearch();

    type(box, 'wonder');
    submit();
    type(box, 'champagne');
    submit();
    expect(await screen.findByText('Champagne Supernova')).toBeInTheDocument();

    // The slower, older answer arrives last and is dropped
    await act(async () => answerFirst(catalogs([WONDERWALL])));
    expect(requests.songs).toEqual(['wonder', 'champagne']);
    expect(screen.queryByText('Wonderwall')).not.toBeInTheDocument();
    expect(screen.getByText('Champagne Supernova')).toBeInTheDocument();
  });

  it('clears the results when the box is emptied or a link is pasted', async () => {
    mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();
    type(box, 'wonderwall');
    submit();
    await songsList();

    type(box, 'https://youtu.be/dQw4w9WgXcQ');

    await waitFor(() => expect(screen.queryByText('Wonderwall')).not.toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: /search for a song or load a link/i })
    ).toHaveTextContent('Go');
  });
});

describe('the songs that are listed', () => {
  it('shows each song with its artist, album, year, length and kind of recording', async () => {
    mockSearch(() => catalogs([WONDERWALL, WONDERWALL_LIVE]));
    const { box } = renderSearch();
    type(box, 'wonderwall oasis');
    submit();

    const [studio, live] = within(await songsList()).getAllByRole('listitem');

    expect(within(studio).getByRole('heading', { name: 'Wonderwall' })).toBeInTheDocument();
    expect(studio).toHaveTextContent('Oasis · Stop The Clocks · 1995 · 4:18');
    expect(within(studio).queryByText('Live')).not.toBeInTheDocument();
    expect(live).toHaveTextContent('Oasis · Knebworth 1996 · 4:04');
    expect(within(live).getByText('Live')).toBeInTheDocument();
    expect(within(live).getByText('Explicit')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 songs for “wonderwall oasis”');
  });

  it('says which spelling the songs are for when the words were respelled', async () => {
    mockSearch(() => catalogs([WONDERWALL], 'wonderwall oasis'));
    const { box } = renderSearch();
    type(box, 'wondewall oasis');
    submit();
    await songsList();

    expect(screen.getByRole('status')).toHaveTextContent(
      '1 song for “wonderwall oasis” (you typed “wondewall oasis”)'
    );
  });

  it('starts the picked song by its link, with the custom lyrics', async () => {
    mockSearch(() => catalogs([WONDERWALL, WONDERWALL_LIVE]));
    const { box, onSelectTrack } = renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    type(screen.getByLabelText(/custom plain lyrics text/i), 'Today is gonna be the day');
    type(box, 'wonderwall');
    submit();
    await songsList();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Create Karaoke: Wonderwall (Live at Knebworth) – Oasis, from Knebworth 1996',
      })
    );

    expect(onSelectTrack).toHaveBeenCalledTimes(1);
    expect(onSelectTrack).toHaveBeenCalledWith(
      'https://www.deezer.com/track/deezer-2',
      'Today is gonna be the day'
    );
  });

  it('opens a song that is already in the library instead of making it again', async () => {
    mockSearch(() =>
      catalogs([
        { ...WONDERWALL, project_id: 'applemusic-77', project_status: 'ready' },
        { ...WONDERWALL_LIVE, project_id: 'yt-live', project_status: 'separating' },
      ])
    );
    const { box, onSelectTrack, onOpenProject } = renderSearch();
    type(box, 'wonderwall');
    submit();
    const [studio, live] = within(await songsList()).getAllByRole('listitem');

    expect(within(studio).getByText('In your library')).toBeInTheDocument();
    expect(within(live).getByText('Being made')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Create Karaoke/ })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open: Wonderwall – Oasis, from Stop The Clocks' })
    );

    expect(onSelectTrack).not.toHaveBeenCalled();
    // A card-sized entry: the app fetches the song in full
    expect(onOpenProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'applemusic-77', status: 'ready', summary: true })
    );
  });

  it('lists the first five songs and the rest on request', async () => {
    const many = Array.from({ length: 8 }, (_, n) =>
      song({ id: `deezer-${n}`, title: `Song number ${n}` })
    );
    mockSearch(() => catalogs(many));
    const { box } = renderSearch();
    type(box, 'song number');
    submit();

    expect(within(await songsList()).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more songs' }));

    expect(within(await songsList()).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /more songs?$/ })).not.toBeInTheDocument();
  });

  it('forgets the results on Clear and does not search the same words again', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([WONDERWALL]));
    const { box } = renderSearch();
    type(box, 'wonderwall');
    submit();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText('Wonderwall')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search results' }));
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 3));

    expect(screen.queryByText('Wonderwall')).not.toBeInTheDocument();
    expect(box).toHaveValue('wonderwall');
    expect(box).toHaveFocus();
    expect(requests.songs).toEqual(['wonderwall']);
  });

  it('says so when the search does not get through, and searches again on request', async () => {
    let fail = true;
    const requests = mockSearch(() =>
      fail ? new Response('{"detail":"boom"}', { status: 500 }) : catalogs([WONDERWALL])
    );
    const { box } = renderSearch();
    type(box, 'wonderwall');
    submit();

    expect(await screen.findByText(/Search failed/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));

    expect(await screen.findByText('Wonderwall')).toBeInTheDocument();
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument();
    expect(requests.songs).toEqual(['wonderwall', 'wonderwall']);
  });
});

describe('YouTube uploads', () => {
  it('are listed on request, for the respelled words, under the songs', async () => {
    const requests = mockSearch(
      () => catalogs([WONDERWALL], 'wonderwall oasis'),
      () => ({ results: [UPLOAD] })
    );
    const { box, onSelectTrack } = renderSearch();
    type(box, 'wondewall oasis');
    submit();
    await songsList();
    expect(requests.videos).toEqual([]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Search YouTube uploads for “wonderwall oasis”' })
    );

    const uploads = await screen.findByRole('list', { name: 'YouTube uploads' });
    expect(requests.videos).toEqual(['wonderwall oasis']);
    expect(within(uploads).getByText('Oasis - Wonderwall (Official Video)')).toBeInTheDocument();
    // The songs stay listed above them
    expect(screen.getByRole('list', { name: 'Songs' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Create Karaoke: Oasis - Wonderwall (Official Video) – Oasis',
      })
    );
    expect(onSelectTrack).toHaveBeenCalledWith(UPLOAD.url, undefined);
  });

  it('are searched by themselves when Search finds no song', async () => {
    const requests = mockSearch(
      () => catalogs([]),
      () => ({ results: [UPLOAD] })
    );
    const { box } = renderSearch();
    type(box, 'some bootleg nobody lists');
    submit();

    expect(await screen.findByRole('list', { name: 'YouTube uploads' })).toBeInTheDocument();
    expect(requests.videos).toEqual(['some bootleg nobody lists']);
  });

  it('are only offered, not searched, when a pause in typing finds no song', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(() => catalogs([]));
    const { box } = renderSearch();

    type(box, 'zzzz qqqq');
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 20));

    expect(screen.getByRole('status')).toHaveTextContent('No songs found for “zzzz qqqq”.');
    expect(screen.getByRole('button', { name: /Search YouTube uploads/ })).toBeInTheDocument();
    expect(requests.videos).toEqual([]);
  });

  it('say so when neither a song nor an upload is found', async () => {
    mockSearch(() => catalogs([]));
    const { box } = renderSearch();
    type(box, 'zzzz qqqq');
    submit();

    expect(await screen.findByText(/No matching tracks found/)).toBeInTheDocument();
    expect(screen.getByText('Nothing on YouTube for “zzzz qqqq”')).toBeInTheDocument();
  });

  it('are the results when no music catalog answers, searched on Search only', async () => {
    vi.useFakeTimers();
    const requests = mockSearch(
      () => ({ results: [], corrected: null, sources: [] }),
      () => ({ results: [UPLOAD] })
    );
    const { box } = renderSearch();

    type(box, 'wonderwall');
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 20));
    expect(screen.getByRole('status')).toHaveTextContent('Press Search to look on YouTube.');

    // Further typing does not ask the catalogs again
    type(box, 'wonderwall oasis');
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2));
    expect(requests).toEqual({ songs: ['wonderwall'], videos: [] });

    submit();
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(requests.videos).toEqual(['wonderwall oasis']);
    expect(screen.getByRole('list', { name: 'YouTube uploads' })).toBeInTheDocument();
  });

  it('can be searched again after the YouTube search fails', async () => {
    let fail = true;
    mockSearch(
      () => catalogs([WONDERWALL]),
      () => (fail ? new Response('{}', { status: 500 }) : { results: [UPLOAD] })
    );
    const { box } = renderSearch();
    type(box, 'wonderwall');
    submit();
    await songsList();
    fireEvent.click(screen.getByRole('button', { name: /Search YouTube uploads/ }));

    expect(await screen.findByText('The YouTube search failed')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Search YouTube again' }));

    expect(await screen.findByRole('list', { name: 'YouTube uploads' })).toBeInTheDocument();
  });
});

describe('previewing a song', () => {
  const previewButton = (name: RegExp) => screen.getByRole('button', { name });

  async function listed() {
    mockSearch(() => catalogs([WONDERWALL, WONDERWALL_LIVE]));
    const result = renderSearch();
    type(result.box, 'wonderwall');
    submit();
    await songsList();
    return result;
  }

  it('plays the clip from the artwork and stops it on a second press', async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
    await listed();

    fireEvent.click(previewButton(/^Play a preview of Wonderwall – Oasis/));

    expect(play).toHaveBeenCalledTimes(1);
    expect((play.mock.instances[0] as unknown as HTMLAudioElement).src).toBe(WONDERWALL.preview);
    const stop = previewButton(/^Stop the preview of Wonderwall – Oasis/);
    expect(stop).toHaveAttribute('aria-pressed', 'true');

    pause.mockClear();
    fireEvent.click(stop);

    expect(pause).toHaveBeenCalled();
    expect(previewButton(/^Play a preview of Wonderwall – Oasis/)).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    // No audio element is put in the page: the studio's transport keeps the only one
    expect(document.querySelector('audio')).toBeNull();
  });

  it('plays one preview at a time', async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await listed();

    fireEvent.click(previewButton(/^Play a preview of Wonderwall – Oasis/));
    fireEvent.click(previewButton(/^Play a preview of Wonderwall \(Live at Knebworth\)/));

    expect(play).toHaveBeenCalledTimes(2);
    expect(within(await songsList()).getAllByRole('button', { pressed: true })).toEqual([
      previewButton(/^Stop the preview of Wonderwall \(Live at Knebworth\)/),
    ]);
  });

  it('does not start the song, and stops when the song is picked', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
    const { onSelectTrack } = await listed();

    fireEvent.click(previewButton(/^Play a preview of Wonderwall – Oasis/));
    expect(onSelectTrack).not.toHaveBeenCalled();

    pause.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Create Karaoke: Wonderwall – Oasis/ }));

    expect(onSelectTrack).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalled();
    expect(
      within(await songsList()).queryByRole('button', { pressed: true })
    ).not.toBeInTheDocument();
  });

  it('offers to try again when the clip will not play', async () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new DOMException('no supported source', 'NotSupportedError'))
      .mockResolvedValue(undefined);
    await listed();

    fireEvent.click(previewButton(/^Play a preview of Wonderwall – Oasis/));
    const retry = await screen.findByRole('button', {
      name: /^The preview would not play\. Try again: Wonderwall – Oasis/,
    });

    fireEvent.click(retry);

    expect(play).toHaveBeenCalledTimes(2);
    expect(previewButton(/^Stop the preview of Wonderwall – Oasis/)).toBeInTheDocument();
  });

  it('does not call a preview stopped while it loads a failure', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('interrupted by a call to pause()', 'AbortError')
    );
    await listed();

    fireEvent.click(previewButton(/^Play a preview of Wonderwall – Oasis/));
    await act(async () => {});

    expect(screen.queryByRole('button', { name: /would not play/ })).not.toBeInTheDocument();
  });

  it('has no preview control for a result without a clip', async () => {
    mockSearch(
      () => catalogs([song({ id: 'deezer-5', title: 'No Clip' })]),
      () => ({ results: [UPLOAD] })
    );
    const { box } = renderSearch();
    type(box, 'no clip');
    submit();

    expect(
      within(await songsList()).queryByRole('button', { name: /preview/i })
    ).not.toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  async function listed() {
    mockSearch(() => catalogs([WONDERWALL, WONDERWALL_LIVE]));
    const user = userEvent.setup();
    const result = renderSearch();
    await user.type(result.box, 'wonderwall');
    await songsList();
    const [first, second] = screen.getAllByRole('button', { name: /^Create Karaoke/ });
    return { ...result, user, first, second };
  }

  it('moves from the box into the results and between them with the arrow keys', async () => {
    const { box, user, first, second } = await listed();
    expect(box).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    // The last result is as far down as it goes
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(box).toHaveFocus();
  });

  it('starts the focused song with Enter', async () => {
    const { user, onSelectTrack } = await listed();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelectTrack).toHaveBeenCalledTimes(1);
    expect(onSelectTrack).toHaveBeenCalledWith(WONDERWALL_LIVE.url, undefined);
  });

  it('returns to the box with Escape, and clears the results with Escape there', async () => {
    const { box, user } = await listed();

    await user.keyboard('{ArrowDown}{Escape}');
    expect(box).toHaveFocus();
    expect(screen.getByText('Wonderwall')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Wonderwall')).not.toBeInTheDocument();
    expect(box).toHaveValue('wonderwall');
  });
});
