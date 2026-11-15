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

interface Chunk<M> {
  /** Starts the fetch (once) and resolves with the module. */
  load: () => Promise<M>;
  /** The module if it has arrived, else null. */
  loaded: () => M | null;
}

/**
 * A module fetched on demand. A failed fetch is retried once after a short wait, for a
 * dropped connection; if the file is really gone (an update replaced the build while this
 * page was open) the error boundary offers a reload.
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
  pick: (mod: M) => ComponentType<P>
): ComponentType<P> {
  const Lazy = lazy(() => source.load().then((mod) => ({ default: pick(mod) })));
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

export const StudioWorkspace = deferred(studio, (m) => m.StudioWorkspace);
export const TransportDock = deferred(studio, (m) => m.TransportDock);
export const ExportModal = deferred(studio, (m) => m.ExportModal);
export const ReseparateDialog = deferred(studio, (m) => m.ReseparateDialog);
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
