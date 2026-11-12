/**
 * Tells everyone using the studio while an update waits for running jobs.
 *
 * The host's update script builds the new image, then pauses new songs, uploads, renders and
 * re-made stems (they answer 503) until the running jobs finish, and restarts the server
 * (backend/update_drain.py, scripts/update_when_idle.sh). While GET /api/health reports
 * `draining`, a persistent warning toast says so; it goes away once the drain ends, and
 * useUpdatePrompt then offers the reload into the new version.
 *
 * Checks when the tab becomes visible and every minute while it is. Like useUpdatePrompt it
 * does nothing outside a built page (the dev server, unit tests).
 */

import { useEffect } from 'react';
import { apiFetch } from '../api';
import { useToast } from './useToast';
import { entryScript } from './useUpdatePrompt';
import type { ServerUpdateStatus } from './useServerUpdatePrompt';

export const UPDATE_DRAIN_CHECK_INTERVAL_MS = 60 * 1000;

/** The notice text: what is paused, and how many jobs the update waits for. */
export function updateDrainMessage(status: ServerUpdateStatus): string {
  const jobs = status.active_jobs ?? 0;
  const waiting =
    jobs > 0
      ? ` It starts once ${jobs === 1 ? 'the running job finishes' : `${jobs} running jobs finish`}.`
      : ' It starts in a moment.';
  return `The studio is about to update. New songs, renders and re-made stems are paused; your edits still save.${waiting}`;
}

export function useUpdateDrainNotice(): void {
  const { showToast, dismissToast } = useToast();

  useEffect(() => {
    if (!entryScript(document)) return;

    let active = true;
    let checking = false;
    let toastId = '';
    let shown = '';

    const clear = () => {
      if (toastId) dismissToast(toastId);
      toastId = '';
      shown = '';
    };

    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      let status: ServerUpdateStatus | null = null;
      try {
        const res = await apiFetch('/api/health', { cache: 'no-store' });
        if (res.ok) status = (await res.json()) as ServerUpdateStatus;
      } catch {
        status = null; // offline, or the server is restarting: keep what is shown
      }
      checking = false;
      if (!active || !status) return;
      if (!status.draining) {
        clear();
        return;
      }
      const message = updateDrainMessage(status);
      if (message === shown) return;
      if (toastId) dismissToast(toastId);
      toastId = showToast(message, 'warning', 0);
      shown = message;
    };

    const onVisible = () => void check();
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, UPDATE_DRAIN_CHECK_INTERVAL_MS);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [showToast, dismissToast]);
}
