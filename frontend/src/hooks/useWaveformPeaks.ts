/**
 * Server-computed waveform peaks for the transport scrubber. Returns null until they arrive
 * (or if the server cannot provide them), in which case the scrubber decodes in the browser.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export const WAVEFORM_BINS = 800;

export function useWaveformPeaks(projectId: string | undefined, enabled: boolean): number[] | null {
  const [loaded, setLoaded] = useState<{ projectId: string; peaks: number[] } | null>(null);

  useEffect(() => {
    if (!projectId || !enabled) return;
    const controller = new AbortController();
    apiFetch(`/api/project/${encodeURIComponent(projectId)}/waveform?bins=${WAVEFORM_BINS}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const peaks = Array.isArray(data?.peaks)
          ? (data.peaks as unknown[]).filter((p): p is number => typeof p === 'number')
          : [];
        if (!controller.signal.aborted && peaks.length > 0) setLoaded({ projectId, peaks });
      })
      .catch(() => {
        // Network error or aborted: the scrubber falls back to browser decoding
      });
    return () => controller.abort();
  }, [projectId, enabled]);

  return loaded && loaded.projectId === projectId ? loaded.peaks : null;
}
