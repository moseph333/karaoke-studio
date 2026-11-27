/**
 * The song requests the server holds (`utils/songRequests`): read when the screen opens and
 * again when `reloadKey` changes (the studio's sign-in), then kept in step by what each
 * request and removal answers. Used by the host screen, which adds to the list, and by the
 * studio's home screen, which removes from it.
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

export function useSongRequests(reloadKey?: unknown): UseSongRequests {
  const [requests, setRequests] = useState<SongRequest[]>([]);
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
    void fetchSongRequests().then((list) => {
      if (list && mounted.current && asked === version.current) setRequests(list);
    });
  }, [reloadKey]);

  const keep = useCallback((result: SongRequestResult): SongRequestResult => {
    if (result.ok && mounted.current) {
      version.current += 1;
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
