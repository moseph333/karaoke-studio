/**
 * The version the server runs, for the Help dialog's footer.
 *
 * Read from GET /api/health (`version`: APP_VERSION, else `git describe --tags --always`, so
 * `v2.4.0`, or `v2.4.0-3-gabc1234` between releases), which answers without a session. Fetched
 * the first time `enabled` turns true and remembered for the page's lifetime: after an update
 * useUpdatePrompt offers a reload, which starts a new page. Null until known, and when the
 * server can't be reached.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { ServerUpdateStatus } from './useServerUpdatePrompt';

let cachedVersion: string | null = null;

/** Forgets the remembered version (tests). */
export function resetServerVersionCache(): void {
  cachedVersion = null;
}

export function useServerVersion(enabled: boolean): string | null {
  const [version, setVersion] = useState<string | null>(cachedVersion);

  useEffect(() => {
    if (!enabled) return;
    if (cachedVersion) {
      setVersion(cachedVersion);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await apiFetch('/api/health', { cache: 'no-store' });
        if (!res.ok) return;
        const status = (await res.json()) as ServerUpdateStatus;
        const found = typeof status.version === 'string' ? status.version.trim() : '';
        if (!found) return;
        cachedVersion = found;
        if (active) setVersion(found);
      } catch {
        // Offline or restarting: the footer simply shows no version
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return version;
}
