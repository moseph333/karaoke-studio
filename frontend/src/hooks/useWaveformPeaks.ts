/**
 * Server-computed waveform peaks for the transport scrubber. Returns null until they arrive
 * (or if the server cannot provide them), in which case the scrubber decodes in the browser;
 * `settled` says when the request has finished, so that fallback (which downloads the whole
 * master WAV) waits for it instead of racing it. They are fetched again when `audioVersion`
 * (the master audio URL) changes, as after a key change or new stems; the previous peaks stay
 * up until the new ones arrive.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export const WAVEFORM_BINS = 800;

export interface WaveformPeaksState {
  peaks: number[] | null;
  /** The request for this song has finished, with or without peaks. */
  settled: boolean;
}

export function useWaveformPeaksState(
  projectId: string | undefined,
  enabled: boolean,
  audioVersion?: string | null
): WaveformPeaksState {
  const [loaded, setLoaded] = useState<{ projectId: string; peaks: number[] } | null>(null);
  const [settledFor, setSettledFor] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !enabled) return;
    const controller = new AbortController();
    apiFetch(`/api/project/${encodeURIComponent(projectId)}/waveform?bins=${WAVEFORM_BINS}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        const peaks = Array.isArray(data?.peaks)
          ? (data.peaks as unknown[]).filter((p): p is number => typeof p === 'number')
          : [];
        if (peaks.length > 0) setLoaded({ projectId, peaks });
        setSettledFor(projectId);
      })
      .catch(() => {
        // Network error: the scrubber falls back to browser decoding (an abort is not final)
        if (!controller.signal.aborted) setSettledFor(projectId);
      });
    return () => controller.abort();
  }, [projectId, enabled, audioVersion]);

  return {
    peaks: loaded && loaded.projectId === projectId ? loaded.peaks : null,
    settled: settledFor !== null && settledFor === projectId,
  };
}

export function useWaveformPeaks(
  projectId: string | undefined,
  enabled: boolean,
  audioVersion?: string | null
): number[] | null {
  return useWaveformPeaksState(projectId, enabled, audioVersion).peaks;
}
