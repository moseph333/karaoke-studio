/**
 * A show's "Add a singer": the singer's name, then their song. A song is a karaoke video
 * found on YouTube (the typed words are searched with "karaoke" added; a pasted YouTube link
 * is taken as it is) or a song from the library. A song that neither has can be asked for:
 * the typed words go on the request list (`utils/songRequests`), for the owner to make.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ListPlus, Plus, Search } from 'lucide-react';
import { apiFetch } from '../../api';
import { fetchShowVideo } from '../../hooks/useShowVideos';
import type { ProjectState, SearchResult } from '../../types';
import { formatTime } from '../../utils/format';
import { cleanSinger, type ShowSource } from '../../utils/showQueue';
import { cleanSongRequest } from '../../utils/songRequests';
import { karaokeQuery, youtubeVideoId } from '../../utils/youtube';
import { Button, Field, Input, Spinner, Tabs } from '../ui';

type SongTab = 'videos' | 'library';

const TABS = [
  { id: 'videos' as const, label: 'Karaoke videos', controls: 'show-song-panel' },
  { id: 'library' as const, label: 'Library', controls: 'show-song-panel' },
];
const VIDEO_RESULTS = 8;
const row = 'flex items-center gap-3 border-b border-theme-border-subtle py-2';

export interface ShowAddSingerProps {
  onAdd: (singer: string, source: ShowSource) => void;
  /** Asks for a song that could not be found, with the singer's name when one is typed.
   *  Resolves to whether the request was taken. Without it nothing can be asked for. */
  onRequest?: (song: string, singer: string) => Promise<boolean>;
}

function videoSource(result: SearchResult): ShowSource {
  return {
    kind: 'youtube',
    videoId: result.id,
    title: result.title,
    artist: result.artist,
    duration: result.duration ?? null,
    thumbnail: result.thumbnail ?? null,
  };
}

/** The library list is read again once it is this old: songs are made during a night. */
const LIBRARY_FRESH_MS = 60_000;

export const ShowAddSinger: React.FC<ShowAddSingerProps> = ({ onAdd, onRequest }) => {
  const [singer, setSinger] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [tab, setTab] = useState<SongTab>('videos');
  const [words, setWords] = useState('');
  const [videos, setVideos] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<ProjectState[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  /** Goes up to have the library looked at again; it is read only when its copy is old. */
  const [libraryLook, setLibraryLook] = useState(0);
  const libraryReadAt = useRef(0);
  const [requesting, setRequesting] = useState(false);
  const singerRef = useRef<HTMLInputElement>(null);
  const searchRun = useRef(0);
  const singerId = useId();
  const wordsId = useId();

  // A clean slate for the next singer: the name, the words searched and what they found
  // (the library tab then lists every song again). A search still on its way is dropped
  const reset = useCallback(() => {
    searchRun.current += 1;
    setSinger('');
    setNeedsName(false);
    setWords('');
    setVideos(null);
    setSearching(false);
    setSearchError(null);
    setLibraryLook((look) => look + 1);
    singerRef.current?.focus();
  }, []);

  const add = useCallback(
    (source: ShowSource) => {
      const name = cleanSinger(singer);
      if (!name) {
        setNeedsName(true);
        singerRef.current?.focus();
        return;
      }
      onAdd(name, source);
      reset();
    },
    [singer, onAdd, reset]
  );

  // What would be asked for: the typed words, unless they are a link to a video
  const wanted = youtubeVideoId(words.trim()) ? '' : cleanSongRequest(words);
  const request = useCallback(async () => {
    if (!onRequest || !wanted || requesting) return;
    setRequesting(true);
    const taken = await onRequest(wanted, cleanSinger(singer));
    setRequesting(false);
    if (taken) reset();
  }, [onRequest, wanted, requesting, singer, reset]);

  const searchVideos = useCallback(async () => {
    const typed = words.trim();
    if (!typed) return;
    const run = ++searchRun.current;
    setSearching(true);
    setSearchError(null);
    try {
      const pasted = youtubeVideoId(typed);
      let results: SearchResult[];
      if (pasted) {
        const info = await fetchShowVideo(pasted);
        results = [
          {
            id: pasted,
            title: info?.title ?? 'YouTube video',
            artist: info?.channel ?? 'YouTube',
            url: `https://www.youtube.com/watch?v=${pasted}`,
          },
        ];
      } else {
        const response = await apiFetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: karaokeQuery(typed), limit: VIDEO_RESULTS }),
        });
        if (!response.ok) throw new Error('search failed');
        const body = (await response.json()) as { results?: SearchResult[] };
        results = (body.results ?? []).filter((result) => Boolean(result.id));
      }
      if (run === searchRun.current) setVideos(results);
    } catch {
      if (run === searchRun.current) {
        setVideos(null);
        setSearchError('The search did not answer. Try again in a moment.');
      }
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  }, [words]);

  // The library is read when its tab is opened, and again whenever it is looked at with a
  // copy over a minute old: when the tab is opened again, the window is come back to, or a
  // singer has just been queued. A song finished during the night is then there to pick
  const onLibrary = tab === 'library';
  useEffect(() => {
    if (!onLibrary) return;
    if (Date.now() - libraryReadAt.current <= LIBRARY_FRESH_MS) return;
    let cancelled = false;
    apiFetch('/api/projects?scope=all&summary=1')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((data: Record<string, ProjectState>) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const songs = Object.values(data ?? {}).filter((song) => {
          if (!song?.id || song.status !== 'ready' || seen.has(song.id)) return false;
          seen.add(song.id);
          return true;
        });
        libraryReadAt.current = Date.now();
        setLibraryError(false);
        setLibrary(songs.reverse());
      })
      .catch(() => {
        // A list already in hand stays: it is tried again at the next look
        if (!cancelled) setLibraryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onLibrary, libraryLook]);
  useEffect(() => {
    if (!onLibrary) return;
    const look = () => setLibraryLook((n) => n + 1);
    window.addEventListener('focus', look);
    return () => window.removeEventListener('focus', look);
  }, [onLibrary]);

  const librarySongs = useMemo(() => {
    const needle = words.trim().toLowerCase();
    if (!library) return [];
    if (!needle) return library;
    return library.filter((song) =>
      `${song.title ?? ''} ${song.artist ?? ''}`.toLowerCase().includes(needle)
    );
  }, [library, words]);

  // Offered once the song has been looked for: YouTube nearly always lists something for
  // any words, so a search that found videos may still not have found the song
  const requestLine = (lead: string) =>
    onRequest &&
    wanted && (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-48 break-words text-sm text-theme-text-muted">
          {lead} Ask for “{wanted}” to be made for another night.
        </p>
        <Button
          variant="secondary"
          className="min-h-[44px] shrink-0"
          leftIcon={<ListPlus className="h-4 w-4" aria-hidden="true" />}
          loading={requesting}
          loadingLabel="Sending the request"
          aria-label={`Request the song ${wanted}`}
          onClick={() => void request()}
        >
          Request it
        </Button>
      </div>
    );

  return (
    <section aria-labelledby="show-add-heading" className="flex flex-col gap-4">
      <h2 id="show-add-heading" className="ks-display text-[32px] font-black text-theme-text">
        Add a singer
      </h2>

      <Field
        label="Singer"
        htmlFor={singerId}
        error={needsName ? 'Type the singer’s name first.' : undefined}
      >
        <Input
          id={singerId}
          ref={singerRef}
          value={singer}
          maxLength={40}
          autoComplete="off"
          placeholder="Name"
          onChange={(e) => {
            setSinger(e.target.value);
            if (e.target.value.trim()) setNeedsName(false);
          }}
        />
      </Field>

      <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Where the song comes from" />

      <form
        role="search"
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (tab === 'videos') void searchVideos();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field
            label={tab === 'videos' ? 'Song, artist or a YouTube link' : 'Find in the library'}
            htmlFor={wordsId}
          >
            <Input
              id={wordsId}
              value={words}
              autoComplete="off"
              placeholder={tab === 'videos' ? 'Dancing Queen' : 'Title or artist'}
              onChange={(e) => setWords(e.target.value)}
            />
          </Field>
        </div>
        {tab === 'videos' && (
          <Button
            type="submit"
            variant="secondary"
            className="min-h-[44px]"
            leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
            loading={searching}
            loadingLabel="Searching"
            disabled={!words.trim()}
          >
            Search
          </Button>
        )}
      </form>

      <div id="show-song-panel" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'videos' ? (
          <>
            {searchError && (
              <p role="alert" className="text-sm text-theme-danger">
                {searchError}
              </p>
            )}
            {searching && !videos && (
              <p className="flex items-center gap-2 text-sm text-theme-text-muted">
                <Spinner /> Searching YouTube
              </p>
            )}
            {videos && videos.length === 0 && (
              <p className="text-sm text-theme-text-muted">
                No videos found. Try the artist with the title.
              </p>
            )}
            {videos && videos.length > 0 && (
              <ul data-testid="show-video-results">
                {videos.map((result) => (
                  <li key={result.id} className={row}>
                    {result.thumbnail ? (
                      <img
                        src={result.thumbnail}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-12 w-20 shrink-0 object-cover"
                      />
                    ) : (
                      <div className="h-12 w-20 shrink-0 border border-theme-border-subtle" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-theme-text">
                        {result.title}
                      </p>
                      <p className="truncate text-sm tabular-nums text-theme-text-muted">
                        {result.artist}
                        {result.duration ? ` · ${formatTime(result.duration)}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="min-h-[44px] shrink-0"
                      leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                      aria-label={`Add the video ${result.title}`}
                      onClick={() => add(videoSource(result))}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {!videos && !searching && !searchError && (
              <p className="text-sm text-theme-text-muted">
                Search for the song and pick a karaoke video of it. It plays on the stage window.
              </p>
            )}
            {videos && requestLine(videos.length > 0 ? 'None of these?' : 'Not on YouTube?')}
          </>
        ) : (
          <>
            {libraryError && !library && (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-theme-danger">
                  The library could not be read.
                </p>
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  onClick={() => {
                    setLibraryError(false);
                    setLibraryLook((look) => look + 1);
                  }}
                >
                  Read it again
                </Button>
              </div>
            )}
            {!library && !libraryError && (
              <p className="flex items-center gap-2 text-sm text-theme-text-muted">
                <Spinner /> Reading the library
              </p>
            )}
            {library && librarySongs.length === 0 && (
              <p className="text-sm text-theme-text-muted">
                {library.length === 0
                  ? 'The library has no finished songs yet.'
                  : 'No song in the library matches.'}
              </p>
            )}
            {librarySongs.length > 0 && (
              <ul data-testid="show-library-results">
                {librarySongs.map((song) => (
                  <li key={song.id} className={row}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-theme-text">{song.title}</p>
                      <p className="truncate text-sm tabular-nums text-theme-text-muted">
                        {song.artist}
                        {song.duration ? ` · ${formatTime(song.duration)}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="min-h-[44px] shrink-0"
                      leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                      aria-label={`Add the song ${song.title}`}
                      onClick={() =>
                        add({
                          kind: 'library',
                          projectId: song.id,
                          title: song.title ?? 'Song',
                          artist: song.artist ?? '',
                          duration: song.duration ?? null,
                          thumbnail: song.thumbnail_url ?? null,
                        })
                      }
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {library && librarySongs.length === 0 && requestLine('Not in the library?')}
          </>
        )}
      </div>
    </section>
  );
};
