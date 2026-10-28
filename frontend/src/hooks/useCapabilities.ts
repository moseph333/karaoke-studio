/**
 * Server capabilities (GET /api/capabilities): which stem separation presets and which lyric
 * aligner this server can run, and why not. Fetched on first use and shared by every caller;
 * a failed request is retried the next time a component asks.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { StudioCapabilities } from '../types';
import { isStudioCapabilities } from '../utils/quality';

let cached: StudioCapabilities | null = null;
let pending: Promise<StudioCapabilities | null> | null = null;

export function loadCapabilities(): Promise<StudioCapabilities | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = apiFetch('/api/capabilities')
      .then(async (res) => {
        if (!res.ok) return null;
        const data: unknown = await res.json();
        return isStudioCapabilities(data) ? data : null;
      })
      .catch(() => null)
      .then((value) => {
        cached = value;
        pending = null;
        return value;
      });
  }
  return pending;
}

/** Forgets the shared copy (tests, or after the server's setup changed). */
export function resetCapabilitiesCache(): void {
  cached = null;
  pending = null;
}

/** The capabilities once loaded, or null while loading or when the server could not say.
 * Pass `enabled: false` to wait until the information is actually needed. */
export function useCapabilities(enabled = true): StudioCapabilities | null {
  const [capabilities, setCapabilities] = useState<StudioCapabilities | null>(cached);

  useEffect(() => {
    if (!enabled || capabilities) return;
    let active = true;
    void loadCapabilities().then((value) => {
      if (active && value) setCapabilities(value);
    });
    return () => {
      active = false;
    };
  }, [enabled, capabilities]);

  return capabilities;
}
