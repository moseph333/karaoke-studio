/**
 * The Server settings page's talk with the server: whether the page is on, unlocking it with
 * the admin passphrase, reading every setting and saving the owner's changes.
 *
 * The admin routes answer 403, never 401, so a refusal here never signs the studio out.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../api';
import type { ServerSettingsState } from '../types';
import { adminHeaders, clearAdminToken, setAdminToken } from '../utils/adminSession';
import type { SettingDraft } from '../utils/serverSettings';
import { refreshCapabilities } from './useCapabilities';

/** loading: asking the server · off: it has no admin passphrase · locked: the passphrase is
 * needed · ready: the settings are shown · failed: the server could not be asked. */
export type ServerSettingsPhase = 'loading' | 'off' | 'locked' | 'ready' | 'failed';

function isSettingsState(value: unknown): value is ServerSettingsState {
  const data = value as Partial<ServerSettingsState> | null;
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.settings &&
    typeof data.settings === 'object' &&
    data.cloud &&
    typeof data.cloud === 'object'
  );
}

export function useServerSettings(open: boolean) {
  const [phase, setPhase] = useState<ServerSettingsPhase>('loading');
  const [state, setState] = useState<ServerSettingsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Answers that arrive after the page closed, or after a newer request, are dropped
  const request = useRef(0);

  const readSettings = useCallback(async (id: number) => {
    const res = await apiFetch('/api/admin/settings', { headers: adminHeaders() });
    if (id !== request.current) return;
    if (res.status === 403) {
      // The token ran out (or the passphrase changed): ask for the passphrase again
      clearAdminToken();
      setPhase('locked');
      return;
    }
    if (!res.ok) throw new Error(await readApiError(res, 'The settings could not be read'));
    const data: unknown = await res.json();
    if (id !== request.current) return;
    if (!isSettingsState(data)) throw new Error('The settings could not be read');
    setState(data);
    setPhase('ready');
  }, []);

  const load = useCallback(async () => {
    const id = ++request.current;
    setPhase('loading');
    setError(null);
    try {
      const res = await apiFetch('/api/admin/status', { headers: adminHeaders() });
      if (id !== request.current) return;
      if (!res.ok) throw new Error(await readApiError(res, 'The server could not be asked'));
      const status = (await res.json()) as { enabled?: boolean; authenticated?: boolean };
      if (id !== request.current) return;
      if (!status.enabled) return setPhase('off');
      if (!status.authenticated) return setPhase('locked');
      await readSettings(id);
    } catch (err: unknown) {
      if (id !== request.current) return;
      setError(err instanceof Error ? err.message : 'The server could not be asked');
      setPhase('failed');
    }
  }, [readSettings]);

  useEffect(() => {
    if (open) void load();
    else request.current += 1;
  }, [open, load]);

  /** Trades the admin passphrase for a token and shows the settings. */
  const unlock = useCallback(
    async (password: string) => {
      const id = ++request.current;
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) throw new Error(await readApiError(res, 'Incorrect admin passphrase'));
        const data = (await res.json()) as { token?: string };
        if (!data.token) throw new Error('The server did not unlock its settings');
        setAdminToken(data.token);
        await readSettings(id);
      } catch (err: unknown) {
        if (id === request.current) {
          setError(err instanceof Error ? err.message : 'Incorrect admin passphrase');
        }
      } finally {
        setBusy(false);
      }
    },
    [readSettings]
  );

  /** Saves the draft; true when the server took it. The studio's pickers then ask the server
   * again what it offers. */
  const save = useCallback(async (draft: SettingDraft): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ values: draft }),
      });
      if (res.status === 403) {
        clearAdminToken();
        setPhase('locked');
        setError('Enter the admin passphrase again to save your changes.');
        return false;
      }
      if (!res.ok) throw new Error(await readApiError(res, 'The settings could not be saved'));
      const data: unknown = await res.json();
      if (isSettingsState(data)) setState(data);
      void refreshCapabilities();
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The settings could not be saved');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { phase, state, error, busy, unlock, save, reload: load };
}
