/**
 * Screens the library (the first thing a visitor sees) does not need: the studio, the
 * export and help dialogs and the command palette.
 *
 * They are split out of the first-load script and fetched when first shown.
 * preloadDeferredScreens() fetches them in the background once the page is idle, so opening
 * a song or pressing Ctrl+K right after loading does not wait on the network. A component
 * whose chunk has arrived renders at once, like a normal import; only one that is still on
 * its way suspends (the caller's Suspense fallback shows meanwhile).
 */

import { createElement, lazy, useState, type ComponentType } from 'react';

const RETRY_DELAY_MS = 600;
// When the page last reloaded itself for a missing chunk; no second reload within the window,
// so a chunk that is gone for another reason cannot reload the page in a loop
export const CHUNK_RELOAD_KEY = 'karaoke_chunk_reload_at';
const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * Reloads the page once when a screen's chunk cannot be fetched even on retry: after a
 * deploy the old build's files are gone, and only the new page knows the new names (React
 * keeps the failed import, so the error screen's "Try again" cannot recover). Returns
 * whether it reloaded. Never reloads twice within a minute, nor when it cannot record that
 * it did (storage blocked), since it could not tell a loop from a first try.
 */
export function reloadForMissingChunk(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < CHUNK_RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface Chunk<M> {
  /** Starts the fetch (once) and resolves with the module. */
  load: () => Promise<M>;
  /** The module if it has arrived, else null. */
  loaded: () => M | null;
}

/**
 * A module fetched on demand. A failed fetch is retried once after a short wait, for a
 * dropped connection. If the file is really gone (an update replaced the build while this
 * page was open), a screen created with reloadOnFailure reloads the page once; the others
 * leave it to their error boundary.
 */
function chunk<M>(importer: () => Promise<M>): Chunk<M> {
  let mod: M | null = null;
  let pending: Promise<M> | null = null;
  const attempt = () =>
    importer().catch(
      () =>
        new Promise<M>((resolve, reject) => {
          window.setTimeout(() => importer().then(resolve, reject), RETRY_DELAY_MS);
        })
    );
  const load = () => {
    pending ??= attempt().then(
      (m) => (mod = m),
      (err) => {
        pending = null;
        throw err;
      }
    );
    return pending;
  };
  return { load, loaded: () => mod };
}

function deferred<M, P extends object>(
  source: Chunk<M>,
  pick: (mod: M) => ComponentType<P>,
  { reloadOnFailure = false }: { reloadOnFailure?: boolean } = {}
): ComponentType<P> {
  const Lazy = lazy(() =>
    source.load().then(
      (mod) => ({ default: pick(mod) }),
      (err: unknown) => {
        if (reloadOnFailure) reloadForMissingChunk();
        throw err;
      }
    )
  );
  const Deferred = (props: P) => {
    // Chosen once per mount: switching component type later would remount the screen
    const [Component] = useState<ComponentType<P>>(() => {
      const mod = source.loaded();
      return mod ? pick(mod) : (Lazy as unknown as ComponentType<P>);
    });
    return createElement(Component, props);
  };
  return Deferred;
}

const studio = chunk(() => import('./components/studio/studioBundle'));
const help = chunk(() => import('./components/HelpModal'));
const palette = chunk(() => import('./components/commandPalette/CommandPalette'));

// The studio's chunk is fetched when a song opens, before there is anything to lose, so a
// missing one reloads the page. Help and the palette open over a studio that may hold unsaved
// edits: a failure there only hides the dialog (App.tsx wraps them in an error boundary)
export const StudioWorkspace = deferred(studio, (m) => m.StudioWorkspace, {
  reloadOnFailure: true,
});
export const TransportDock = deferred(studio, (m) => m.TransportDock, { reloadOnFailure: true });
export const ExportModal = deferred(studio, (m) => m.ExportModal);
export const ReseparateDialog = deferred(studio, (m) => m.ReseparateDialog);
export const SongCheckupDialog = deferred(studio, (m) => m.SongCheckupDialog);
export const HelpModal = deferred(help, (m) => m.HelpModal);
export const CommandPalette = deferred(palette, (m) => m.CommandPalette);

/** Fetches every deferred chunk now; resolves when all have arrived. */
export function loadDeferredScreens(): Promise<void> {
  return Promise.all([studio.load(), help.load(), palette.load()]).then(() => undefined);
}

let preloadStarted = false;

/** Fetches the deferred chunks once the browser is idle. Safe to call more than once. */
export function preloadDeferredScreens(): void {
  if (preloadStarted || typeof window === 'undefined') return;
  preloadStarted = true;
  // A failed fetch here is retried when the screen is opened
  const run = () => void loadDeferredScreens().catch(() => {});
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 1500);
  }
}
