/**
 * Project Status Polling Hook
 *
 * Polls the open song while its intake pipeline, a video render, a stem re-separation or a
 * lyric re-alignment runs. One request at a time; paused while the tab is hidden; a reply
 * for a song that is no longer open is dropped. Large fields that did not change keep their
 * previous objects, so the timeline editor and its rows are not reset by every poll.
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
  useEffect(() => {
    projectIdRef.current = project?.id;
  }, [project?.id]);

  const isWorking =
    Boolean(project?.status && ACTIVE_PIPELINE_STATUSES.includes(project.status)) ||
    Boolean(project?.render_status && ACTIVE_RENDER_STATUSES.includes(project.render_status)) ||
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
                  'Session timed out or server reloaded. Please click "Try Another Track" to re-open.',
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

  const pollStatus = useCallback(async () => {
    const requestedId = projectIdRef.current;
    // One request at a time: on a slow connection replies could otherwise overlap and land
    // out of order
    if (!requestedId || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const res = await apiFetch(`/api/project/${requestedId}`, { signal: controller.signal });
      // The user opened another song (or none) while this request was out
      if (projectIdRef.current !== requestedId) return;
      if (res.ok) {
        const data: ProjectState = await res.json();
        if (projectIdRef.current !== requestedId || (data?.id && data.id !== requestedId)) return;
        if (data && (data.id || data.status)) {
          consecutiveErrorsRef.current = 0;
          setConsecutiveErrors(0);
          setIsReconnecting(false);
          setProject((prev) => mergePolledProject(prev, data));
        }
      } else {
        recordFailure(res.status === 404);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Failed to poll project status:', err);
      recordFailure(false);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [recordFailure]);

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
