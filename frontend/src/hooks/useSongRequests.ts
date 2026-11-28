/**
 * The song requests the server holds (`utils/songRequests`): read when the screen opens and
 * again when `reloadKey` changes (the studio's sign-in), then kept in step by what each
 * request and removal answers. Used by the host screen, which adds to the list, and by the
 * studio's home screen, which removes from it.
 *
 * A host screen is open for a whole night while the owner makes the songs asked for, which
 * takes them off the list somewhere else. With `refreshOnFocus` the list is read again when
 * the window is come back to, at most twice a minute.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSongRequests,
  removeSongRequest,
  sendSongRequest,
  type SongRequest,
  type SongRequestResult,
} from '../utils/songRequests';

export interface UseSongRequests {
  requests: SongRequest[];
  /** Files a request for a song the show could not find. */
  ask: (song: string, singer?: string, show?: string) => Promise<SongRequestResult>;
  /** Takes a request off the list. */
  remove: (id: string) => Promise<SongRequestResult>;
}

export interface UseSongRequestsOptions {
  /** Reads the list again when the window gets the focus back (the host screen). */
  refreshOnFocus?: boolean;
}

/** The list is not read again on focus sooner than this after it was last read. */
export const REQUESTS_FRESH_MS = 30_000;

export function useSongRequests(
  reloadKey?: unknown,
  { refreshOnFocus = false }: UseSongRequestsOptions = {}
): UseSongRequests {
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [look, setLook] = useState(0);
  const readAt = useRef(0);
  // A list read before a change must not replace the list that change answered with
  const version = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const asked = ++version.current;
    readAt.current = Date.now();
    void fetchSongRequests().then((list) => {
      if (list && mounted.current && asked === version.current) setRequests(list);
    });
  }, [reloadKey, look]);

  useEffect(() => {
    if (!refreshOnFocus) return;
    const seen = () => {
      if (Date.now() - readAt.current >= REQUESTS_FRESH_MS) setLook((n) => n + 1);
    };
    window.addEventListener('focus', seen);
    return () => window.removeEventListener('focus', seen);
  }, [refreshOnFocus]);

  const keep = useCallback((result: SongRequestResult): SongRequestResult => {
    if (result.ok && mounted.current) {
      version.current += 1;
      readAt.current = Date.now();
      setRequests(result.requests);
    }
    return result;
  }, []);

  const ask = useCallback(
    (song: string, singer = '', show = '') => sendSongRequest(song, singer, show).then(keep),
    [keep]
  );
  const remove = useCallback((id: string) => removeSongRequest(id).then(keep), [keep]);

  return { requests, ask, remove };
}
