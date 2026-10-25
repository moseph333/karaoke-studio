/**
 * Project Status Polling Hook
 *
 * Encapsulates polling intervals for background audio processing and video rendering,
 * synchronizing project state between backend API and studio components.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectState } from '../types';
import { apiFetch } from '../api';

const ACTIVE_PIPELINE_STATUSES = [
  'queued',
  'downloading',
  'separating',
  'fetching_lyrics',
  'aligning',
  'mixing',
];

const ACTIVE_RENDER_STATUSES = ['queued', 'rendering'];

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
  const [, setTick] = useState(0);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const consecutiveErrorsRef = useRef(0);
  const projectIdRef = useRef<string | undefined>(project?.id);
  useEffect(() => {
    projectIdRef.current = project?.id;
  }, [project?.id]);

  const isWorking =
    Boolean(project?.status && ACTIVE_PIPELINE_STATUSES.includes(project.status)) ||
    Boolean(project?.render_status && ACTIVE_RENDER_STATUSES.includes(project.render_status));

  const pollStatus = useCallback(async () => {
    const currentId = projectIdRef.current;
    if (!currentId) return;

    try {
      const res = await apiFetch(`/api/project/${currentId}`);
      if (res.ok) {
        const data: ProjectState = await res.json();
        if (data && (data.id || data.status)) {
          consecutiveErrorsRef.current = 0;
          setConsecutiveErrors(0);
          setIsReconnecting(false);
          setProject(data);
        }
      } else if (res.status === 404) {
        consecutiveErrorsRef.current++;
        const count = consecutiveErrorsRef.current;
        setConsecutiveErrors(count);
        if (count >= 3) {
          setIsReconnecting(true);
        }
        if (count >= 5) {
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
      } else {
        consecutiveErrorsRef.current++;
        const count = consecutiveErrorsRef.current;
        setConsecutiveErrors(count);
        if (count >= 3) {
          setIsReconnecting(true);
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  status_detail:
                    'Network connection interrupted. Reconnecting to server...',
                }
              : null
          );
        }
      }
    } catch (err) {
      console.error('Failed to poll project status:', err);
      consecutiveErrorsRef.current++;
      const count = consecutiveErrorsRef.current;
      setConsecutiveErrors(count);
      if (count >= 3) {
        setIsReconnecting(true);
        setProject((prev) =>
          prev
            ? {
                ...prev,
                status_detail:
                  'Network connection interrupted. Reconnecting to server...',
              }
            : null
        );
      }
    }
  }, []);

  const retryPolling = useCallback(() => {
    consecutiveErrorsRef.current = 0;
    setConsecutiveErrors(0);
    setIsReconnecting(false);
    void pollStatus();
  }, [pollStatus]);

  // Poll project state every 1000ms while processing or rendering
  useEffect(() => {
    if (!project?.id || !isWorking) return;

    const timer = setInterval(() => {
      void pollStatus();
    }, 1000);

    return () => clearInterval(timer);
  }, [project?.id, isWorking, pollStatus]);

  // Second ticker to smoothly interpolate countdowns, elapsed timers, and pulse animations
  useEffect(() => {
    if (!isWorking) return;

    const ticker = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(ticker);
  }, [isWorking]);

  return {
    project,
    setProject,
    isWorking,
    isReconnecting,
    consecutiveErrors,
    retryPolling,
  };
}
