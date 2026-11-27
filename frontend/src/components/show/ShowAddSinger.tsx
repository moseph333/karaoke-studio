/**
 * A show's "Add a singer": the singer's name, then their song. A song is a karaoke video
 * found on YouTube (the typed words are searched with "karaoke" added; a pasted YouTube link
 * is taken as it is) or a song from the library.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { apiFetch } from '../../api';
import { fetchShowVideo } from '../../hooks/useShowVideos';
import type { ProjectState, SearchResult } from '../../types';
import { formatTime } from '../../utils/format';
import { cleanSinger, type ShowSource } from '../../utils/showQueue';
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

export const ShowAddSinger: React.FC<ShowAddSingerProps> = ({ onAdd }) => {
  const [singer, setSinger] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [tab, setTab] = useState<SongTab>('videos');
  const [words, setWords] = useState('');
  const [videos, setVideos] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [library, setLibrary] = useState<ProjectState[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const singerRef = useRef<HTMLInputElement>(null);
  const searchRun = useRef(0);
  const singerId = useId();
  const wordsId = useId();

  const add = useCallback(
    (source: ShowSource) => {
      const name = cleanSinger(singer);
      if (!name) {
        setNeedsName(true);
        singerRef.current?.focus();
        return;
      }
      onAdd(name, source);
      setSinger('');
      setNeedsName(false);
      singerRef.current?.focus();
    },
    [singer, onAdd]
  );

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

  // The library is read when its tab is first opened
  const wantsLibrary = tab === 'library' && library === null && !libraryError;
  useEffect(() => {
    if (!wantsLibrary) return;
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
        setLibrary(songs.reverse());
      })
      .catch(() => {
        if (!cancelled) setLibraryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsLibrary]);

  const librarySongs = useMemo(() => {
    const needle = words.trim().toLowerCase();
    if (!library) return [];
    if (!needle) return library;
    return library.filter((song) =>
      `${song.title ?? ''} ${song.artist ?? ''}`.toLowerCase().includes(needle)
    );
  }, [library, words]);

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
          </>
        ) : (
          <>
            {libraryError && (
              <p role="alert" className="text-sm text-theme-danger">
                The library could not be read. Reload the page to try again.
              </p>
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
          </>
        )}
      </div>
    </section>
  );
};
