/**
 * Offers "Update now" when GitHub's main is ahead of the build the server runs.
 *
 * Only where the server says a host service applies updates (`self_update`, set by
 * SELF_UPDATE=1, as on the homelab): elsewhere nothing would act on the request. The check
 * asks GET /api/health?check_remote=1 (the server runs `git ls-remote`, and only for a signed-in
 * session) when the tab becomes visible again and every 10 minutes while it is visible. Each
 * remote commit is offered once. "Update now" posts {"action": "update"} to /api/system/update;
 * once the server has rebuilt, useUpdatePrompt offers the reload into the new version.
 *
 * Like useUpdatePrompt it does nothing outside a built page (the dev server, unit tests).
 */

import { useEffect } from 'react';
import { apiFetch } from '../api';
import { useToast } from './useToast';
import { entryScript } from './useUpdatePrompt';

export const SERVER_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Each check makes the server ask GitHub; returning to the tab often needn't repeat it. */
export const SERVER_UPDATE_MIN_GAP_MS = 2 * 60 * 1000;
export const SERVER_UPDATE_STARTED_MESSAGE =
  'Updating the studio. It restarts once running jobs finish; you will be offered a reload when it is ready.';
export const SERVER_UPDATE_SIGN_IN_MESSAGE = 'Sign in with the studio passphrase to update.';
export const SERVER_UPDATE_FAILED_MESSAGE = 'Could not start the update. Try again in a moment.';

export interface ServerUpdateStatus {
  update_available?: boolean;
  updating?: boolean;
  self_update?: boolean;
  latest_version?: string;
  remote_commit?: string;
  /** An update waits for running jobs; new ones are paused (useUpdateDrainNotice). */
  draining?: boolean;
  active_jobs?: number;
}

/** The toast text for an available update. */
export function serverUpdateMessage(status: ServerUpdateStatus): string {
  const version = status.latest_version?.trim();
  return version
    ? `A new version of Karaoke Studio is available: ${version}.`
    : 'A new version of Karaoke Studio is available.';
}

async function fetchStatus(): Promise<ServerUpdateStatus | null> {
  try {
    const res = await apiFetch('/api/health?check_remote=1', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ServerUpdateStatus;
  } catch {
    return null; // offline, or the server is restarting
  }
}

export function useServerUpdatePrompt(): void {
  const { showToast, dismissToast } = useToast();

  useEffect(() => {
    if (!entryScript(document)) return;

    let active = true;
    let checking = false;
    let started = false; // this tab asked for the update: no more offers
    let lastCheck = -Infinity;
    let offered: string | null = null;
    let toastId = '';

    const startUpdate = async () => {
      try {
        const res = await apiFetch('/api/system/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update' }),
        });
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          offered = null; // offer again once signed in
          showToast(SERVER_UPDATE_SIGN_IN_MESSAGE, 'warning', 8000);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        started = true;
        showToast(SERVER_UPDATE_STARTED_MESSAGE, 'info', 15000);
      } catch {
        if (!active) return;
        offered = null;
        showToast(SERVER_UPDATE_FAILED_MESSAGE, 'error', 8000);
      }
    };

    const check = async () => {
      const now = Date.now();
      if (started || checking || document.visibilityState === 'hidden') return;
      if (now - lastCheck < SERVER_UPDATE_MIN_GAP_MS) return;
      checking = true;
      lastCheck = now;
      const status = await fetchStatus();
      checking = false;
      if (!active || !status?.self_update || !status.update_available || status.updating) return;
      const target = status.remote_commit || status.latest_version || 'update';
      if (target === offered) return;
      offered = target;
      if (toastId) dismissToast(toastId); // a newer commit replaces the earlier offer
      toastId = showToast(serverUpdateMessage(status), 'info', 0, {
        label: 'Update now',
        onClick: () => void startUpdate(),
      });
    };

    const onVisible = () => void check();
    onVisible(); // a tab left open since before the push learns of it on load
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(onVisible, SERVER_UPDATE_CHECK_INTERVAL_MS);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [showToast, dismissToast]);
}
