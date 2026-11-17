/**
 * App shortcuts: the installed app's icon menu (long-press on Android, right-click in the
 * taskbar or dock on a computer) lists the `shortcuts` of public/manifest.json. Each opens
 * `/?shortcut=<id>`:
 *
 * - `new`: the home screen with the song search focused,
 * - `upload`: the home screen on its "Local Audio File" tab,
 * - `resume`: the song this device had open last.
 *
 * A shortcut never starts processing by itself, and `?project=` (a link to a song) wins
 * over it.
 */

export const SHORTCUT_PARAM = 'shortcut';
export const APP_SHORTCUTS = ['new', 'upload', 'resume'] as const;
export type AppShortcut = (typeof APP_SHORTCUTS)[number];

/** The song this device opened last, for the "Continue last song" shortcut. */
export const LAST_PROJECT_STORAGE_KEY = 'karaoke_last_project';

/** The shortcut the app was launched with, or null. */
export function launchShortcut(params: URLSearchParams): AppShortcut | null {
  if (params.has('project')) return null;
  const value = params.get(SHORTCUT_PARAM);
  return APP_SHORTCUTS.find((id) => id === value) ?? null;
}

/** The current address without the shortcut parameter. */
export function urlWithoutShortcut(location: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  const params = new URLSearchParams(location.search);
  params.delete(SHORTCUT_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

export function rememberLastProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Storage is unavailable: the shortcut opens the library instead
  }
}

export function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetLastProject(): void {
  try {
    localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    // Nothing was stored
  }
}
