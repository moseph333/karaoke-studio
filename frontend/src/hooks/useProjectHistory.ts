/**
 * Keeps the open song in the address bar (?project=…) and in the browser history, so that
 * Back (the Android back gesture in the installed app, or the browser's button) returns from
 * a song to the library instead of leaving the app.
 *
 * - Opening a song from the library pushes a history entry; switching straight to another
 *   song replaces it, so Back always leads to the library.
 * - Back while a song is open closes it, asking first when there are unsaved edits; if the
 *   user stays, the song's entry is pushed again.
 * - Closing the song in the app (New Song, cancel, delete) steps back over the entry it
 *   pushed, so Forward doesn't lead to a closed song and Back doesn't revisit it.
 * - A song opened from a link (or a reload) has no library entry behind it, so closing it
 *   just removes ?project from the address.
 * - Forward onto a song's entry reopens that song through `onRestoreProject`.
 */

import { useEffect, useRef } from 'react';

export const PROJECT_PARAM = 'project';
export const DISCARD_ON_BACK_MESSAGE =
  'You have unsaved lyric edits. Discard them and return to the library?';

export interface UseProjectHistoryOptions {
  projectId: string | undefined;
  hasUnsavedEdits: boolean;
  /** Closes the open song (Back was pressed). */
  onBackToLibrary: () => void;
  /** Opens the song of a history entry the user moved Forward onto. */
  onRestoreProject: (projectId: string) => void;
}

function urlWithProject(projectId: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (projectId) params.set(PROJECT_PARAM, projectId);
  else params.delete(PROJECT_PARAM);
  params.delete('t'); // a seek position belongs to the link that opened the song
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

function projectInUrl(): string | null {
  return new URLSearchParams(window.location.search).get(PROJECT_PARAM);
}

export function useProjectHistory({
  projectId,
  hasUnsavedEdits,
  onBackToLibrary,
  onRestoreProject,
}: UseProjectHistoryOptions): void {
  const previousIdRef = useRef(projectId);
  /** The song's history entry was pushed by us, so a library entry sits behind it. */
  const pushedRef = useRef(false);
  const latest = useRef({ projectId, hasUnsavedEdits, onBackToLibrary, onRestoreProject });
  latest.current = { projectId, hasUnsavedEdits, onBackToLibrary, onRestoreProject };

  useEffect(() => {
    const previousId = previousIdRef.current;
    previousIdRef.current = projectId;
    const inUrl = projectInUrl();

    if (projectId) {
      if (inUrl === projectId) return; // deep link, reload, or Forward
      if (!previousId && !inUrl) {
        window.history.pushState({ [PROJECT_PARAM]: projectId }, '', urlWithProject(projectId));
        pushedRef.current = true;
      } else {
        window.history.replaceState(
          { ...(window.history.state ?? {}), [PROJECT_PARAM]: projectId },
          '',
          urlWithProject(projectId)
        );
      }
      return;
    }

    if (!previousId || !inUrl) return; // nothing was open, or Back already left the entry
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else {
      window.history.replaceState(window.history.state, '', urlWithProject(null));
    }
  }, [projectId]);

  useEffect(() => {
    const onPopState = () => {
      const { projectId: openId, hasUnsavedEdits: dirty } = latest.current;
      const inUrl = projectInUrl();
      if (openId && !inUrl) {
        if (dirty && !window.confirm(DISCARD_ON_BACK_MESSAGE)) {
          window.history.pushState({ [PROJECT_PARAM]: openId }, '', urlWithProject(openId));
          return;
        }
        pushedRef.current = false;
        latest.current.onBackToLibrary();
      } else if (inUrl && inUrl !== openId) {
        pushedRef.current = !openId; // Forward from the library: Back can return there again
        latest.current.onRestoreProject(inUrl);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
