/**
 * The open song's melody for practice: the pitch its singer holds over time, which the
 * server works out from the vocals on first request and keeps (`GET …/melody`).
 *
 * Asked for only when it is wanted (the singer turned the pitch display on): most songs are
 * never practised this way, and a first request costs the server an analysis.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { MelodyData } from '../types';

/** `missing`: the song has no melody to show (no vocals, nothing sung, or the request failed). */
export type MelodyStatus = 'idle' | 'loading' | 'ready' | 'missing';

export interface UseMelodyOptions {
  /** Ask for the melody now. */
  wanted: boolean;
  projectId: string | undefined;
  /** The song's vocal stem link: new vocals (a re-separation) have a new melody. */
  vocalsUrl: string | undefined;
}

export interface UseMelodyReturn {
  melody: MelodyData | null;
  status: MelodyStatus;
}

interface Loaded {
  key: string;
  melody: MelodyData | null;
}

function usable(data: unknown): data is MelodyData {
  const melody = data as Partial<MelodyData> | null;
  return (
    !!melody &&
    Array.isArray(melody.midi) &&
    typeof melody.hop === 'number' &&
    melody.hop > 0 &&
    typeof melody.start === 'number'
  );
}

export function useMelody({ wanted, projectId, vocalsUrl }: UseMelodyOptions): UseMelodyReturn {
  const key = projectId && vocalsUrl ? `${projectId}|${vocalsUrl}` : '';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Another song, or new vocals: the melody held is not this one's
  const current = loaded && loaded.key === key ? loaded : null;

  useEffect(() => {
    if (!wanted || !key || !projectId || current) return;
    const abort = new AbortController();
    let cancelled = false;
    void (async () => {
      let melody: MelodyData | null = null;
      try {
        const res = await apiFetch(`/api/project/${projectId}/melody`, { signal: abort.signal });
        const data: unknown = res.ok ? await res.json() : null;
        if (usable(data) && data.detected) melody = data;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        console.error('Could not load the melody', err);
      }
      if (!cancelled) setLoaded({ key, melody });
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [wanted, key, projectId, current]);

  if (!key) return { melody: null, status: wanted ? 'missing' : 'idle' };
  if (!current) return { melody: null, status: wanted ? 'loading' : 'idle' };
  return { melody: current.melody, status: current.melody ? 'ready' : 'missing' };
}
