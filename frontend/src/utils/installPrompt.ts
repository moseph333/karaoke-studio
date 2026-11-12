/**
 * Installing the studio as an app (PWA).
 *
 * Chromium browsers (Android Chrome, Edge, desktop Chrome) fire `beforeinstallprompt` once the
 * page qualifies; keeping that event lets an in-app button open the browser's own install
 * sheet later. The event can fire before React mounts, so capture starts at import time in
 * main.tsx and this module keeps the state. iOS has no such event: Safari (and, since iOS
 * 16.4, other iOS browsers) only install through Share → Add to Home Screen, so there the app
 * explains those steps instead.
 */

export type InstallPlatform = 'ios' | 'prompt' | 'other';
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** The parts of the non-standard BeforeInstallPromptEvent the app uses. */
export interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<unknown> | void;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallSnapshot {
  /** A captured install event is waiting: promptInstall() opens the browser's sheet. */
  canPrompt: boolean;
  /** Running as the installed app, or installed during this visit. */
  isInstalled: boolean;
}

/** localStorage key: the user hid the header's install button (the palette and help keep it). */
export const INSTALL_BUTTON_HIDDEN_KEY = 'karaoke_install_button_hidden';

let deferredPrompt: DeferredInstallPrompt | null = null;
let installedThisVisit = false;
let snapshot: InstallSnapshot = { canPrompt: false, isInstalled: false };
let captureStarted = false;
const listeners = new Set<() => void>();

/** True when the page runs as an installed app (home-screen or desktop app window). */
export function isStandaloneDisplay(win: Window = window): boolean {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (win.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch {
    // matchMedia can be missing in old or embedded browsers
  }
  return Boolean((win.navigator as Navigator & { standalone?: boolean }).standalone);
}

/** iPhone, iPod and iPad, including iPadOS, which reports itself as a Mac with touch. */
export function isIosDevice(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

function refresh() {
  const next: InstallSnapshot = {
    canPrompt: deferredPrompt !== null,
    isInstalled: installedThisVisit || isStandaloneDisplay(),
  };
  if (next.canPrompt === snapshot.canPrompt && next.isInstalled === snapshot.isInstalled) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** Starts listening for the install events; safe to call more than once. */
export function startInstallPromptCapture(win: Window = window): void {
  if (captureStarted) return;
  captureStarted = true;
  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep the mini-infobar away; the app offers its own button
    deferredPrompt = event as DeferredInstallPrompt;
    refresh();
  });
  win.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedThisVisit = true;
    refresh();
  });
  try {
    win.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', refresh);
  } catch {
    // ignore: older Safari has no change events on media query lists
  }
  refresh();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallSnapshot(): InstallSnapshot {
  return snapshot;
}

/** Opens the browser's install sheet with the captured event. Each event works only once. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  refresh();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome ?? 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/** How this browser installs the app: its own sheet, the iOS share menu, or not at all. */
export function installPlatform(
  state: InstallSnapshot,
  nav: Navigator = navigator
): InstallPlatform {
  if (state.canPrompt) return 'prompt';
  if (isIosDevice(nav)) return 'ios';
  return 'other';
}

export function readInstallButtonHidden(): boolean {
  try {
    return localStorage.getItem(INSTALL_BUTTON_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInstallButtonHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(INSTALL_BUTTON_HIDDEN_KEY, '1');
    else localStorage.removeItem(INSTALL_BUTTON_HIDDEN_KEY);
  } catch {
    // private mode: the button just comes back next visit
  }
}

/** Test hook: forget captured events and listeners. */
export function resetInstallPromptForTests(): void {
  deferredPrompt = null;
  installedThisVisit = false;
  snapshot = { canPrompt: false, isInstalled: false };
  captureStarted = false;
  listeners.clear();
}
