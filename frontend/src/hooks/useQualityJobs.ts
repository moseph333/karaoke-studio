/**
 * Background quality jobs on the open song: re-making its stems at another preset,
 * re-aligning its lyrics and splitting its vocals into parts. Starting a job puts it on the
 * project right away, so polling picks it up; when a job finishes the user gets a toast with
 * the outcome.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../api';
import type {
  LyricLine,
  ProjectState,
  SeparationJob,
  SeparationPreset,
  SyncJob,
  VocalSplitJob,
  VocalSplitKind,
} from '../types';
import { PRESET_NAMES } from '../utils/quality';
import { useToast } from './useToast';
import { isActiveJobStatus } from '../utils/jobs';

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
  /** With `lines`: lines whose words were timed by hand keep their timing. */
  keep_manual?: boolean;
  /** With `custom_lyrics`: the LRCLIB listing they were taken from. */
  lyric_source_id?: number | string;
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
  /** Starts a split of the vocal stem; a refusal (busy song, a server that cannot run the
   * model) is shown as a toast with the server's reason. */
  startVocalSplit: (kind?: VocalSplitKind) => Promise<void>;
  cancelVocalSplit: () => Promise<void>;
}

type JobField = 'separation_job' | 'sync_job' | 'vocal_split_job';
type AnyJob = SeparationJob | SyncJob | VocalSplitJob;

async function postJson(url: string, body?: unknown) {
  const res = await apiFetch(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Request failed (${res.status})`));
  }
  return res.json().catch(() => ({}));
}

/** Toasts once when a job seen running finishes (not for jobs already finished on load). */
function useJobOutcomeToast(job: AnyJob | null | undefined, fallback: string) {
  const { toast } = useToast();
  const seen = useRef<{ id: string; status: string } | null>(null);

  useEffect(() => {
    if (!job?.id) return;
    const previous = seen.current;
    seen.current = { id: job.id, status: job.status };
    if (!previous || previous.id !== job.id || !isActiveJobStatus(previous.status)) return;
    if (isActiveJobStatus(job.status)) return;
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
  // The dialog belongs to the song it was opened over: closing or switching songs closes it
  const [dialogProjectId, setDialogProjectId] = useState(project?.id);
  if (dialogProjectId !== project?.id) {
    setDialogProjectId(project?.id);
    setReseparateOpen(false);
  }
  const projectId = project?.id;

  useJobOutcomeToast(project?.separation_job, 'Stem re-separation finished');
  useJobOutcomeToast(project?.sync_job, 'Lyric re-alignment finished');
  useJobOutcomeToast(project?.vocal_split_job, 'Vocal split finished');

  const putJob = useCallback(
    (field: JobField, job: AnyJob | null | undefined) => {
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
        // Re-timing never undoes word timing someone set by hand
        keep_manual: true,
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

  const startVocalSplit = useCallback(
    async (kind: VocalSplitKind = 'lead_backing') => {
      if (!projectId) return;
      try {
        const data = await postJson(`/api/project/${projectId}/vocal-split`, { kind });
        putJob('vocal_split_job', data.job);
        toast.info(
          kind === 'male_female'
            ? 'Splitting the male and female voices. The song stays playable.'
            : 'Splitting the lead and backing vocals. The song stays playable.'
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not split the vocals', 8000);
      }
    },
    [projectId, putJob, toast]
  );

  const cancelVocalSplit = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await postJson(`/api/project/${projectId}/vocal-split/cancel`);
      putJob('vocal_split_job', data.job);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the vocal split');
    }
  }, [projectId, putJob, toast]);

  const openReseparate = useCallback(() => setReseparateOpen(true), []);
  const closeReseparate = useCallback(() => setReseparateOpen(false), []);

  // Memoised so components receiving `quality` re-render only when it changes
  return useMemo(
    () => ({
      isReseparateOpen,
      openReseparate,
      closeReseparate,
      startReseparation,
      cancelReseparation,
      startBackgroundRealign,
      cancelRealign,
      startVocalSplit,
      cancelVocalSplit,
    }),
    [
      isReseparateOpen,
      openReseparate,
      closeReseparate,
      startReseparation,
      cancelReseparation,
      startBackgroundRealign,
      cancelRealign,
      startVocalSplit,
      cancelVocalSplit,
    ]
  );
}
