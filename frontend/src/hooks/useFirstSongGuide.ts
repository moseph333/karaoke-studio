/**
 * First Song Guide
 *
 * Whether the studio shows its getting-started card (`components/studio/FirstSongCard`). A
 * browser that has never dismissed it sees it on every song until it does; where storage is
 * unavailable the card is skipped rather than shown on every visit. Browsers that saw the
 * one-time toast this replaced already hold the key, so they do not get the card unasked.
 */

import { useCallback, useState } from 'react';

export const FIRST_SONG_HINT_KEY = 'karaoke_first_song_hint';

function readDismissed(): boolean {
  try {
    return Boolean(localStorage.getItem(FIRST_SONG_HINT_KEY));
  } catch {
    return true;
  }
}

export interface FirstSongGuide {
  visible: boolean;
  /** Hides the card for good in this browser. */
  dismiss: () => void;
  /** Brings the card back (from Help or the command palette) until it is dismissed again. */
  show: () => void;
}

export function useFirstSongGuide(): FirstSongGuide {
  const [visible, setVisible] = useState(() => !readDismissed());

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(FIRST_SONG_HINT_KEY, '1');
    } catch {
      // Hidden for this visit at least
    }
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    try {
      localStorage.removeItem(FIRST_SONG_HINT_KEY);
    } catch {
      // Shown for this visit at least
    }
  }, []);

  return { visible, dismiss, show };
}
