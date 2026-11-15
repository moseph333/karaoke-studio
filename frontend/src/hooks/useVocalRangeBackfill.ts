/**
 * Vocal range backfill: the intake analyses a song's vocal range while the studio opens, so
 * a song can arrive without it. This asks for it once (GET /api/project/{id}/vocal-range,
 * which waits for an analysis already running) and puts it on the open song.
 */

import React, { useEffect, useRef } from 'react';
import { ProjectState, VocalRangeData } from '../types';
import { apiFetch } from '../api';

export interface UseVocalRangeBackfillOptions {
  project: ProjectState | null;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
}

export function useVocalRangeBackfill({ project, setProject }: UseVocalRangeBackfillOptions) {
  const requestedFor = useRef<string | null>(null);
  const id = project?.id;
  const ready = project?.status === 'ready';
  const missing = !project?.vocal_range && Boolean(project?.vocals_url);

  useEffect(() => {
    if (!id) return;
    if (!ready) {
      if (requestedFor.current === id) requestedFor.current = null;
      return;
    }
    if (!missing || requestedFor.current === id) return;
    requestedFor.current = id;

    let active = true;
    apiFetch(`/api/project/${id}/vocal-range`)
      .then((res) => (res.ok ? (res.json() as Promise<VocalRangeData>) : null))
      .then((data) => {
        if (!active || !data) return;
        setProject((prev) =>
          prev && prev.id === id && !prev.vocal_range ? { ...prev, vocal_range: data } : prev
        );
      })
      .catch(() => {
        // No vocal stem or a failed analysis: the studio works without a key hint
      });
    return () => {
      active = false;
    };
  }, [id, ready, missing, setProject]);
}
