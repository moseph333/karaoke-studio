/**
 * Registers `/sw.js` (frontend/public/sw.js) in production builds. The worker only adds an
 * offline page for when the studio server can't be reached; it never serves API or media
 * responses. The dev server and unit tests skip it.
 */

/** Vite replaces import.meta.env.PROD at build time (true in `vite build` output). */
const IS_PRODUCTION_BUILD = Boolean(
  (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD
);

export function registerServiceWorker(
  nav: Navigator = navigator,
  win: Window = window,
  enabled: boolean = IS_PRODUCTION_BUILD
): void {
  if (!enabled || !('serviceWorker' in nav)) return;
  const register = () => {
    nav.serviceWorker.register('/sw.js').catch((err: unknown) => {
      // e.g. an insecure origin (plain http on a LAN address): the app works without it
      console.warn('Service worker registration failed', err);
    });
  };
  if (win.document.readyState === 'complete') register();
  else win.addEventListener('load', register, { once: true });
}
