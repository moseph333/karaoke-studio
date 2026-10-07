import { useState, useEffect } from 'react';
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

interface UseProjectPollingReturn {
  project: ProjectState | null;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
  isWorking: boolean;
}

/**
 * Custom React hook that encapsulates polling project status and synchronizing
 * background processing states between the frontend and backend.
 */
export function useProjectPolling(initialProject: ProjectState | null = null): UseProjectPollingReturn {
  const [project, setProject] = useState<ProjectState | null>(initialProject);
  const [, setTick] = useState(0);

  const isWorking =
    Boolean(project?.status && ACTIVE_PIPELINE_STATUSES.includes(project.status)) ||
    Boolean(project?.render_status && ACTIVE_RENDER_STATUSES.includes(project.render_status));

  // Poll project state every 1000ms while processing or rendering
  useEffect(() => {
    if (!project?.id || !isWorking) return;

    let consecutiveErrors = 0;
    const maxRetries = 5;

    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/project/${project.id}`);
        if (res.ok) {
          consecutiveErrors = 0;
          const data: ProjectState = await res.json();
          setProject(data);
        } else if (res.status === 404) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxRetries) {
            setProject((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'error',
                    error: 'Session timed out or server reloaded. Please click "Try Another Track" to re-open.',
                  }
                : null
            );
          }
        }
      } catch (err) {
        console.error('Failed to poll project status:', err);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [project?.id, isWorking]);

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
  };
}
