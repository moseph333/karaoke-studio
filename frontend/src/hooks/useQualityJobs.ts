/**
 * Background quality jobs on the open song: re-making its stems at another preset and
 * re-aligning its lyrics. Starting a job puts it on the project right away, so polling picks
 * it up; when a job finishes the user gets a toast with the outcome.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import type { LyricLine, ProjectState, SeparationJob, SeparationPreset, SyncJob } from '../types';
import { PRESET_NAMES } from '../utils/quality';
import { useToast } from './useToast';

export interface ReseparateOptions {
  quality: SeparationPreset;
  realignLyrics: boolean;
  redetectChords: boolean;
}

/** What to re-align in the background: new lyrics, an LRCLIB fetch, or the current lines. */
export interface BackgroundRealignRequest {
  custom_lyrics?: string;
  fetch_lrclib?: boolean;
  lines?: LyricLine[];
}

export interface UseQualityJobsOptions {
  project: ProjectState | null;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
}

export interface UseQualityJobsReturn {
  isReseparateOpen: boolean;
  openReseparate: () => void;
  closeReseparate: () => void;
  startReseparation: (options: ReseparateOptions) => Promise<void>;
  cancelReseparation: () => Promise<void>;
  startBackgroundRealign: (request: BackgroundRealignRequest) => Promise<SyncJob>;
  cancelRealign: () => Promise<void>;
}

type JobField = 'separation_job' | 'sync_job';
const ACTIVE = ['queued', 'running'];

async function postJson(url: string, body?: unknown) {
  const res = await apiFetch(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`
    );
  }
  return data;
}

/** Toasts once when a job seen running finishes (not for jobs already finished on load). */
function useJobOutcomeToast(job: SeparationJob | SyncJob | null | undefined, fallback: string) {
  const { toast } = useToast();
  const seen = useRef<{ id: string; status: string } | null>(null);

  useEffect(() => {
    if (!job?.id) return;
    const previous = seen.current;
    seen.current = { id: job.id, status: job.status };
    if (!previous || previous.id !== job.id || !ACTIVE.includes(previous.status)) return;
    if (ACTIVE.includes(job.status)) return;
    const message = job.detail || fallback;
    if (job.status === 'done') toast.success(message);
    else if (job.status === 'cancelled') toast.info(message);
    else toast.error(job.error ? `${message} (${job.error})` : message, 8000);
  }, [job?.id, job?.status, job?.detail, job?.error, fallback, toast]);
}

export function useQualityJobs({
  project,
  setProject,
}: UseQualityJobsOptions): UseQualityJobsReturn {
  const { toast } = useToast();
  const [isReseparateOpen, setReseparateOpen] = useState(false);
  const projectId = project?.id;

  useJobOutcomeToast(project?.separation_job, 'Stem re-separation finished');
  useJobOutcomeToast(project?.sync_job, 'Lyric re-alignment finished');

  const putJob = useCallback(
    (field: JobField, job: SeparationJob | SyncJob | null | undefined) => {
      if (!job) return;
      setProject((current) =>
        current && current.id === projectId ? { ...current, [field]: job } : current
      );
    },
    [projectId, setProject]
  );

  const startReseparation = useCallback(
    async ({ quality, realignLyrics, redetectChords }: ReseparateOptions) => {
      if (!projectId) return;
      const data = await postJson(`/api/project/${projectId}/reseparate`, {
        quality,
        realign_lyrics: realignLyrics,
        redetect_chords: redetectChords,
      });
      putJob('separation_job', data.job);
      toast.info(`Re-making the stems with ${PRESET_NAMES[quality]}. The song stays playable.`);
    },
    [projectId, putJob, toast]
  );

  const cancelReseparation = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await postJson(`/api/project/${projectId}/reseparate/cancel`);
      putJob('separation_job', data.job);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the re-separation');
    }
  }, [projectId, putJob, toast]);

  const startBackgroundRealign = useCallback(
    async (request: BackgroundRealignRequest) => {
      if (!projectId) throw new Error('No song is open');
      const data = await postJson(`/api/project/${projectId}/realign-lyrics`, {
        ...request,
        background: true,
      });
      putJob('sync_job', data.job);
      return data.job as SyncJob;
    },
    [projectId, putJob]
  );

  const cancelRealign = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await postJson(`/api/project/${projectId}/realign-lyrics/cancel`);
      putJob('sync_job', data.job);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the re-alignment');
    }
  }, [projectId, putJob, toast]);

  return {
    isReseparateOpen,
    openReseparate: useCallback(() => setReseparateOpen(true), []),
    closeReseparate: useCallback(() => setReseparateOpen(false), []),
    startReseparation,
    cancelReseparation,
    startBackgroundRealign,
    cancelRealign,
  };
}
