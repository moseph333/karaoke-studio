/**
 * Opens the stage window: the stage alone in a window of its own, for a second screen.
 *
 * It opens as a popup the user can drag to the TV. Where the browser can say which screens
 * there are (the Window Management API, Chromium over HTTPS) and the user allows it, the
 * window is moved onto the other screen for them. Filling that screen still takes one click
 * or the F key in the stage window: browsers only let a window go fullscreen from a gesture
 * made in it.
 */

import { SHOW_PARAM, STAGE_PARAM } from './stageLink';

export const STAGE_WINDOW_NAME = 'karaoke-stage';
const FALLBACK_SIZE = { width: 1280, height: 720 };

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

export function stageWindowUrl(): string {
  return `${window.location.pathname}?${STAGE_PARAM}=1`;
}

/** The address of a show's host screen. */
export function showUrl(): string {
  return `${window.location.pathname}?${SHOW_PARAM}=1`;
}

/** Leaves the app for a show's host screen (a page of its own, see `main.tsx`). */
export function openShow(): void {
  window.location.assign(showUrl());
}

/** Whether this browser can show a stage window at all. */
export function canOpenStageWindow(): boolean {
  return typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined';
}

async function moveToOtherScreen(stage: Window): Promise<void> {
  const getScreenDetails = (window as WindowWithScreens).getScreenDetails;
  if (typeof getScreenDetails !== 'function') return;
  try {
    const details = await getScreenDetails.call(window);
    const other = details.screens.find((screen) => screen !== details.currentScreen);
    if (!other || stage.closed) return;
    stage.moveTo(other.availLeft, other.availTop);
    stage.resizeTo(other.availWidth, other.availHeight);
  } catch {
    // Not allowed, or one screen: the window stays where it opened, to be dragged over
  }
}

/**
 * Opens the stage window, or brings the open one forward (`alreadyOpen`: reopening its
 * address would reload it in the middle of a song). Null when the browser blocked the popup.
 */
export function openStageWindow(alreadyOpen = false): Window | null {
  const features = `popup,width=${FALLBACK_SIZE.width},height=${FALLBACK_SIZE.height}`;
  const stage = window.open(alreadyOpen ? '' : stageWindowUrl(), STAGE_WINDOW_NAME, features);
  if (!stage) return null;
  try {
    // Believed open but gone (it closed without saying so): the name made a blank window
    if (alreadyOpen && stage.location.href === 'about:blank') {
      stage.location.replace(stageWindowUrl());
      alreadyOpen = false;
    }
  } catch {
    // Another origin took the window's name; leave it alone
  }
  stage.focus();
  if (!alreadyOpen) void moveToOtherScreen(stage);
  return stage;
}
