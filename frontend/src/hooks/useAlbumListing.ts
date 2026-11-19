/**
 * The song list of an album (GET /api/project/{id}/album), with the songs already made from
 * it. Fetched when the album opens and again on `reload`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlbumListing } from '../types';
import { apiFetch, readApiError } from '../api';

export interface UseAlbumListingReturn {
  listing: AlbumListing | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAlbumListing(albumId: string): UseAlbumListingReturn {
  const [listing, setListing] = useState<AlbumListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/project/${encodeURIComponent(albumId)}/album`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Could not load the album’s songs'));
      const data: AlbumListing = await res.json();
      if (controller.signal.aborted) return;
      setListing(data);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Could not load the album’s songs');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [albumId]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  return { listing, error, loading, reload: () => void load() };
}
