/**
 * Song search for the intake box. Typed words are searched as the typing pauses
 * (`POST /api/search/songs`: songs from the music catalogs, misspellings tolerated), and at
 * once on `submit`. YouTube uploads (`POST /api/search`) are listed on request, for a
 * recording the catalogs do not have, and by themselves after a submit that found no songs
 * or reached no catalog. A newer search cancels the one before it, and a late answer is
 * dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import type { SearchResult, SongSearchResponse, SongSearchResult } from '../types';
import { linkSite, looksLikeLink } from '../utils/mediaLinks';

/** How long the typing must pause before the words are searched. */
export const SEARCH_DEBOUNCE_MS = 350;
/** Songs asked for; the list shows the first few and the rest on request. */
export const SONG_RESULT_LIMIT = 12;
export const VIDEO_RESULT_LIMIT = 8;

export type SearchPhase = 'idle' | 'searching' | 'done' | 'error';

export interface SongSearchState {
  /** The words the listed songs are for. */
  query: string;
  phase: SearchPhase;
  songs: SongSearchResult[];
  /** The respelling that was searched too, e.g. "bohemian rhapsody" for "bohemian rapsody". */
  corrected: string | null;
  /** False once a search reached no music catalog: only YouTube uploads can be listed. */
  catalog: boolean;
  videosPhase: SearchPhase;
  videos: SearchResult[];
  /** The words the listed YouTube uploads are for (the respelling, when there is one). */
  videosQuery: string;
}

const EMPTY: SongSearchState = {
  query: '',
  phase: 'idle',
  songs: [],
  corrected: null,
  catalog: true,
  videosPhase: 'idle',
  videos: [],
  videosQuery: '',
};

/** Whether the text is words to search for: not empty, not a link, and more than one
 * letter (one is enough in scripts whose words are a character or two). */
export function isSearchable(text: string): boolean {
  const clean = text.trim();
  if (!clean || linkSite(clean) || looksLikeLink(clean)) return false;
  // eslint-disable-next-line no-control-regex
  return clean.length >= 2 || /[^\u0000-\u007f]/.test(clean);
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error('Search failed');
  return (await res.json()) as T;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

export interface UseSongSearch extends SongSearchState {
  /** Search the words now, without waiting for a pause (Enter, the Search button). */
  submit: () => void;
  /** List YouTube uploads for the words. */
  searchVideos: () => void;
  /** Forget the results. */
  clear: () => void;
}

/**
 * @param text what is in the search box
 * @param enabled false while searching makes no sense (the upload tab, a song starting)
 */
export function useSongSearch(text: string, enabled = true): UseSongSearch {
  const [state, setState] = useState<SongSearchState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const songsRequest = useRef<AbortController | null>(null);
  const videosRequest = useRef<AbortController | null>(null);
  // The words last sent to the song search, so a pause after Enter does not search again
  const requested = useRef('');

  const searchVideosFor = useCallback((query: string) => {
    videosRequest.current?.abort();
    const controller = new AbortController();
    videosRequest.current = controller;
    setState((s) => ({
      ...s,
      query: s.query || query,
      videosPhase: 'searching',
      videosQuery: query,
    }));
    postJson<{ results?: SearchResult[] }>(
      '/api/search',
      { query, limit: VIDEO_RESULT_LIMIT },
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, videosPhase: 'done', videos: data.results ?? [] }));
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setState((s) => ({ ...s, videosPhase: 'error', videos: [] }));
      });
  }, []);

  const searchSongs = useCallback(
    (raw: string, submitted: boolean) => {
      const query = raw.trim().replace(/\s+/g, ' ');
      const current = stateRef.current;
      const same = query === requested.current && current.phase !== 'error';
      // A pause never repeats a search, also not one whose results were dismissed
      if (same && (!submitted || current.phase === 'searching')) return;
      if (same && current.phase === 'done') {
        // Enter on words already searched: what is missing is the uploads, when there
        // are no songs to show
        if (current.songs.length === 0 && current.videosPhase === 'idle') {
          searchVideosFor(current.corrected ?? query);
        }
        return;
      }
      requested.current = query;
      songsRequest.current?.abort();
      videosRequest.current?.abort();
      const controller = new AbortController();
      songsRequest.current = controller;
      // The songs on screen stay, under their own words, until the new ones arrive
      setState((s) => ({
        ...s,
        query: s.songs.length > 0 ? s.query : query,
        phase: 'searching',
        videosPhase: 'idle',
        videos: [],
      }));
      postJson<SongSearchResponse>(
        '/api/search/songs',
        { query, limit: SONG_RESULT_LIMIT },
        controller.signal
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          const songs = data.results ?? [];
          const catalog = !Array.isArray(data.sources) || data.sources.length > 0;
          setState((s) => ({
            ...s,
            query,
            phase: 'done',
            songs,
            corrected: data.corrected ?? null,
            catalog,
          }));
          // Asked for by name and no song to show: look among YouTube's uploads
          if (submitted && songs.length === 0) searchVideosFor(data.corrected ?? query);
        })
        .catch((err: unknown) => {
          if (isAbort(err) || controller.signal.aborted) return;
          setState((s) => ({ ...s, query, phase: 'error', songs: [], corrected: null }));
        });
    },
    [searchVideosFor]
  );

  const reset = useCallback(() => {
    songsRequest.current?.abort();
    videosRequest.current?.abort();
    setState((s) => ({ ...EMPTY, catalog: s.catalog }));
  }, []);

  // Dismissed results stay dismissed until the words change or Search is pressed
  const clear = reset;

  // Search once the typing pauses. Without a catalog every search is a slow YouTube one,
  // so those wait for Enter.
  const searchable = enabled && isSearchable(text);
  const catalog = state.catalog;
  useEffect(() => {
    if (!searchable || !catalog) return;
    const timer = window.setTimeout(() => searchSongs(text, false), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, searchable, catalog, searchSongs]);

  // An emptied box, a pasted link or the upload tab: nothing to list
  const hasResults = state.phase !== 'idle' || state.videosPhase !== 'idle';
  useEffect(() => {
    if (searchable) return;
    // Typing the same words again later is a new search
    requested.current = '';
    if (hasResults) reset();
  }, [searchable, hasResults, reset]);

  useEffect(
    () => () => {
      songsRequest.current?.abort();
      videosRequest.current?.abort();
    },
    []
  );

  const submit = useCallback(() => {
    if (isSearchable(text)) searchSongs(text, true);
  }, [text, searchSongs]);

  const searchVideos = useCallback(() => {
    const { corrected, query: searched } = stateRef.current;
    const query = corrected || searched || text.trim().replace(/\s+/g, ' ');
    if (query) searchVideosFor(query);
  }, [text, searchVideosFor]);

  return { ...state, submit, searchVideos, clear };
}
