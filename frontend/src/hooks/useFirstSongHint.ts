/**
 * First Song Hint
 *
 * The first time this browser opens a finished song, one toast says what to do next (press
 * play and sing) and offers the shortcut guide. It is shown once and remembered; where
 * storage is unavailable it is skipped rather than repeated on every song.
 */

import { useEffect, useRef } from 'react';
import { useToast } from './useToast';

export const FIRST_SONG_HINT_KEY = 'karaoke_first_song_hint';
const HINT_DURATION_MS = 12000;

export function useFirstSongHint(studioOpen: boolean, onShowGuide: () => void): void {
  const { toast } = useToast();
  const onShowGuideRef = useRef(onShowGuide);
  onShowGuideRef.current = onShowGuide;

  useEffect(() => {
    if (!studioOpen) return;
    try {
      if (localStorage.getItem(FIRST_SONG_HINT_KEY)) return;
      localStorage.setItem(FIRST_SONG_HINT_KEY, '1');
    } catch {
      return;
    }
    toast.show(
      'Your song is ready. Press play (or Space) and sing along as the words light up.',
      'info',
      HINT_DURATION_MS,
      { label: 'Show shortcuts', onClick: () => onShowGuideRef.current() }
    );
  }, [studioOpen, toast]);
}
