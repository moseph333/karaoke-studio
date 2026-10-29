/**
 * Offers a reload once the server serves a newer build of the studio.
 *
 * A self-updating server (the homelab pulls main every 30 minutes) leaves open tabs running the
 * code they loaded, so new frontend features only arrive after a reload. Vite names the entry
 * bundle after a hash of its content, so the entry script of the index.html the server serves now
 * differs from the one this page loaded exactly when the frontend changed; backend-only updates
 * leave it alone. The check runs when the tab becomes visible again and every few minutes while
 * it is visible. Reloading with unsaved lyric edits still asks first, through the editor's
 * beforeunload guard.
 *
 * The dev server and unit tests load no hashed entry script, so there the hook does nothing.
 */

import { useEffect } from 'react';
import { useToast } from './useToast';

export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Focus and visibilitychange often fire together; one fetch is enough. */
export const UPDATE_CHECK_MIN_GAP_MS = 30 * 1000;
export const UPDATE_PROMPT_MESSAGE =
  'Karaoke Studio has been updated. Reload to use the new version.';

/** The hashed entry script a built page loads (`/assets/index-….js`), or null. */
export function entryScript(doc: Document): string | null {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
  return src && src.startsWith('/assets/') ? src : null;
}

/** The entry script of the page the server serves now, or null when it can't be read. */
export async function servedEntryScript(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    return entryScript(new DOMParser().parseFromString(html, 'text/html'));
  } catch {
    return null; // e.g. the server is restarting after an update
  }
}

export function useUpdatePrompt(): void {
  const { showToast, dismissToast } = useToast();

  useEffect(() => {
    const running = entryScript(document);
    if (!running) return;

    let active = true;
    let checking = false;
    let lastCheck = -Infinity;
    let offered: string | null = null; // the newer build already offered, shown or dismissed
    let toastId = '';

    const check = async () => {
      const now = Date.now();
      if (checking || document.visibilityState === 'hidden') return;
      if (now - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
      checking = true;
      lastCheck = now;
      const served = await servedEntryScript();
      checking = false;
      if (!active || !served || served === running || served === offered) return;
      offered = served;
      if (toastId) dismissToast(toastId); // an even newer build replaces the earlier offer
      toastId = showToast(UPDATE_PROMPT_MESSAGE, 'info', 0, {
        label: 'Reload',
        onClick: () => window.location.reload(),
      });
    };

    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(onVisible, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [showToast, dismissToast]);
}
