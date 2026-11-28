/**
 * Where the song on a show's stage was, kept in this browser so a song that is cut off can
 * be picked up: the host's page was reloaded, its tab crashed, or the host pressed "Song is
 * over" by mistake and undid it.
 *
 * One place is kept, for one entry of the queue. The player writes it as the song goes
 * (`useShowPlayer`), and forgets it when the song ends by itself or another one starts.
 */

import { resumeAt } from './stageLink';

export const SHOW_RESUME_STORAGE_KEY = 'karaoke_show_resume_v1';
/** The place is written once the song has moved this far on from the last one written. */
export const RESUME_SAVE_SEC = 5;

export interface ShowResume {
  /** The queue entry that was on stage. */
  entryId: string;
  time: number;
  /** The song's length, 0 when it was not known yet. */
  duration: number;
}

function isResume(value: unknown): value is ShowResume {
  if (!value || typeof value !== 'object') return false;
  const resume = value as Record<string, unknown>;
  return (
    typeof resume.entryId === 'string' &&
    typeof resume.time === 'number' &&
    Number.isFinite(resume.time) &&
    typeof resume.duration === 'number'
  );
}

export function loadShowResume(): ShowResume | null {
  try {
    const raw = window.localStorage.getItem(SHOW_RESUME_STORAGE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    return isResume(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Keeps a place, or with null forgets the one kept. */
export function saveShowResume(resume: ShowResume | null): void {
  try {
    if (resume) window.localStorage.setItem(SHOW_RESUME_STORAGE_KEY, JSON.stringify(resume));
    else window.localStorage.removeItem(SHOW_RESUME_STORAGE_KEY);
  } catch {
    // Storage is full or blocked: the song starts from the top
  }
}

/**
 * Where an entry would be picked up, in seconds, or null when it would start from the top:
 * no place is kept for it, or the place is in the song's first or last few seconds.
 */
export function resumePlace(resume: ShowResume | null, entryId: string): number | null {
  if (!resume || resume.entryId !== entryId) return null;
  return resumeAt(resume.time, Number.isFinite(resume.duration) ? resume.duration : 0);
}
