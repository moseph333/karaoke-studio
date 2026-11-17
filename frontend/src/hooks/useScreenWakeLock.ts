/**
 * Keeps the screen on while a song plays.
 *
 * Audio alone does not stop a phone or tablet from dimming and locking, so the lyrics would
 * go dark in the middle of a song. A screen wake lock is held while playback runs and given
 * back on pause. The browser drops the lock whenever the page is hidden, so it is taken
 * again when the page comes back and the song is still playing. Browsers without the API,
 * or that refuse the lock (battery saver), simply keep their usual behaviour.
 */

import { useEffect } from 'react';

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    let stopped = false;

    const acquire = () => {
      if (stopped || requesting || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      requesting = true;
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          if (stopped) lock.release().catch(() => {});
          else sentinel = lock;
        })
        .catch(() => {
          // Refused (battery saver, page not active): the screen follows its usual timeout
        })
        .finally(() => {
          requesting = false;
        });
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
