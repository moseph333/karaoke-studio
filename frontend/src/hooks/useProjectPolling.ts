/**
 * Project Status Polling Hook
 *
 * Polls the open song while its intake pipeline, a video render, a stem re-separation or a
 * lyric re-alignment runs. One request at a time; paused while the tab is hidden; a reply
 * for a song that is no longer open is dropped.
 *
 * Each poll reads only the progress fields (GET /api/project/{id}/status, a few hundred
 * bytes). When something finishes, the full project (with the new lines, stems or video) is
 * fetched once and applied in the same update. Large fields that did not change keep their
 * previous objects, so the timeline editor and its rows are not reset.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectState } from '../types';
import { apiFetch } from '../api';

const POLL_INTERVAL_MS = 1000;
// Consecutive failed polls before the reconnect banner shows
const RECONNECT_AFTER_FAILURES = 3;
// Consecutive 404s before the song is reported as gone (the server restarted without it)
const GIVE_UP_AFTER_NOT_FOUND = 5;

const ACTIVE_PIPELINE_STATUSES = [
  'queued',
  'processing',
  'downloading',
  'separating',
  'fetching_lyrics',
  'aligning',
  'mixing',
];

const ACTIVE_RENDER_STATUSES = ['queued', 'rendering'];

const ACTIVE_JOB_STATUSES = ['queued', 'running'];

const isJobActive = (job?: { status?: string } | null): boolean =>
  Boolean(job?.status && ACTIVE_JOB_STATUSES.includes(job.status));

// Fields that can be large and rarely change while a job runs
const STABLE_FIELDS = [
  'lines',
  'chords',
  'sync_report',
  'youtube_package',
  'vocal_range',
] as const satisfies ReadonlyArray<keyof ProjectState>;

// The fields GET /api/project/{id}/status returns (with `id`); always all of them, null
// when unset
const STATUS_FIELDS = [
  'status',
  'progress',
  'status_detail',
  'heartbeat',
  'elapsed_seconds',
  'eta_seconds',
  'error',
  'title',
  'artist',
  'thumbnail_url',
  'separation',
  'separation_quality',
  'render_status',
  'render_progress',
  'render_detail',
  'render_heartbeat',
  'render_elapsed_seconds',
  'render_eta_seconds',
  'render_error',
  'video_url',
  'separation_job',
  'sync_job',
] as const satisfies ReadonlyArray<keyof ProjectState>;

// Fields whose type includes null; for the others null means unset (undefined), as when a
// full project omits them
const NULLABLE_STATUS_FIELDS: ReadonlySet<string> = new Set([
  'separation',
  'separation_job',
  'sync_job',
]);

export type ProjectStatus = { id?: string } & {
  [K in (typeof STATUS_FIELDS)[number]]?: ProjectState[K] | null;
};

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The polled project, keeping the previous objects of large fields whose contents did not
 * change. A new `lines` array on every poll reset the editor (dropping its redo history)
 * and re-rendered every timeline row once a second.
 */
export function mergePolledProject(prev: ProjectState | null, next: ProjectState): ProjectState {
  if (!prev || prev.id !== next.id) return next;
  let merged: ProjectState | null = null;
  for (const key of STABLE_FIELDS) {
    if (prev[key] !== next[key] && sameJson(prev[key], next[key])) {
      merged = merged ?? { ...next };
      (merged as unknown as Record<string, unknown>)[key] = prev[key];
    }
  }
  return merged ?? next;
}

/** The project with a status reply applied: the same object when nothing changed. */
export function mergeProjectStatus(prev: ProjectState, status: ProjectStatus): ProjectState {
  let merged: ProjectState | null = null;
  for (const key of STATUS_FIELDS) {
    if (!(key in status)) continue;
    const raw = status[key];
    const value = raw === null && !NULLABLE_STATUS_FIELDS.has(key) ? undefined : raw;
    const current = prev[key];
    if (current === value) continue;
    if (typeof value === 'object' && value !== null && sameJson(current, value)) continue;
    merged = merged ?? { ...prev };
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged ?? prev;
}

const pipelineActive = (p: Partial<ProjectState>): boolean =>
  Boolean(p.status && ACTIVE_PIPELINE_STATUSES.includes(p.status));
const renderActive = (p: Partial<ProjectState>): boolean =>
  Boolean(p.render_status && ACTIVE_RENDER_STATUSES.includes(p.render_status));

/** Whether something running in `prev` has finished in `next`: its results are only in the
 *  full project. */
function finishedSince(prev: ProjectState, next: ProjectState): boolean {
  return (
    (pipelineActive(prev) && !pipelineActive(next)) ||
    (renderActive(prev) && !renderActive(next)) ||
    (isJobActive(prev.separation_job) && !isJobActive(next.separation_job)) ||
    (isJobActive(prev.sync_job) && !isJobActive(next.sync_job))
  );
}

export interface UseProjectPollingReturn {
  project: ProjectState | null;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
  isWorking: boolean;
  isReconnecting: boolean;
  consecutiveErrors: number;
  retryPolling: () => void;
}

/**
 * Custom React hook that encapsulates polling project status and synchronizing
 * background processing states between the frontend and backend.
 */
export function useProjectPolling(
  initialProject: ProjectState | null = null
): UseProjectPollingReturn {
  const [project, setProject] = useState<ProjectState | null>(initialProject);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const consecutiveErrorsRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef<string | undefined>(project?.id);
  // The project as last rendered, to notice what a status reply finishes
  const projectRef = useRef(project);
  useEffect(() => {
    projectIdRef.current = project?.id;
  }, [project?.id]);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const isWorking =
    Boolean(project && (pipelineActive(project) || renderActive(project))) ||
    isJobActive(project?.separation_job) ||
    isJobActive(project?.sync_job);

  const recordFailure = useCallback((notFound: boolean) => {
    consecutiveErrorsRef.current++;
    const count = consecutiveErrorsRef.current;
    setConsecutiveErrors(count);
    if (count >= RECONNECT_AFTER_FAILURES) setIsReconnecting(true);
    if (notFound) {
      if (count >= GIVE_UP_AFTER_NOT_FOUND) {
        setProject((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error:
                  'Session timed out or server reloaded. Click "New Song" and open it again from the library.',
              }
            : null
        );
      }
    } else if (count >= RECONNECT_AFTER_FAILURES) {
      setProject((prev) =>
        prev
          ? { ...prev, status_detail: 'Network connection interrupted. Reconnecting to server...' }
          : null
      );
    }
  }, []);

  const recordSuccess = useCallback(() => {
    consecutiveErrorsRef.current = 0;
    setConsecutiveErrors(0);
    setIsReconnecting(false);
  }, []);

  const pollStatus = useCallback(async () => {
    const requestedId = projectIdRef.current;
    // One request at a time: on a slow connection replies could otherwise overlap and land
    // out of order
    if (!requestedId || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    // The reply is for the song still open (the user may have opened another, or none)
    const stillOpen = (data: { id?: string } | null) =>
      projectIdRef.current === requestedId && !(data?.id && data.id !== requestedId);

    try {
      const res = await apiFetch(`/api/project/${requestedId}/status`, {
        signal: controller.signal,
      });
      if (projectIdRef.current !== requestedId) return;
      if (!res.ok) {
        recordFailure(res.status === 404);
        return;
      }
      const status: ProjectStatus = await res.json();
      if (!status || !(status.id || status.status) || !stillOpen(status)) return;

      const current = projectRef.current;
      if (current && finishedSince(current, mergeProjectStatus(current, status))) {
        // The results (lines, stems, the video) are in the full project: apply it in one
        // update, so the editor sees a finished job together with its lines. Until it
        // arrives the job still shows as running, and the next poll tries again.
        const full = await apiFetch(`/api/project/${requestedId}`, {
          signal: controller.signal,
        });
        if (projectIdRef.current !== requestedId) return;
        if (!full.ok) {
          recordFailure(full.status === 404);
          return;
        }
        const data: ProjectState = await full.json();
        if (!data || !stillOpen(data)) return;
        recordSuccess();
        setProject((prev) => mergePolledProject(prev, data));
        return;
      }
      recordSuccess();
      setProject((prev) => (prev ? mergeProjectStatus(prev, status) : prev));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Failed to poll project status:', err);
      recordFailure(false);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [recordFailure, recordSuccess]);

  const retryPolling = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    consecutiveErrorsRef.current = 0;
    setConsecutiveErrors(0);
    setIsReconnecting(false);
    void pollStatus();
  }, [pollStatus]);

  // Poll every second while something runs, except in a hidden tab (where the result would
  // only be seen later); catch up as soon as the tab is visible again
  useEffect(() => {
    if (!project?.id || !isWorking) return;

    const timer = setInterval(() => {
      if (document.hidden) return;
      void pollStatus();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void pollStatus();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [project?.id, isWorking, pollStatus]);

  // A request for the previous song (or an unmounted studio) is no longer wanted
  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [project?.id]
  );

  return {
    project,
    setProject,
    isWorking,
    isReconnecting,
    consecutiveErrors,
    retryPolling,
  };
}
